"use client";
// Supabase side of the data layer. store.ts calls these after it has updated its own state, so screens stay
// instant and the database follows. Only runs when the Supabase keys are set (see supabase/client.ts).
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase/client";
import { buildGraph, triggerOf, type Graph } from "./flow";
import type { Lang } from "./i18n";
import type { Automation, AutomationInput } from "./store";

// ---------- sync status (shown as a banner when something did not reach the server) ----------

let failed = false;
let pending = 0;
const watchers = new Set<() => void>();
const ping = () => watchers.forEach((w) => w());
export function useSyncFailed(): boolean {
  return useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => failed,
    () => false,
  );
}
export function markFailed() {
  failed = true;
  ping();
}
/** Runs a server write, remembers whether it failed. Never throws: the UI already shows the local change. */
async function track<T>(job: () => PromiseLike<{ data?: T | null; error: unknown }>): Promise<T | null> {
  pending++;
  try {
    const { data, error } = await job();
    if (error) throw error;
    failed = false;
    return (data ?? null) as T | null;
  } catch (e) {
    console.error("[sync]", e);
    failed = true;
    return null;
  } finally {
    pending--;
    ping();
  }
}

// ---------- rows <-> app objects ----------

type Row = {
  id: string;
  name: string;
  status: "draft" | "live" | "paused" | "archived";
  draft_graph: Graph;
  has_unpublished_changes: boolean;
  wizard: Omit<AutomationInput, "status"> | null;
  custom: boolean;
  default_language: Lang;
  updated_at: string;
  channel_account_id: string | null;
  live: { graph: Graph } | null;
};

const COLS = "id,name,status,draft_graph,has_unpublished_changes,wizard,custom,default_language,updated_at,channel_account_id,live:automation_versions!automations_live_version_fk(graph)";

function fromRow(r: Row): Automation {
  const g = r.live?.graph ?? r.draft_graph;
  const tn = g?.nodes?.find((n) => n.data.kind === "trigger")?.data;
  const trig = tn && tn.kind === "trigger" ? tn : null;
  const w = r.wizard;
  return {
    id: r.id,
    name: r.name,
    status: r.status === "archived" ? "paused" : r.status,
    channel: trig ? triggerOf(trig).channel : "instagram",
    postScope: w?.postScope ?? trig?.postScope ?? "specific",
    postId: w?.postId ?? trig?.postId ?? null,
    anyWord: w?.anyWord ?? trig?.anyWord ?? false,
    keywords: w?.keywords ?? trig?.keywords ?? [],
    publicReply: w?.publicReply ?? true,
    publicReplies: w?.publicReplies ?? [],
    dm: w?.dm ?? { text: {}, button: {} },
    defaultLang: r.default_language,
    pdf: w?.pdf ?? null,
    tag: w?.tag ?? "",
    requireFollow: w?.requireFollow ?? false,
    // numbers will come from the events table once the real engine runs; zero until then
    stats: { runs: 0, contacts: 0, sent: 0, delivered: 0, read: 0, clicked: 0, taps: 0, docs: 0 },
    firings: [],
    modified: Date.parse(r.updated_at),
    graph: r.live?.graph,
    draftGraph: r.has_unpublished_changes ? r.draft_graph : undefined,
    custom: r.custom,
    accountId: r.channel_account_id ?? undefined,
    nodeHits: {},
  };
}

// ---------- workspace ----------

let orgId: string | null = null;
let accountId: string | null = null;
export const currentOrgId = () => orgId;
export const currentAccountId = () => accountId;

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const ORG_KEY = "tr-dm-org";
const acctKey = (org: string) => `tr-dm-account:${org}`;

export type Boot = { workspaces: Workspace[]; portfolios: Portfolio[]; accounts: Account[]; activeOrg: string; activeAccount: string | null; automations: Automation[] };

/** Signed-in user's workspaces, the connections and accounts of the active one, and the active account's automations.
 *  Returns null when nobody is signed in (the login page): the caller tries again after sign-in. */
export async function bootstrap(): Promise<Boot | null> {
  const sb = supabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const mem = await sb.from("org_members").select("org_id,role,orgs(name)").order("created_at");
  if (mem.error) throw mem.error;
  let workspaces: Workspace[] = (mem.data ?? []).map((m) => ({ id: m.org_id as string, name: String((m.orgs as unknown as { name?: string } | null)?.name ?? "Workspace"), role: m.role as Workspace["role"] }));
  if (!workspaces.length) {
    const created = await sb.rpc("create_org", { p_name: "TR Marketing" });
    if (created.error) throw created.error;
    workspaces = [{ id: created.data as string, name: "TR Marketing", role: "owner" }];
  }
  const saved = lsGet(ORG_KEY);
  orgId = (workspaces.find((w) => w.id === saved) ?? workspaces[0]).id;

  const [pf, ac] = await Promise.all([
    sb.from("portfolio_connections").select("id,org_id,name").eq("org_id", orgId).order("created_at"),
    sb.from("channel_accounts").select("id,org_id,portfolio_id,display_name,status").eq("org_id", orgId).neq("status", "disconnected").order("created_at"),
  ]);
  if (pf.error) throw pf.error;
  if (ac.error) throw ac.error;
  const portfolios: Portfolio[] = (pf.data ?? []).map((p) => ({ id: p.id as string, orgId: p.org_id as string, name: p.name as string }));
  const accounts: Account[] = (ac.data ?? []).map((c) => ({ id: c.id as string, orgId: c.org_id as string, portfolioId: (c.portfolio_id as string) ?? null, username: c.display_name as string, status: c.status as string }));
  const savedAcc = lsGet(acctKey(orgId));
  accountId = (accounts.find((a) => a.id === savedAcc) ?? accounts.find((a) => a.status === "connected") ?? accounts[0])?.id ?? null;

  const rows = await sb.from("automations").select(COLS).eq("org_id", orgId).neq("status", "archived").order("updated_at", { ascending: false });
  if (rows.error) throw rows.error;
  return { workspaces, portfolios, accounts, activeOrg: orgId, activeAccount: accountId, automations: (rows.data as unknown as Row[]).map(fromRow) };
}

/** Remembers the choice in this browser only; the store reloads the data. */
export function rememberOrg(id: string) {
  lsSet(ORG_KEY, id);
}
export function rememberAccount(id: string) {
  accountId = id;
  if (orgId) lsSet(acctKey(orgId), id);
}

/** Copies an automation (as a draft) to another account of the same workspace. Returns the new id. */
export async function copyAutomation(id: string, toAccount: string): Promise<string | null> {
  const r = await track(() => supabase().rpc("copy_automation", { p_id: id, p_account: toAccount }));
  return (r?.data as string | null) ?? null;
}

// ---------- writes ----------

const draftTimers = new Map<string, { t: ReturnType<typeof setTimeout>; g: Graph }>();

/** Saves the draft graph a moment after the last edit, so dragging a node is not one request per pixel. */
export function saveDraft(id: string, g: Graph) {
  const old = draftTimers.get(id);
  if (old) clearTimeout(old.t);
  draftTimers.set(id, { g, t: setTimeout(() => void flushDraft(id), 700) });
}
export async function flushDraft(id: string) {
  const e = draftTimers.get(id);
  if (!e) return;
  clearTimeout(e.t);
  draftTimers.delete(id);
  await track(() => supabase().from("automations").update({ draft_graph: e.g, has_unpublished_changes: true, custom: true, wizard: null }).eq("id", id));
}
if (typeof window !== "undefined") window.addEventListener("pagehide", () => [...draftTimers.keys()].forEach((id) => void flushDraft(id)));

export async function discardDraft(id: string, live: Graph) {
  const e = draftTimers.get(id);
  if (e) clearTimeout(e.t);
  draftTimers.delete(id);
  await track(() => supabase().from("automations").update({ draft_graph: live, has_unpublished_changes: false }).eq("id", id));
}

export async function publish(id: string) {
  await flushDraft(id);
  await track(() => supabase().rpc("publish_automation", { p_id: id }));
}

export async function rename(id: string, name: string) {
  await track(() => supabase().from("automations").update({ name }).eq("id", id));
}
export async function setStatus(id: string, status: "draft" | "live" | "paused") {
  await track(() => supabase().from("automations").update({ status }).eq("id", id));
}

/** Quick wizard save: the wizard fields plus the graph they produce. `live` publishes it right away. */
export async function saveWizard(id: string, input: AutomationInput, isNew: boolean) {
  if (!orgId || (isNew && !accountId)) return markFailed(); // a new automation always belongs to the selected account
  const { status, ...wizard } = input;
  const row = {
    name: input.name,
    languages: [input.defaultLang],
    default_language: input.defaultLang,
    draft_graph: buildGraph(input),
    has_unpublished_changes: false,
    wizard,
    custom: false,
    status: status === "live" ? "draft" : (status ?? "draft"),
  };
  await flushDraft(id);
  const res = await track(() => (isNew ? supabase().from("automations").insert({ id, org_id: orgId, channel_account_id: accountId, ...row }) : supabase().from("automations").update(row).eq("id", id)));
  if (res === null && failed) return;
  if (status === "live") await track(() => supabase().rpc("publish_automation", { p_id: id }));
}

// ---------------------------------------------------------------- inbox and contacts

import { mapContact, mapConversation } from "./inbox-map";
import type { Account, Contact, Conversation, Portfolio, State, Workspace } from "./store";

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Recent conversations, their contacts, tags, messages and notes, and the team. Reads go through row level security. */
export async function loadInbox(): Promise<{ contacts: Contact[]; conversations: Conversation[]; team: State["team"] }> {
  const sb = supabase();
  const acc = accountId ?? "00000000-0000-0000-0000-000000000000"; // no account selected: nothing to show
  const convs = ((await sb.from("conversations").select("*").eq("channel_account_id", acc).order("last_message_at", { ascending: false, nullsFirst: false }).limit(200)).data ?? []) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const contacts = ((await sb.from("contacts").select("*").eq("channel_account_id", acc).order("last_interaction_at", { ascending: false, nullsFirst: false }).limit(500)).data ?? []) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const convIds = convs.map((c) => c.id as string);
  const contactIds = contacts.map((c) => c.id as string);

  const tagRows: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const part of chunks(contactIds, 100)) tagRows.push(...(((await sb.from("contact_tags").select("contact_id,tags(name)").in("contact_id", part)).data ?? []) as any[])); // eslint-disable-line @typescript-eslint/no-explicit-any
  const msgRows: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const noteRows: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const part of chunks(convIds, 50)) {
    msgRows.push(...(((await sb.from("messages").select("id,conversation_id,direction,sender,kind,body,status,failure_reason,created_at,automation_id,node_id").in("conversation_id", part).order("created_at", { ascending: false }).limit(1500)).data ?? []) as any[])); // eslint-disable-line @typescript-eslint/no-explicit-any
    noteRows.push(...(((await sb.from("conversation_notes").select("id,conversation_id,body,created_at").in("conversation_id", part)).data ?? []) as any[])); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  const team = ((await sb.rpc("org_team")).data ?? []) as { user_id: string; email: string; role: string }[];

  const tagsOf = new Map<string, string[]>();
  for (const r of tagRows) if (r.tags?.name) tagsOf.set(r.contact_id, [...(tagsOf.get(r.contact_id) ?? []), r.tags.name]);
  const pausedOf = new Map<string, string | null>(convs.map((c) => [c.contact_id as string, c.automation_paused_until as string | null]));
  const msgsOf = new Map<string, any[]>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const m of msgRows) msgsOf.set(m.conversation_id, [...(msgsOf.get(m.conversation_id) ?? []), m]);
  const notesOf = new Map<string, any[]>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const n of noteRows) notesOf.set(n.conversation_id, [...(notesOf.get(n.conversation_id) ?? []), n]);

  return {
    contacts: contacts.map((c) => mapContact(c, tagsOf.get(c.id) ?? [], pausedOf.get(c.id) ?? null)),
    // messages came newest first; the mapper sorts, but "latest automation" wants them oldest first
    conversations: convs.map((c) => mapConversation(c, [...(msgsOf.get(c.id) ?? [])].reverse(), notesOf.get(c.id) ?? [])),
    team: team.map((t) => ({ id: t.user_id, name: t.email.split("@")[0], email: t.email, role: t.role as State["team"][number]["role"] })),
  };
}

export async function loadStats(): Promise<Record<string, Automation["stats"]>> {
  const { data } = await supabase().rpc("automation_stats");
  const out: Record<string, Automation["stats"]> = {};
  for (const r of (data ?? []) as { automation_id: string; runs: number; contacts: number; sent: number; taps: number; docs: number }[]) {
    out[r.automation_id] = { runs: Number(r.runs), contacts: Number(r.contacts), sent: Number(r.sent), delivered: Number(r.sent), read: 0, clicked: Number(r.taps), taps: Number(r.taps), docs: Number(r.docs) };
  }
  return out;
}

export const setUnread0 = (convId: string) => track(() => supabase().from("conversations").update({ unread_count: 0 }).eq("id", convId));
export const setConvState = (convId: string, state: "open" | "closed") => track(() => supabase().from("conversations").update({ state }).eq("id", convId));
export const setAssignee = (convId: string, userId: string | null) => track(() => supabase().from("conversations").update({ assignee_id: userId }).eq("id", convId));
export const setReminderAt = (convId: string, at: number | null) => track(() => supabase().from("conversations").update({ reminder_at: at ? new Date(at).toISOString() : null }).eq("id", convId));
export const setContactStatus = (contactId: string, status: "subscribed" | "unsubscribed") => track(() => supabase().from("contacts").update({ status }).eq("id", contactId));
export const setPausedForContact = (contactId: string, paused: boolean) =>
  track(() => supabase().from("conversations").update({ automation_paused_until: paused ? new Date(Date.now() + 7 * 24 * 3600_000).toISOString() : null }).eq("contact_id", contactId));

export async function addNoteRemote(convId: string, body: string) {
  const sb = supabase();
  const { data: auth } = await sb.auth.getUser();
  const { data: conv } = await sb.from("conversations").select("org_id").eq("id", convId).maybeSingle();
  if (!auth.user || !conv) return markFailed();
  await track(() => sb.from("conversation_notes").insert({ org_id: conv.org_id, conversation_id: convId, author_id: auth.user!.id, body }));
}

export async function addTagRemote(contactId: string, name: string) {
  const sb = supabase();
  const { data: c } = await sb.from("contacts").select("org_id").eq("id", contactId).maybeSingle();
  if (!c) return markFailed();
  let tag = (await sb.from("tags").select("id").eq("org_id", c.org_id).eq("name", name).maybeSingle()).data;
  if (!tag) tag = (await sb.from("tags").insert({ org_id: c.org_id, name }).select("id").maybeSingle()).data ?? (await sb.from("tags").select("id").eq("org_id", c.org_id).eq("name", name).maybeSingle()).data;
  if (!tag) return markFailed();
  await track(() => sb.from("contact_tags").upsert({ contact_id: contactId, tag_id: tag!.id, org_id: c.org_id }, { onConflict: "contact_id,tag_id", ignoreDuplicates: true }));
}

export async function removeTagRemote(contactId: string, name: string) {
  const sb = supabase();
  const { data: c } = await sb.from("contacts").select("org_id").eq("id", contactId).maybeSingle();
  if (!c) return markFailed();
  const tag = (await sb.from("tags").select("id").eq("org_id", c.org_id).eq("name", name).maybeSingle()).data;
  if (tag) await track(() => sb.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", tag.id));
}

/** An agent's reply: queued like any other message, automations for this person pause, then ask the server to send now. */
export async function sendAgentRemote(convId: string, text: string) {
  const sb = supabase();
  const { data: auth } = await sb.auth.getUser();
  const { data: conv } = await sb.from("conversations").select("org_id,channel_account_id,contact_id").eq("id", convId).maybeSingle();
  const { data: contact } = conv ? await sb.from("contacts").select("external_id").eq("id", conv.contact_id).maybeSingle() : { data: null };
  if (!auth.user || !conv || !contact) return markFailed();
  const ins = await track(() => sb.from("messages").insert({ org_id: conv.org_id, conversation_id: convId, channel_account_id: conv.channel_account_id, direction: "out", sender: "agent", sender_user_id: auth.user!.id, kind: "text", body: { text, mode: "window", recipient: { id: contact.external_id } }, status: "queued" }));
  if (ins === null && failed) return;
  await setPausedForContact(conv.contact_id, true);
  void fetch("/api/messages/flush", { method: "POST" }).catch(() => undefined);
}


// ---------------------------------------------------------------- documents

import type { PdfRef } from "./flow";

/** Uploads a PDF to the workspace's private storage folder. Checks the real file header, not only the name. */
export async function uploadPdf(file: File): Promise<PdfRef> {
  if (!orgId) throw new Error("no workspace");
  const head = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (!head.startsWith("%PDF")) throw new Error("notpdf");
  const sb = supabase();
  const path = `${orgId}/${crypto.randomUUID()}.pdf`;
  const up = await sb.storage.from("assets").upload(path, file, { contentType: "application/pdf", upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data: auth } = await sb.auth.getUser();
  await sb.from("assets").insert({ org_id: orgId, kind: "pdf", file_name: file.name.slice(0, 200), mime_type: "application/pdf", size_bytes: file.size, storage_path: path, uploaded_by: auth.user?.id ?? null });
  return { name: file.name, size: file.size, path };
}
