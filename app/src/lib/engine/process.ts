// Server-side engine: takes stored webhook events, decides which automation answers, runs it and queues what to send.
// Uses the service role (bypasses row level security), so every query here filters by org / channel account itself.
// Nothing is sent to Meta from here: replies are written to `messages` with status 'queued'. A sender comes with the
// "connect account" step, because it needs a real access token.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isComment, matchTrigger, type Graph, type TriggerSource } from "../flow";
import type { Lang } from "../i18n";
import { normalizeEvent, isStartWord, isStopWord, STOP_CONFIRMATION, type Inbound } from "./normalize";
import { runGraph, triggerNode, type Effect, type RunOutput, type Snapshot, type Step } from "./run";

type DB = SupabaseClient;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const HOUR = 3600_000;
/** Private replies per account per hour before new ones are held back. Meta's real limit is [verify]; this stays under it. */
export const PRIVATE_REPLY_PER_HOUR = 600;
/** The same person starting more than this many runs in an hour is treated as flooding. */
export const MAX_RUNS_PER_CONTACT_HOUR = 5;
export const MAX_ATTEMPTS = 3;

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const LANGS: Lang[] = ["en", "pt-BR", "es-AR"];

export type Outcome = { status: "processed" | "ignored" | "failed"; reason?: string; runId?: string };

// ---------------------------------------------------------------- queue

/** Processes events that arrived and were not handled yet. Safe to call often and from several places. */
export async function processPending(db: DB, limit = 25): Promise<{ processed: number; ignored: number; failed: number }> {
  const rows = must(await db.from("webhook_events").select("id,external_event_id,payload,attempts").eq("status", "received").lt("attempts", MAX_ATTEMPTS).order("received_at").limit(limit), "list events") as Row[];
  const tally = { processed: 0, ignored: 0, failed: 0 };
  for (const r of rows) {
    // claim the row: only one worker wins the attempt bump
    const claim = await db.from("webhook_events").update({ attempts: r.attempts + 1 }).eq("id", r.id).eq("attempts", r.attempts).eq("status", "received").select("id");
    if (claim.error || !claim.data?.length) continue;
    let out: Outcome;
    try {
      out = await processEvent(db, r as { id: string; external_event_id: string; payload: unknown });
    } catch (e) {
      out = { status: "failed", reason: e instanceof Error ? e.message : String(e) };
    }
    const final = out.status === "failed" && r.attempts + 1 < MAX_ATTEMPTS ? "received" : out.status; // failed ones are retried
    await db.from("webhook_events").update({ status: final, error: out.status === "failed" ? out.reason : out.reason ?? null, processed_at: new Date().toISOString() }).eq("id", r.id);
    tally[out.status]++;
  }
  return tally;
}

// ---------------------------------------------------------------- one event

export async function processEvent(db: DB, ev: { id: string; external_event_id: string; payload: unknown }): Promise<Outcome> {
  const inb = normalizeEvent(ev.external_event_id, ev.payload);
  if (!inb) return { status: "ignored", reason: "not a recognised Meta event" };
  if (inb.kind === "ignore") return { status: "ignored", reason: inb.ignoreReason };

  // which of our connected accounts is this for?
  const accs = must(await db.from("channel_accounts").select("id,org_id,channel").eq("channel", inb.channel).or(`external_ig_id.eq.${inb.accountId},external_page_id.eq.${inb.accountId}`).neq("status", "disconnected").limit(2), "channel lookup") as Row[];
  if (accs.length > 1) return { status: "ignored", reason: "this account id matches more than one workspace" }; // never guess whose it is
  const acc = accs[0];
  if (!acc) return { status: "ignored", reason: "no connected account for this id" };
  await db.from("webhook_events").update({ channel_account_id: acc.id }).eq("id", ev.id);
  const org = must(await db.from("orgs").select("default_language,timezone").eq("id", acc.org_id).single(), "org") as Row;

  const now = new Date();
  const isComm = inb.kind === "comment";
  const autos = (must(await db.from("automations").select("id,name,default_language,live_version_id,created_at,live:automation_versions!automations_live_version_fk(graph)").eq("org_id", acc.org_id).eq("status", "live").not("live_version_id", "is", null).order("created_at"), "automations") as unknown) as Row[];

  // A public comment only becomes a contact and a conversation if it actually starts something. Comments nobody asked us to
  // answer (no matching automation, an opted-out person, a repeat on the same post) are dropped without storing anything.
  if (isComm) {
    const wanted = pickAutomation(autos, inb);
    if (!wanted) return { status: "ignored", reason: "no live automation matches this comment" };
    const known = (must(await db.from("contacts").select("id,status").eq("channel_account_id", acc.id).eq("external_id", inb.senderId).limit(1), "contact") as Row[])[0];
    if (known) {
      if (known.status === "unsubscribed" || known.status === "blocked") return { status: "ignored", reason: `contact is ${known.status}` };
      const seen = await db.from("automation_firings").select("id", { count: "exact", head: true }).eq("automation_id", wanted.auto.id).eq("contact_id", known.id).eq("post_external_id", inb.postId ?? "");
      if ((seen.count ?? 0) > 0) return { status: "ignored", reason: "this person already got this automation for this post" };
    }
  }

  const contact = await upsertContact(db, acc, inb, org, now, isComm);
  const conv = await upsertConversation(db, acc, contact.id, now);
  await storeInbound(db, acc, conv.id, inb);

  // ---- people asking to stop or start again (always honoured, before anything else)
  if (inb.kind === "message" && isStopWord(inb.text)) {
    await db.from("contacts").update({ status: "unsubscribed" }).eq("id", contact.id);
    await db.from("events").insert({ org_id: acc.org_id, type: "unsubscribed", contact_id: contact.id, source: "dm" });
    const lang = (LANGS.includes(contact.language) ? contact.language : org.default_language) as Lang;
    await queueMessage(db, acc, conv.id, { kind: "text", body: { text: STOP_CONFIRMATION[lang], mode: "window", recipient: { id: inb.senderId } }, automationId: null });
    return { status: "processed", reason: "opted out" };
  }
  if (inb.kind === "message" && isStartWord(inb.text) && contact.status === "unsubscribed") {
    await db.from("contacts").update({ status: "subscribed" }).eq("id", contact.id);
    return { status: "processed", reason: "opted back in" };
  }
  if (contact.status === "unsubscribed" || contact.status === "blocked") return { status: "ignored", reason: `contact is ${contact.status}` };
  if (conv.automation_paused_until && new Date(conv.automation_paused_until) > now) return { status: "ignored", reason: "automations paused for this conversation" };

  if (inb.kind === "postback") return handleTap(db, acc, org, contact, conv, inb, now);

  // ---- flooding guard
  const recent = await db.from("events").select("id", { count: "exact", head: true }).eq("contact_id", contact.id).eq("type", "trigger_fired").gte("created_at", new Date(now.getTime() - HOUR).toISOString());
  if ((recent.count ?? 0) >= MAX_RUNS_PER_CONTACT_HOUR) return { status: "ignored", reason: "too many runs for this person in the last hour" };

  // ---- which automation answers?
  const hit = pickAutomation(autos, inb);
  if (!hit) return { status: "ignored", reason: "no live automation matches" };
  const { auto, graph, source } = hit;

  // ---- once per person per post (comments); frequency limit (default reply)
  const t = triggerNode(graph)!;
  if (isComment(source)) {
    const ins = await db.from("automation_firings").insert({ org_id: acc.org_id, automation_id: auto.id, contact_id: contact.id, post_external_id: inb.postId ?? "", comment_external_id: inb.commentId });
    if (ins.error) return ins.error.code === "23505" ? { status: "ignored", reason: "this person already got this automation for this post" } : fail(ins.error.message);
  } else if (source === "default_reply") {
    const since = new Date(now.getTime() - t.t.frequencyHours * HOUR).toISOString();
    const prev = await db.from("events").select("id", { count: "exact", head: true }).eq("contact_id", contact.id).eq("automation_id", auto.id).eq("type", "trigger_fired").gte("created_at", since);
    if ((prev.count ?? 0) > 0) return { status: "ignored", reason: "default reply already sent inside its frequency window" };
  }

  const snapshot = await loadSnapshot(db, contact, org, now, !isComm);
  const rotation = ((await db.from("automation_firings").select("id", { count: "exact", head: true }).eq("automation_id", auto.id)).count ?? 0) + ((await db.from("runs").select("id", { count: "exact", head: true }).eq("automation_id", auto.id)).count ?? 0);
  const out = runGraph({ graph, start: "trigger", snapshot, source, defaultLang: (auto.default_language as Lang) ?? "pt-BR", privateReplyAvailable: isComm, publicRotation: rotation });

  const run = must(await db.from("runs").insert({ org_id: acc.org_id, automation_id: auto.id, version_id: auto.live_version_id, contact_id: contact.id, status: "running" }).select("id").single(), "run") as Row;
  await db.from("events").insert({ org_id: acc.org_id, type: "trigger_fired", contact_id: contact.id, automation_id: auto.id, post_external_id: inb.postId ?? null, ad_id: inb.adId ?? null, source: inb.adId ? "paid" : isComm ? "organic" : "dm" });
  await finishRun(db, { acc, conv, contact, inb, auto, runId: run.id, out, now });
  return { status: "processed", runId: run.id };
}

const fail = (reason: string): Outcome => ({ status: "failed", reason });

// ---------------------------------------------------------------- routing

/** Picks the automation that answers this event: the oldest live one whose trigger matches. */
export function pickAutomation(autos: Row[], inb: Inbound): { auto: Row; graph: Graph; source: TriggerSource } | null {
  const candidates = autos
    .map((a) => ({ auto: a, graph: a.live?.graph as Graph | undefined }))
    .filter((c): c is { auto: Row; graph: Graph } => !!c.graph)
    .map((c) => ({ ...c, trig: triggerNode(c.graph) }))
    .filter((c) => !!c.trig && c.trig.t.channel === inb.channel);

  const match = (sources: TriggerSource[], extra?: (c: (typeof candidates)[number]) => boolean) =>
    candidates.find((c) => sources.includes(c.trig!.t.source) && matchTrigger(c.trig!.data, inb.text) && (!extra || extra(c)));
  const done = (c: (typeof candidates)[number] | undefined) => (c ? { auto: c.auto, graph: c.graph, source: c.trig!.t.source } : null);

  if (inb.kind === "comment") {
    const src: TriggerSource = inb.channel === "instagram" ? "ig_comment" : "fb_comment";
    return done(
      match([src], (c) => {
        const d = c.trig!.data;
        if (d.postScope === "all") return true;
        if (d.postScope === "specific") return !!d.postId && d.postId === inb.postId;
        return false; // "next post" cannot be told apart without post dates, so it never fires here (safe default)
      }),
    );
  }
  if (inb.kind === "story_mention") return done(match(["story_mention"]));
  if (inb.kind === "message") {
    if (inb.adId) {
      const ad = match(["ad"], (c) => !c.trig!.t.adId || c.trig!.t.adId === inb.adId);
      if (ad) return done(ad);
    }
    if (inb.storyReply) {
      const sr = match(["story_reply"]);
      if (sr) return done(sr);
    }
    if (inb.text) {
      const dm = match(["dm_keyword"]);
      if (dm) return done(dm);
    }
    return done(match(["default_reply"]));
  }
  return null;
}

// ---------------------------------------------------------------- taps

async function handleTap(db: DB, acc: Row, org: Row, contact: Row, conv: Row, inb: Inbound, now: Date): Promise<Outcome> {
  // tap:<automation>:<step>:<run>. The run makes each message's button its own: a new comment gets a new button that works again.
  // Older buttons (no run id) are limited to one tap per person.
  const m = /^tap:([0-9a-f-]{36}):([\w-]{1,64})(?::([0-9a-f-]{36}))?$/i.exec(inb.payload ?? "");
  if (!m) return { status: "ignored", reason: "button payload is not one of ours" };
  const [, autoId, nodeId, fromRun] = m;
  const auto = (must(await db.from("automations").select("id,default_language,live_version_id,live:automation_versions!automations_live_version_fk(graph)").eq("id", autoId).eq("org_id", acc.org_id).eq("status", "live").limit(1), "tap automation") as unknown as Row[])[0];
  const graph = auto?.live?.graph as Graph | undefined;
  if (!auto || !graph?.nodes.some((n) => n.id === nodeId)) return { status: "ignored", reason: "automation or step no longer live" };
  // one tap per button per person
  const ins = await db.from("automation_firings").insert({ org_id: acc.org_id, automation_id: auto.id, contact_id: contact.id, post_external_id: fromRun ? `tap:${nodeId}:${fromRun}` : `tap:${nodeId}` });
  if (ins.error) return ins.error.code === "23505" ? { status: "ignored", reason: "this button was already used by this person" } : fail(ins.error.message);

  const snapshot = await loadSnapshot(db, contact, org, now, true);
  const t = triggerNode(graph);
  const out = runGraph({ graph, start: { nodeId, handle: "tap" }, snapshot, source: t?.t.source ?? "ig_comment", defaultLang: (auto.default_language as Lang) ?? "pt-BR", privateReplyAvailable: false, publicRotation: 0 });
  const run = must(await db.from("runs").insert({ org_id: acc.org_id, automation_id: auto.id, version_id: auto.live_version_id, contact_id: contact.id, status: "running" }).select("id").single(), "run") as Row;
  await db.from("events").insert({ org_id: acc.org_id, type: "quick_reply_tapped", contact_id: contact.id, automation_id: auto.id });
  await finishRun(db, { acc, conv, contact, inb, auto, runId: run.id, out, now });
  return { status: "processed", runId: run.id };
}

// ---------------------------------------------------------------- waits

/** Continues runs whose wait is over. Called by the scheduled job. */
export async function resumeDueRuns(db: DB, limit = 25): Promise<number> {
  const now = new Date();
  const due = must(await db.from("runs").select("id,org_id,automation_id,version_id,contact_id,current_node_id").eq("status", "waiting").eq("wait_for", "delay").lte("wait_until", now.toISOString()).limit(limit), "due runs") as Row[];
  let n = 0;
  for (const r of due) {
    const claim = await db.from("runs").update({ status: "running" }).eq("id", r.id).eq("status", "waiting").select("id");
    if (claim.error || !claim.data?.length) continue;
    try {
      const ver = must(await db.from("automation_versions").select("graph").eq("id", r.version_id).single(), "version") as Row;
      const auto = must(await db.from("automations").select("id,default_language").eq("id", r.automation_id).single(), "automation") as Row;
      const contact = must(await db.from("contacts").select("*").eq("id", r.contact_id).single(), "contact") as Row;
      if (contact.status !== "subscribed") {
        await db.from("runs").update({ status: "cancelled", error: `contact is ${contact.status}` }).eq("id", r.id);
        continue;
      }
      const acc = must(await db.from("channel_accounts").select("id,org_id,channel").eq("id", contact.channel_account_id).single(), "account") as Row;
      const org = must(await db.from("orgs").select("default_language,timezone").eq("id", r.org_id).single(), "org") as Row;
      const conv = must(await db.from("conversations").select("*").eq("contact_id", contact.id).eq("channel_account_id", acc.id).single(), "conversation") as Row;
      const graph = ver.graph as Graph;
      const snapshot = await loadSnapshot(db, contact, org, now, false);
      const out = runGraph({ graph, start: { nodeId: r.current_node_id, handle: "next" }, snapshot, source: triggerNode(graph)?.t.source ?? "ig_comment", defaultLang: (auto.default_language as Lang) ?? "pt-BR", privateReplyAvailable: false, publicRotation: 0 });
      await finishRun(db, { acc, conv, contact, inb: null, auto, runId: r.id, out, now });
      n++;
    } catch (e) {
      await db.from("runs").update({ status: "failed", error: e instanceof Error ? e.message : String(e) }).eq("id", r.id);
    }
  }
  return n;
}

// ---------------------------------------------------------------- shared pieces

async function upsertContact(db: DB, acc: Row, inb: Inbound, org: Row, now: Date, isComm: boolean): Promise<Row> {
  let c = ((must(await db.from("contacts").select("*").eq("channel_account_id", acc.id).eq("external_id", inb.senderId).limit(1), "contact") as Row[])[0]) ?? null;
  if (!c) {
    const ins = await db.from("contacts").insert({
      org_id: acc.org_id,
      channel_account_id: acc.id,
      channel: acc.channel,
      external_id: inb.senderId,
      username: inb.username ?? null,
      language: org.default_language,
      opt_in_source: inb.adId ? "ad" : isComm ? "comment" : inb.kind === "story_mention" ? "story" : "dm",
      opted_in: true,
    }).select("*").single();
    if (ins.error) {
      if (ins.error.code !== "23505") throw new Error("contact insert: " + ins.error.message);
      c = (must(await db.from("contacts").select("*").eq("channel_account_id", acc.id).eq("external_id", inb.senderId).limit(1), "contact") as Row[])[0];
    } else c = ins.data as Row;
  }
  // A comment does not open the 24h window; anything the person sends to us directly does.
  const patch: Row = { last_interaction_at: now.toISOString(), last_input_text: inb.text || c.last_input_text };
  if (!isComm) patch.window_expires_at = new Date(now.getTime() + 24 * HOUR).toISOString();
  if (inb.username && !c.username) patch.username = inb.username;
  await db.from("contacts").update(patch).eq("id", c.id);
  return { ...c, ...patch };
}

async function upsertConversation(db: DB, acc: Row, contactId: string, now: Date): Promise<Row> {
  let c = (must(await db.from("conversations").select("*").eq("contact_id", contactId).eq("channel_account_id", acc.id).limit(1), "conversation") as Row[])[0];
  if (!c) {
    const ins = await db.from("conversations").insert({ org_id: acc.org_id, contact_id: contactId, channel_account_id: acc.id, state: "open", unread_count: 1, last_message_at: now.toISOString() }).select("*").single();
    if (ins.error) {
      if (ins.error.code !== "23505") throw new Error("conversation insert: " + ins.error.message);
      c = (must(await db.from("conversations").select("*").eq("contact_id", contactId).eq("channel_account_id", acc.id).limit(1), "conversation") as Row[])[0];
    } else return ins.data as Row;
  }
  const upd = { state: "open", unread_count: (c.unread_count ?? 0) + 1, last_message_at: now.toISOString() };
  await db.from("conversations").update(upd).eq("id", c.id);
  return { ...c, ...upd };
}

async function storeInbound(db: DB, acc: Row, convId: string, inb: Inbound) {
  const ext = inb.commentId ?? inb.mid ?? null;
  const r = await db.from("messages").insert({
    org_id: acc.org_id,
    conversation_id: convId,
    channel_account_id: acc.id,
    direction: "in",
    sender: "contact",
    kind: inb.kind === "comment" ? "comment" : inb.kind === "postback" ? "postback" : "text",
    body: { text: inb.text, post_id: inb.postId ?? null, comment_id: inb.commentId ?? null, payload: inb.payload ?? null, story_mention: inb.kind === "story_mention", ad_id: inb.adId ?? null },
    external_message_id: ext,
    status: "delivered",
  });
  if (r.error && r.error.code !== "23505") throw new Error("inbound message: " + r.error.message); // 23505 = already stored
}

async function loadSnapshot(db: DB, contact: Row, org: Row, now: Date, windowOpenNow: boolean): Promise<Snapshot> {
  const tags = (must(await db.from("contact_tags").select("tags(name)").eq("contact_id", contact.id), "tags") as unknown as { tags: { name: string } | null }[]).map((x) => x.tags?.name).filter((x): x is string => !!x);
  const exp = contact.window_expires_at ? new Date(contact.window_expires_at) : null;
  let hour = now.getUTCHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: org.timezone || "UTC" }).format(now)) % 24;
  } catch {}
  return {
    language: (LANGS.includes(contact.language) ? contact.language : org.default_language) as Lang,
    tags,
    followsAccount: !!contact.follows_account,
    followers: contact.follower_count ?? 0,
    optedInVia: contact.opt_in_source === "ad" ? "ad" : contact.opt_in_source === "comment" ? "comment" : "dm",
    windowOpen: windowOpenNow || (!!exp && exp > now),
    hour,
  };
}

async function queueMessage(db: DB, acc: Row, convId: string, m: { kind: string; body: Row; automationId: string | null; nodeId?: string; runId?: string; scheduledFor?: string }) {
  must(await db.from("messages").insert({ org_id: acc.org_id, conversation_id: convId, channel_account_id: acc.id, direction: "out", sender: "bot", kind: m.kind, body: m.body, automation_id: m.automationId, node_id: m.nodeId ?? null, automation_run_id: m.runId ?? null, status: "queued", scheduled_for: m.scheduledFor ?? null }), "queue message");
}

async function ensureTag(db: DB, orgId: string, name: string): Promise<string> {
  const found = (must(await db.from("tags").select("id").eq("org_id", orgId).eq("name", name).limit(1), "tag") as Row[])[0];
  if (found) return found.id;
  const ins = await db.from("tags").insert({ org_id: orgId, name }).select("id").single();
  if (!ins.error) return (ins.data as Row).id;
  return (must(await db.from("tags").select("id").eq("org_id", orgId).eq("name", name).limit(1), "tag") as Row[])[0].id; // lost a race: it exists now
}

type Finish = { acc: Row; conv: Row; contact: Row; inb: Inbound | null; auto: Row; runId: string; out: RunOutput; now: Date };

/** Writes everything a run produced: steps, queued messages, tags, pauses, waits. */
async function finishRun(db: DB, f: Finish) {
  const { acc, conv, contact, auto, runId, out, now } = f;
  const orgId = acc.org_id as string;
  if (out.steps.length) {
    await db.from("run_steps").insert(out.steps.map((s: Step) => ({ run_id: runId, org_id: orgId, automation_id: auto.id, node_id: s.nodeId, node_type: s.nodeType, outcome: s.outcome, detail: s.detail ?? null })));
  }
  const heldUntil = await privateReplyHold(db, acc.id, now);
  let wait: Extract<Effect, { type: "wait" }> | null = null;
  for (const e of out.effects) {
    switch (e.type) {
      case "public_reply":
        await queueMessage(db, acc, conv.id, { kind: "public_reply", body: { text: e.text, comment_id: f.inb?.commentId ?? null }, automationId: auto.id, nodeId: e.nodeId, runId });
        break;
      case "message": {
        const recipient = e.mode === "private_reply" ? { comment_id: f.inb?.commentId ?? null } : { id: contact.external_id };
        if (e.text) {
          await queueMessage(db, acc, conv.id, {
            kind: "text",
            body: { text: e.text, button: e.button ?? null, payload: e.button ? `tap:${auto.id}:${e.nodeId}:${runId}` : null, mode: e.mode, recipient },
            automationId: auto.id, nodeId: e.nodeId, runId,
            scheduledFor: e.mode === "private_reply" ? heldUntil ?? undefined : undefined,
          });
        }
        if (e.pdf) await queueMessage(db, acc, conv.id, { kind: "doc", body: { name: e.pdf.name, size: e.pdf.size, path: e.pdf.path ?? null, mode: e.mode, recipient }, automationId: auto.id, nodeId: e.nodeId, runId });
        break;
      }
      case "blocked":
        must(await db.from("messages").insert({ org_id: orgId, conversation_id: conv.id, channel_account_id: acc.id, direction: "out", sender: "system", kind: "event", body: { key: "inbox.system.blocked" }, automation_id: auto.id, node_id: e.nodeId, status: "failed", failure_reason: "24h window closed" }), "blocked note");
        break;
      case "tag_add": {
        const tagId = await ensureTag(db, orgId, e.value);
        const r = await db.from("contact_tags").insert({ contact_id: contact.id, tag_id: tagId, org_id: orgId });
        if (!r.error) await db.from("events").insert({ org_id: orgId, type: "tag_added", contact_id: contact.id, automation_id: auto.id });
        break;
      }
      case "tag_remove": {
        const tg = (must(await db.from("tags").select("id").eq("org_id", orgId).eq("name", e.value).limit(1), "tag") as Row[])[0];
        if (tg) await db.from("contact_tags").delete().eq("contact_id", contact.id).eq("tag_id", tg.id);
        break;
      }
      case "pause":
        await db.from("conversations").update({ automation_paused_until: new Date(now.getTime() + 7 * 24 * HOUR).toISOString() }).eq("id", conv.id);
        break;
      case "unsubscribe":
        await db.from("contacts").update({ status: "unsubscribed" }).eq("id", contact.id);
        await db.from("events").insert({ org_id: orgId, type: "unsubscribed", contact_id: contact.id, automation_id: auto.id });
        break;
      case "assign":
        if (isUuid(e.value)) await db.from("conversations").update({ assignee_id: e.value }).eq("id", conv.id);
        break;
      case "notify":
        await db.from("events").insert({ org_id: orgId, type: "handover", contact_id: contact.id, automation_id: auto.id });
        break;
      case "wait":
        wait = e;
        break;
    }
  }
  if (wait) {
    await db.from("runs").update({ status: "waiting", wait_for: "delay", wait_until: new Date(now.getTime() + wait.minutes * 60_000).toISOString(), current_node_id: wait.nodeId }).eq("id", runId);
  } else {
    await db.from("runs").update({ status: "completed", error: out.truncated ? "stopped after 40 steps (loop?)" : null }).eq("id", runId);
  }
}

/** If the account already used its private-reply budget this hour, new ones wait for the next hour. */
async function privateReplyHold(db: DB, accountId: string, now: Date): Promise<string | null> {
  const since = new Date(now.getTime() - HOUR).toISOString();
  const r = await db.from("messages").select("id", { count: "exact", head: true }).eq("channel_account_id", accountId).eq("direction", "out").contains("body", { mode: "private_reply" }).gte("created_at", since);
  return (r.count ?? 0) >= PRIVATE_REPLY_PER_HOUR ? new Date(now.getTime() + HOUR).toISOString() : null;
}

