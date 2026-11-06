// End-to-end test of the engine against the real database, with fake Meta events (throwaway workspace, deleted at the end).
// Run: NODE_EXTRA_CA_CERTS=.ca-bundle.pem npx tsx --env-file=.env.local scripts/test-live-engine.ts
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { buildGraph, type Graph } from "../src/lib/flow";
import { eventsFrom } from "../src/lib/meta";
import { PRIVATE_REPLY_PER_HOUR, processPending, resumeDueRuns } from "../src/lib/engine/process";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let fails = 0;
const ck = (n: string, ok: boolean, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  " + x)); if (!ok) fails++; };
const tag = randomBytes(3).toString("hex");
const IG = `9${Date.now()}`.slice(0, 15); // throwaway Instagram account id
const FB = `8${Date.now()}`.slice(0, 15);
let n = 0;
const uid = () => `${tag}${++n}`;
const one = async <T>(q: PromiseLike<{ data: T; error: unknown }>) => { const r = await q; if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };

/** Send a Meta-shaped body through the same splitter the webhook uses, then process it. */
async function deliver(body: unknown) {
  const evs = eventsFrom(body);
  await one(db.from("webhook_events").upsert(evs.map((e) => ({ provider: "meta", external_event_id: e.id, payload: e.payload })), { onConflict: "provider,external_event_id", ignoreDuplicates: true }));
  return processPending(db, 50);
}
const comment = (from: string, media: string, text: string, acct = IG) => ({ object: "instagram", entry: [{ id: acct, time: 1, changes: [{ field: "comments", value: { id: `c${uid()}`, text, from: { id: from, username: "u" + from }, media: { id: media } } }] }] });
const dm = (from: string, text: string, acct = IG, extra: object = {}) => ({ object: "instagram", entry: [{ id: acct, time: 1, messaging: [{ sender: { id: from }, recipient: { id: acct }, timestamp: 1, message: { mid: `m${uid()}`, text, ...extra } }] }] });
const tap = (from: string, payload: string) => ({ object: "instagram", entry: [{ id: IG, time: 1, messaging: [{ sender: { id: from }, recipient: { id: IG }, timestamp: 1, postback: { mid: `p${uid()}`, payload, title: "Quero" } }] }] });

const msgs = async (contactExt: string) => {
  const c = (await one(db.from("contacts").select("id").eq("external_id", contactExt).limit(1)) as { id: string }[])[0];
  if (!c) return [];
  const conv = (await one(db.from("conversations").select("id").eq("contact_id", c.id).limit(1)) as { id: string }[])[0];
  return (await one(db.from("messages").select("kind,direction,sender,body,status,scheduled_for").eq("conversation_id", conv.id).order("created_at")) as any[]);
};
const outs = (m: any[]) => m.filter((x) => x.direction === "out");

let orgId = "";
try {
  const org = (await one(db.from("orgs").insert({ name: `engine-test-${tag}` }).select("id").single())) as { id: string };
  orgId = org.id;
  const acc = (await one(db.from("channel_accounts").insert({ org_id: orgId, channel: "instagram", external_page_id: IG, external_ig_id: IG, display_name: "test" }).select("id").single())) as { id: string };
  const fbAcc = (await one(db.from("channel_accounts").insert({ org_id: orgId, channel: "messenger", external_page_id: FB, display_name: "test page" }).select("id").single())) as { id: string };

  async function publish(name: string, graph: Graph, account = acc.id): Promise<string> {
    const a = (await one(db.from("automations").insert({ org_id: orgId, name, status: "live", draft_graph: graph, custom: true, channel_account_id: account }).select("id").single())) as { id: string };
    const v = (await one(db.from("automation_versions").insert({ automation_id: a.id, org_id: orgId, version: 1, graph }).select("id").single())) as { id: string };
    await one(db.from("automations").update({ live_version_id: v.id }).eq("id", a.id));
    return a.id;
  }
  const wiz = buildGraph({ postScope: "specific", postId: "MEDIA1", anyWord: false, keywords: ["guia"], publicReply: true, publicReplies: ["Enviado!"], dm: { text: { "pt-BR": "Olá!" }, button: { "pt-BR": "Quero" } }, pdf: { name: "g.pdf", size: 1000 }, tag: "lead" });
  const autoId = await publish("comment flow", wiz);

  // 1 ── a public comment starts the flow
  let r = await deliver(comment("A1", "MEDIA1", "quero o GUIA por favor"));
  ck("1. comment processed", r.processed === 1, JSON.stringify(r));
  let m = await msgs("A1");
  const o = outs(m);
  ck("1. public reply queued", o.some((x) => x.kind === "public_reply" && x.body.text === "Enviado!" && x.status === "queued"));
  const priv = o.find((x) => x.kind === "text");
  ck("1. private reply uses the comment id, carries a button, no document yet", !!priv && !!priv.body.recipient.comment_id && priv.body.mode === "private_reply" && !!priv.body.payload && !o.some((x) => x.kind === "doc"));
  const contactA = (await one(db.from("contacts").select("id,status,window_expires_at").eq("external_id", "A1").single())) as any;
  ck("1. a comment does not open the 24h window", contactA.window_expires_at === null);
  const tags = (await one(db.from("contact_tags").select("tags(name)").eq("contact_id", contactA.id))) as any[];
  ck("1. tag applied", tags.some((t) => t.tags?.name === "lead"));
  ck("1. nothing was sent to Meta (all queued)", o.every((x) => x.status === "queued"));

  // 2 ── same person, same post, again
  r = await deliver(comment("A1", "MEDIA1", "guia"));
  ck("2. second comment by the same person on the same post is ignored", r.ignored === 1 && r.processed === 0, JSON.stringify(r));
  // 3 ── wrong post, no keyword, own comment
  r = await deliver(comment("A2", "OTHER", "guia"));
  ck("3. comment on another post is ignored", r.ignored === 1);
  r = await deliver(comment("A3", "MEDIA1", "bom dia"));
  ck("3. comment without the keyword is ignored", r.ignored === 1);
  r = await deliver(comment(IG, "MEDIA1", "guia"));
  ck("3. the account's own comment is ignored", r.ignored === 1);
  r = await deliver(comment("A4", "MEDIA1", "guia", "00000"));
  ck("3. event for an unknown account is ignored", r.ignored === 1);

  const strangers = (await one(db.from("contacts").select("external_id").in("external_id", ["A2", "A3", "A4", IG]))) as any[];
  ck("3. comments that start nothing leave no contact, conversation or message behind", strangers.length === 0, JSON.stringify(strangers));

  // 4 ── the tap: window opens, the document is queued, a second tap does nothing
  r = await deliver(tap("A1", priv.body.payload));
  ck("4. tap processed", r.processed === 1, JSON.stringify(r));
  m = await msgs("A1");
  const doc = outs(m).find((x) => x.kind === "doc");
  ck("4. document queued inside the window", !!doc && doc.body.mode === "window" && doc.body.name === "g.pdf");
  r = await deliver(tap("A1", priv.body.payload));
  ck("4. the same button twice is ignored", r.ignored === 1);
  r = await deliver(tap("A1", "tap:00000000-0000-0000-0000-000000000000:x"));
  ck("4. a button from a dead automation is ignored", r.ignored === 1);
  r = await deliver(tap("A1", "something-else"));
  ck("4. a payload that is not ours is ignored", r.ignored === 1);

  // 5 ── opting out and back in
  r = await deliver(dm("A1", "PARAR"));
  const a1 = (await one(db.from("contacts").select("status").eq("external_id", "A1").single())) as any;
  ck("5. 'parar' unsubscribes", a1.status === "unsubscribed" && r.processed === 1);
  ck("5. a confirmation is queued in Portuguese", outs(await msgs("A1")).some((x) => /Você não receberá/.test(x.body.text ?? "")));
  const wiz2 = buildGraph({ postScope: "all", postId: null, anyWord: true, keywords: [], publicReply: false, publicReplies: [], dm: { text: { "pt-BR": "x" }, button: {} }, pdf: null, tag: "" });
  r = await deliver(comment("A1", "MEDIA9", "guia"));
  ck("5. an unsubscribed person gets nothing from automations", r.ignored === 1);
  r = await deliver(dm("A1", "iniciar"));
  const a1b = (await one(db.from("contacts").select("status").eq("external_id", "A1").single())) as any;
  ck("5. 'iniciar' subscribes again", a1b.status === "subscribed");

  // 6 ── DM keyword automation: the person wrote first, window is open, a document can go straight away
  const dmGraph = JSON.parse(JSON.stringify(wiz)) as Graph;
  const tn = dmGraph.nodes.find((x) => x.data.kind === "trigger")!;
  if (tn.data.kind === "trigger") { tn.data.source = "dm_keyword"; tn.data.keywords = ["catalogo"]; }
  const msgNodes = dmGraph.nodes.filter((x) => x.data.kind === "message");
  const first = msgNodes[0]; if (first.data.kind === "message") first.data.pdf = { name: "cat.pdf", size: 10 };
  await publish("dm flow", dmGraph);
  r = await deliver(dm("B1", "Quero o catalogo"));
  const b = outs(await msgs("B1"));
  ck("6. DM keyword answers in the window, no public reply", r.processed === 1 && b.some((x) => x.kind === "doc" && x.body.mode === "window") && !b.some((x) => x.kind === "public_reply"));
  const contactB = (await one(db.from("contacts").select("window_expires_at").eq("external_id", "B1").single())) as any;
  ck("6. writing to us opened the 24h window", !!contactB.window_expires_at && new Date(contactB.window_expires_at) > new Date());

  // 7 ── default reply: only when nothing else matches, and not more than once per window
  const defGraph = buildGraph({ postScope: "all", postId: null, anyWord: true, keywords: [], publicReply: false, publicReplies: [], dm: { text: { "pt-BR": "Fale com a equipe" }, button: {} }, pdf: null, tag: "" });
  const dn = defGraph.nodes.find((x) => x.data.kind === "trigger")!;
  if (dn.data.kind === "trigger") { dn.data.source = "default_reply"; dn.data.frequencyHours = 24; }
  await publish("default reply", defGraph);
  r = await deliver(dm("C1", "oi tudo bem"));
  ck("7. default reply answers an unmatched DM", r.processed === 1 && outs(await msgs("C1")).some((x) => x.body.text === "Fale com a equipe"));
  r = await deliver(dm("C1", "ola?"));
  ck("7. and stays quiet the second time (frequency)", r.ignored === 1);
  r = await deliver(dm("C2", "catalogo"));
  ck("7. a DM that matches a keyword automation does not get the default reply", !outs(await msgs("C2")).some((x) => x.body.text === "Fale com a equipe"));

  // 8 ── flood guard
  for (let i = 0; i < 5; i++) await deliver(dm("F1", "catalogo " + i)); // 5 runs
  r = await deliver(dm("F1", "catalogo again"));
  ck("8. a sixth run for the same person within the hour is ignored", r.ignored === 1, JSON.stringify(r));

  // 9 ── a wait, then continue (window still open because the person wrote first)
  const waitGraph: Graph = { nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "trigger", source: "dm_keyword", postScope: "all", postId: null, anyWord: false, keywords: ["espere"] } },
    { id: "w", type: "delay", position: { x: 0, y: 0 }, data: { kind: "delay", minutes: 5 } },
    { id: "m", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: { "pt-BR": "Depois da espera" }, button: {}, pdf: null } },
  ], edges: [{ id: "e1", source: "t", sourceHandle: "next", target: "w" }, { id: "e2", source: "w", sourceHandle: "next", target: "m" }] };
  await publish("wait flow", waitGraph);
  await deliver(dm("W1", "espere"));
  ck("9. nothing is sent before the wait ends", !outs(await msgs("W1")).some((x) => x.body.text === "Depois da espera"));
  const run = (await one(db.from("runs").select("id,status,wait_until").eq("status", "waiting").limit(5))) as any[];
  ck("9. the run is waiting", run.length === 1);
  ck("9. resuming too early does nothing", (await resumeDueRuns(db)) === 0);
  await one(db.from("runs").update({ wait_until: new Date(Date.now() - 1000).toISOString() }).eq("id", run[0].id));
  ck("9. once due, the run resumes", (await resumeDueRuns(db)) === 1);
  ck("9. and the message after the wait is queued", outs(await msgs("W1")).some((x) => x.body.text === "Depois da espera"));

  // 10 ── private reply budget
  const conv = (await one(db.from("conversations").select("id").limit(1).eq("org_id", orgId))) as any[];
  const filler = Array.from({ length: PRIVATE_REPLY_PER_HOUR }, () => ({ org_id: orgId, conversation_id: conv[0].id, channel_account_id: acc.id, direction: "out", sender: "bot", kind: "text", body: { mode: "private_reply", text: "x" }, status: "sent" }));
  await one(db.from("messages").insert(filler));
  r = await deliver(comment("H1", "MEDIA1", "guia"));
  const held = outs(await msgs("H1")).find((x) => x.kind === "text");
  ck("10. over the hourly budget, the private reply is held for later", !!held && !!held.scheduled_for && new Date(held.scheduled_for) > new Date());

  // 11 ── paused conversation
  const cB = (await one(db.from("contacts").select("id").eq("external_id", "B1").single())) as any;
  await one(db.from("conversations").update({ automation_paused_until: new Date(Date.now() + 3600_000).toISOString() }).eq("contact_id", cB.id));
  r = await deliver(dm("B1", "catalogo"));
  ck("11. a paused conversation is left to the human", r.ignored === 1);

  // 12 ── echoes and receipts never loop
  r = await deliver({ object: "instagram", entry: [{ id: IG, time: 1, messaging: [{ sender: { id: IG }, recipient: { id: "B1" }, timestamp: 1, message: { mid: `e${uid()}`, text: "our own", is_echo: true } }] }] });
  ck("12. echoes of our own messages are ignored", r.ignored === 1);
  r = await deliver({ object: "instagram", entry: [{ id: IG, time: 1, messaging: [{ sender: { id: "B1" }, recipient: { id: IG }, timestamp: 9, read: { mid: "x" } }] }] });
  ck("12. read receipts are ignored", r.ignored === 1);

  // 13 ── Messenger / Facebook page comment is routed to a Facebook trigger only
  const fbGraph = JSON.parse(JSON.stringify(wiz)) as Graph;
  const ft = fbGraph.nodes.find((x) => x.data.kind === "trigger")!;
  if (ft.data.kind === "trigger") { ft.data.source = "fb_comment"; ft.data.postId = "FBPOST"; }
  await publish("fb comment", fbGraph, fbAcc.id);
  r = await deliver({ object: "page", entry: [{ id: FB, time: 1, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: `fc${uid()}`, post_id: "FBPOST", parent_id: "FBPOST", message: "guia", from: { id: "FB1", name: "Fan" } } }] }] });
  ck("13. a Facebook Page comment starts the Facebook automation", r.processed === 1, JSON.stringify(r));
  r = await deliver({ object: "page", entry: [{ id: FB, time: 1, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: `fc${uid()}`, post_id: "FBPOST", parent_id: "someone-elses-comment", message: "guia", from: { id: "FB2", name: "Fan" } } }] }] });
  ck("13. a reply to another comment is ignored", r.ignored === 1);

  // 14 ── each message's button is its own: a new comment gets a button that works again; the same button twice does not
  const allPosts = buildGraph({ postScope: "all", postId: null, anyWord: true, keywords: [], publicReply: false, publicReplies: [], dm: { text: { "pt-BR": "Aqui" }, button: { "pt-BR": "Baixar" } }, pdf: { name: "x.pdf", size: 1, path: `${orgId}/x.pdf` }, tag: "" });
  // the earlier automations must not answer this person: make this the only comment automation
  await db.from("automations").update({ status: "paused" }).eq("org_id", orgId).neq("name", "comment flow-unused");
  await publish("all posts", allPosts);
  await deliver(comment("Z1", "POST-A", "oi"));
  const z1 = outs(await msgs("Z1")).filter((x) => x.kind === "text");
  ck("14. the first comment gets a message with a button", z1.length === 1 && !!z1[0].body.payload && /^tap:[0-9a-f-]{36}:[\w-]+:[0-9a-f-]{36}$/i.test(z1[0].body.payload), JSON.stringify(z1.map((x) => x.body.payload)));
  r = await deliver(tap("Z1", z1[0].body.payload));
  ck("14. tapping it continues the flow and queues the document", r.processed === 1 && outs(await msgs("Z1")).some((x) => x.kind === "doc" && x.body.path === `${orgId}/x.pdf`), JSON.stringify(r));
  r = await deliver(tap("Z1", z1[0].body.payload));
  ck("14. tapping the same message's button again is ignored", r.ignored === 1);
  await deliver(comment("Z1", "POST-B", "outra"));
  const z2 = outs(await msgs("Z1")).filter((x) => x.kind === "text");
  ck("14. a comment on another post gets a NEW button", z2.length === 2 && z2[0].body.payload !== z2[1].body.payload);
  r = await deliver(tap("Z1", z2[1].body.payload));
  ck("14. the new button works even though the person already tapped the first one", r.processed === 1, JSON.stringify(r));
  r = await deliver(comment("Z1", "POST-B", "de novo"));
  ck("14. a second comment on the same post is dropped and not stored", r.ignored === 1 && (await msgs("Z1")).filter((x) => x.direction === "in" && x.body.text === "de novo").length === 0);

  // nothing should be left half-done
  const stuck = (await one(db.from("webhook_events").select("id").eq("status", "received").filter("payload->>entry_id", "in", `(${IG},${FB},00000)`))) as any[];
  ck("all test events reached a final status", stuck.length === 0, `${stuck.length} still 'received'`);
  const failed = (await one(db.from("webhook_events").select("error,external_event_id").eq("status", "failed").filter("payload->>entry_id", "in", `(${IG},${FB},00000)`))) as any[];
  ck("no event failed", failed.length === 0, JSON.stringify(failed));
} catch (e) {
  console.error("ERROR", e);
  fails++;
} finally {
  if (orgId) await db.from("orgs").delete().eq("id", orgId); // cascades to everything the test created
  await db.from("webhook_events").delete().like("external_event_id", "%:%").in("provider", ["meta"]).filter("payload->>entry_id", "in", `(${IG},${FB},00000)`);
}
console.log(fails ? `\n${fails} check(s) failed` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
