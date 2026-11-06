"use client";
// Fake data layer + flow engine. Same function signatures the real backend (replica-backend) will expose,
// so swapping it in changes no screen code. State lives in memory and localStorage.
import { useSyncExternalStore } from "react";
import type { Lang } from "./i18n";
import * as remote from "./remote";
import { remoteEnabled } from "./supabase/client";
import { type PdfRef, buildGraph, isComment, matchTrigger, normalize, triggerOf, uid as fuid, type FlowAction, type FlowNode, type Graph, type PostScope, type Row } from "./flow";

export type { PostScope };
export type Status = "draft" | "live" | "paused";

export type Post = { id: string; caption: string; date: string; hue: number; kind: "post" | "reel"; net?: "instagram" | "facebook"; /** Real thumbnail (signed-in mode). */ image?: string | null };

export type Dm = {
  text: Partial<Record<Lang, string>>;
  button: Partial<Record<Lang, string>>;
};

export type Automation = {
  id: string;
  name: string;
  status: Status;
  channel: "instagram" | "messenger";
  postScope: PostScope;
  postId: string | null;
  anyWord: boolean;
  keywords: string[];
  publicReply: boolean;
  publicReplies: string[];
  dm: Dm;
  defaultLang: Lang;
  pdf: PdfRef | null;
  tag: string;
  requireFollow: boolean;
  stats: { runs: number; contacts: number; sent: number; delivered: number; read: number; clicked: number; taps: number; docs: number };
  firings: string[]; // `${contactId}:${postId}` (first comment per person per post)
  modified: number;
  /** Published graph. When absent it is derived from the wizard fields. */
  graph?: Graph;
  /** What the editor works on. Becomes `graph` on publish. */
  draftGraph?: Graph;
  /** true once the flow was edited in the canvas (the quick wizard can no longer own it). */
  custom?: boolean;
  /** Instagram account this automation belongs to (real data only). */
  accountId?: string;
  nodeHits: Record<string, number>;
  /** Default reply: when each contact last got it (for the frequency limit). */
  lastFire?: Record<string, number>;
};

export type Contact = {
  id: string;
  name: string;
  handle: string;
  language: Lang;
  tags: string[];
  subscribed: boolean;
  automationsPaused: boolean;
  optedInVia: "comment" | "ad" | "dm";
  followsAccount?: boolean;
  followers?: number;
  /** Instagram account this person talked to (real data only). */
  accountId?: string;
  windowExpiresAt: number | null; // 24h window; a private reply to a comment does NOT open it
  lastActivity: number;
};

export type Message = {
  id: string;
  kind: "text" | "doc" | "note" | "event" | "public";
  sender: "contact" | "bot" | "agent" | "system";
  text: string;
  button?: string;
  nodeId?: string;
  at: number;
  /** This message was a public comment on a post, not a direct message. */
  fromComment?: boolean;
  /** Delivery state of what we sent (real inbox only). */
  status?: "queued" | "sent" | "delivered" | "read" | "failed";
  failure?: string;
};

export type Conversation = {
  id: string;
  contactId: string;
  automationId: string | null;
  state: "open" | "closed";
  assignee: string | null;
  unread: number;
  reminderAt: number | null;
  messages: Message[];
  lastAt: number;
  accountId?: string;
};

export type Wait = { id: string; automationId: string; conversationId: string; contactId: string; nodeId: string; due: number };

export type Workspace = { id: string; name: string; role: "owner" | "admin" | "editor" | "agent" | "viewer" };
export type Portfolio = { id: string; orgId: string; name: string };
export type Account = { id: string; orgId: string; portfolioId: string | null; username: string; status: string };

export type State = {
  /** Signed-in mode: the workspaces this person is in, the portfolio connections and Instagram accounts of the active workspace, and what is selected. */
  workspaces: Workspace[];
  portfolios: Portfolio[];
  accounts: Account[];
  activeOrg: string | null;
  activeAccount: string | null;
  posts: Post[];
  automations: Automation[];
  contacts: Contact[];
  conversations: Conversation[];
  waits: Wait[];
  team: { id: string; name: string; email: string; role: "owner" | "admin" | "editor" | "agent" | "viewer" }[];
};

const now = () => Date.now();
const uid = fuid;
export const HOUR = 3600_000;

function seed(): State {
  const t = now();
  return {
    workspaces: [],
    portfolios: [],
    accounts: [],
    activeOrg: null,
    activeAccount: null,
    posts: [
      { id: "17900000000000001", caption: "New whitepaper: AI in legal research", date: "2026-10-28", hue: 215, kind: "post" },
      { id: "17900000000000002", caption: "Reel: 3 tax changes to watch in 2027", date: "2026-10-21", hue: 18, kind: "reel" },
      { id: "17900000000000003", caption: "Event recap: Legal Tech LATAM", date: "2026-10-12", hue: 160, kind: "post" },
      { id: "17900000000000004", caption: "Checklist: compliance for 2027", date: "2026-10-03", hue: 280, kind: "post" },
      { id: "11600000000000001", caption: "Facebook: webinar on e-invoicing", date: "2026-10-30", hue: 200, kind: "post", net: "facebook" },
      { id: "11600000000000002", caption: "Facebook: tax calendar 2027", date: "2026-10-18", hue: 30, kind: "post", net: "facebook" },
    ],
    automations: [
      {
        id: "a_seed1",
        name: "Whitepaper: AI in legal research",
        status: "live",
        channel: "instagram",
        postScope: "specific",
        postId: "17900000000000001",
        anyWord: false,
        keywords: ["whitepaper", "guia", "guía"],
        publicReply: true,
        publicReplies: ["Sent! Check your DMs 📩", "Enviado! Olhe suas mensagens 📩", "¡Enviado! Mirá tus mensajes 📩"],
        dm: {
          text: {
            en: "Hi! Thanks for your interest. Tap the button and we will send you the whitepaper.",
            "pt-BR": "Olá! Obrigado pelo interesse. Toque no botão e enviaremos o whitepaper.",
            "es-AR": "¡Hola! Gracias por tu interés. Tocá el botón y te enviamos el whitepaper.",
          },
          button: { en: "Send it to me", "pt-BR": "Quero receber", "es-AR": "Quiero recibirlo" },
        },
        defaultLang: "pt-BR",
        pdf: { name: "whitepaper-ai-legal.pdf", size: 3_400_000 },
        tag: "whitepaper-lead",
        requireFollow: false,
        stats: { runs: 128, contacts: 121, sent: 249, delivered: 244, read: 190, clicked: 96, taps: 96, docs: 96 },
        firings: [],
        modified: t - 26 * 60_000,
        nodeHits: {},
      },
    ],
    contacts: [],
    conversations: [],
    waits: [],
    team: [
      { id: "u1", name: "Demo Owner", email: "owner@example.com", role: "owner" },
      { id: "u2", name: "Marina Alves", email: "marina@example.com", role: "editor" },
      { id: "u3", name: "Tomás Giménez", email: "tomas@example.com", role: "agent" },
    ],
  };
}

const KEY = "tr-dm-demo-v2";
let state: State = seed();
let hydrated = false;
/** true once the data the screens need is in `state`: at once in demo mode, after the server answered otherwise. */
let ready = false;
const listeners = new Set<() => void>();

function emit() {
  if (!remoteEnabled) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  } // signed in: real people's messages never go into the browser's storage
  listeners.forEach((l) => l());
}
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = remoteEnabled ? null : localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as State;
      const fresh = seed();
      state = { ...fresh, ...p, posts: [...p.posts, ...fresh.posts.filter((sp) => !p.posts.some((x) => x.id === sp.id))], waits: p.waits ?? [], automations: p.automations.map((a) => ({ ...a, nodeHits: a.nodeHits ?? {} })) };
    }
  } catch {}
  if (!remoteEnabled) {
    ready = true;
    return;
  }
  // Signed-in mode: automations come from the server. Contacts, inbox and posts stay demo data until the
  // webhook engine exists.
  state = { ...state, automations: [], contacts: [], conversations: [], waits: [], team: [] };
  remote
    .bootstrap()
    .then(async (boot) => {
      if (boot === null) {
        hydrated = false; // signed out: try again after sign-in (see reloadStore)
        return;
      }
      state = { ...state, automations: boot.automations, workspaces: boot.workspaces, portfolios: boot.portfolios, accounts: boot.accounts, activeOrg: boot.activeOrg, activeAccount: boot.activeAccount };
      ready = true;
      await refreshInbox();
      startPolling();
    })
    .catch((e) => {
      console.error("[bootstrap]", e);
      remote.markFailed();
      ready = true; // show the app with the error banner instead of loading forever
    })
    .finally(() => listeners.forEach((l) => l()));
}
/** Picks another Instagram account in the active workspace: its automations, inbox and numbers replace the current ones. */
export function selectAccount(id: string) {
  if (!remoteEnabled || state.activeAccount === id || !state.accounts.some((a) => a.id === id)) return;
  remote.rememberAccount(id);
  state = { ...state, activeAccount: id, conversations: state.conversations.filter((c) => isDemo(c.id)), contacts: state.contacts.filter((c) => isDemo(c.id)) };
  listeners.forEach((l) => l());
  lastWrite = 0;
  void refreshInbox();
}
/** Switches workspace: everything is loaded again for it. */
export function selectOrg(id: string) {
  if (!remoteEnabled || state.activeOrg === id) return;
  remote.rememberOrg(id);
  reloadStore();
}
/** Copies an automation to another account of this workspace, as a draft. Returns the new id, or null if it failed. */
export async function copyAutomationTo(id: string, accountId: string): Promise<string | null> {
  if (!remoteEnabled) return null;
  const nid = await remote.copyAutomation(id, accountId);
  if (nid) {
    const boot = await remote.bootstrap();
    if (boot) {
      state = { ...state, automations: boot.automations };
      listeners.forEach((l) => l());
    }
  }
  return nid;
}

/** Call right after signing in: loads the new session's workspace without a full page reload. */
export function reloadStore() {
  hydrated = false;
  ready = false;
  hydrate();
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  hydrate();
  listeners.add(l);
  queueMicrotask(l);
  return () => listeners.delete(l);
}
const getSnapshot = () => state;
const SERVER_STATE = seed();
const getServerSnapshot = () => SERVER_STATE;

/** false on the server and on the first client render, true once saved data has been loaded.
 * Screens that copy store data into local state must wait for it, or they copy the seed instead. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => false);
}
/** Real data only when signed in: the test panel's demo people never show up in the real inbox. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDemo = (id: string) => !UUID.test(id);
const isReal = (id: string) => remoteEnabled && UUID.test(id);
let viewSrc: State | null = null;
let viewOut: State | null = null;
function getView(): State {
  if (!remoteEnabled) return state;
  if (viewSrc === state && viewOut) return viewOut;
  viewSrc = state;
  const acc = state.activeAccount;
  // only the selected Instagram account's automations, people and conversations; real data only
  viewOut = {
    ...state,
    automations: state.automations.filter((a) => (a.accountId ?? null) === acc),
    conversations: state.conversations.filter((c) => !isDemo(c.id) && c.accountId === acc),
    contacts: state.contacts.filter((c) => !isDemo(c.id) && c.accountId === acc),
  };
  return viewOut;
}
export function useStore(): State {
  return useSyncExternalStore(subscribe, getView, getServerSnapshot);
}
/** Everything, including the demo people the test panel creates. Only the test panel needs this. */
export function useSimStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

let lastWrite = 0;
let poller: ReturnType<typeof setInterval> | null = null;
/** Reloads the real inbox, contacts and numbers. Skipped for a few seconds after a local change so it cannot undo it. */
export async function refreshInbox() {
  if (!remoteEnabled || !ready) return;
  if (Date.now() - lastWrite < 4000) return;
  try {
    const [r, st] = await Promise.all([remote.loadInbox(), remote.loadStats()]);
    state = {
      ...state,
      conversations: [...state.conversations.filter((c) => isDemo(c.id)), ...r.conversations],
      contacts: [...state.contacts.filter((c) => isDemo(c.id)), ...r.contacts],
      team: r.team,
      automations: state.automations.map((a) => (st[a.id] ? { ...a, stats: st[a.id] } : a)),
    };
    emit();
  } catch (e) {
    console.error("[inbox]", e);
    remote.markFailed();
  }
}
function startPolling() {
  if (poller || typeof window === "undefined") return;
  poller = setInterval(() => {
    if (document.visibilityState === "visible") void refreshInbox();
  }, 10_000);
  window.addEventListener("focus", () => void refreshInbox());
}
const wrote = () => {
  lastWrite = Date.now();
};
export function resetDemo() {
  state = seed();
  emit();
}

// ---------- helpers ----------

export { normalize };
export function dmFor(a: Pick<Automation, "dm" | "defaultLang">, lang: Lang) {
  const text = a.dm.text[lang] ?? a.dm.text[a.defaultLang] ?? "";
  const button = a.dm.button[lang] ?? a.dm.button[a.defaultLang] ?? "";
  return { text, button };
}
export function windowOpen(c: Contact) {
  return !!c.windowExpiresAt && c.windowExpiresAt > now();
}

/** The graph live traffic runs on. */
export function publishedGraph(a: Automation): Graph {
  return a.graph ?? buildGraph(a);
}
/** The graph the editor and the test panel work on. */
export function editGraph(a: Automation): Graph {
  return a.draftGraph ?? publishedGraph(a);
}

function patchAutomation(id: string, f: (a: Automation) => Automation) {
  state = { ...state, automations: state.automations.map((a) => (a.id === id ? f(a) : a)) };
}
function patchConversation(id: string, f: (c: Conversation) => Conversation) {
  state = { ...state, conversations: state.conversations.map((c) => (c.id === id ? f(c) : c)) };
}
function patchContact(id: string, f: (c: Contact) => Contact) {
  state = { ...state, contacts: state.contacts.map((c) => (c.id === id ? f(c) : c)) };
}

// ---------- automations ----------

export type AutomationInput = Omit<Automation, "id" | "stats" | "firings" | "modified" | "status" | "channel" | "nodeHits" | "graph" | "draftGraph" | "custom" | "lastFire"> & { status?: Status };

export function saveAutomation(input: AutomationInput, id?: string): Automation {
  if (id) {
    patchAutomation(id, (a) => ({ ...a, ...input, status: input.status ?? a.status, graph: undefined, draftGraph: undefined, custom: false, channel: "instagram", modified: now() }));
    emit();
    if (remoteEnabled) void remote.saveWizard(id, { ...input, status: input.status ?? state.automations.find((a) => a.id === id)!.status }, false);
    return state.automations.find((a) => a.id === id)!;
  }
  const a: Automation = {
    ...input,
    id: remoteEnabled ? crypto.randomUUID() : uid("a"),
    status: input.status ?? "draft",
    channel: "instagram",
    accountId: remoteEnabled ? state.activeAccount ?? undefined : undefined,
    stats: { runs: 0, contacts: 0, sent: 0, delivered: 0, read: 0, clicked: 0, taps: 0, docs: 0 },
    firings: [],
    modified: now(),
    nodeHits: {},
  };
  state = { ...state, automations: [a, ...state.automations] };
  emit();
  if (remoteEnabled) void remote.saveWizard(a.id, { ...input, status: a.status }, true);
  return a;
}
export function setAutomationStatus(id: string, status: Status) {
  patchAutomation(id, (a) => ({ ...a, status, modified: now() }));
  emit();
  if (remoteEnabled) void remote.setStatus(id, status);
}
export function renameAutomation(id: string, name: string) {
  patchAutomation(id, (a) => ({ ...a, name, modified: now() }));
  emit();
  if (remoteEnabled) void remote.rename(id, name);
}
/** Autosave from the editor: only touches the draft. */
export function saveDraftGraph(id: string, g: Graph) {
  patchAutomation(id, (a) => ({ ...a, draftGraph: g, custom: true, modified: now() }));
  emit();
  if (remoteEnabled) remote.saveDraft(id, g);
}
export function discardDraft(id: string) {
  const a = state.automations.find((x) => x.id === id);
  patchAutomation(id, (x) => ({ ...x, draftGraph: undefined }));
  emit();
  if (remoteEnabled && a) void remote.discardDraft(id, publishedGraph(a));
}
/** Publish = the draft becomes the version live traffic runs on. Validation happens in the UI first. */
export function publishDraft(id: string) {
  patchAutomation(id, (a) => {
    const g = a.draftGraph ?? publishedGraph(a);
    const trig = g.nodes.find((n) => n.data.kind === "trigger")?.data;
    return {
      ...a,
      graph: g,
      draftGraph: undefined,
      custom: true,
      status: "live",
      modified: now(),
      ...(trig && trig.kind === "trigger" ? { channel: triggerOf(trig).channel, postScope: trig.postScope, postId: trig.postId, anyWord: trig.anyWord, keywords: trig.keywords } : {}),
    };
  });
  emit();
  if (remoteEnabled) void remote.publish(id);
}
export function hasUnpublished(a: Automation) {
  return !!a.draftGraph && JSON.stringify(a.draftGraph) !== JSON.stringify(a.graph ?? buildGraph(a));
}

// ---------- engine ----------

type Ctx = { privateReplyUsed: boolean; steps: number };
let clock = 0;
const tick = () => now() + clock++ % 1000;

function bump(aId: string, s: Partial<Automation["stats"]>) {
  patchAutomation(aId, (a) => {
    const st = { ...a.stats };
    for (const [k, v] of Object.entries(s)) st[k as keyof typeof st] += v as number;
    return { ...a, stats: st };
  });
}
function hit(aId: string, nodeId: string) {
  patchAutomation(aId, (a) => ({ ...a, nodeHits: { ...a.nodeHits, [nodeId]: (a.nodeHits[nodeId] ?? 0) + 1 } }));
}
function push(convId: string, msgs: Message[]) {
  patchConversation(convId, (c) => ({ ...c, messages: [...c.messages, ...msgs], lastAt: msgs[msgs.length - 1].at, unread: c.unread + msgs.filter((m) => m.sender === "contact").length }));
}
const getContact = (id: string) => state.contacts.find((c) => c.id === id)!;

export function evalRow(r: Row, c: Contact): boolean {
  const v = r.value.trim();
  const has = (b: boolean) => (r.op === "isnot" ? !b : b);
  switch (r.field) {
    case "tag":
      return has(c.tags.some((t) => normalize(t) === normalize(v)));
    case "language":
      return has(c.language === v);
    case "follows":
      return has(!!c.followsAccount === (v === "true"));
    case "optin":
      return has(c.optedInVia === v);
    case "windowOpen":
      return has(windowOpen(c) === (v === "true"));
    case "followers": {
      const n = c.followers ?? 0;
      const x = Number(v);
      return r.op === "gt" ? n > x : r.op === "lt" ? n < x : n === x;
    }
    case "hour": {
      const n = new Date().getHours();
      const x = Number(v);
      return r.op === "gt" ? n > x : r.op === "lt" ? n < x : n === x;
    }
  }
}

function applyAction(a: Automation, convId: string, contactId: string, act: FlowAction) {
  const v = (act.value ?? "").trim();
  switch (act.type) {
    case "addTag":
      patchContact(contactId, (c) => (v && !c.tags.includes(v) ? { ...c, tags: [...c.tags, v] } : c));
      break;
    case "removeTag":
      patchContact(contactId, (c) => ({ ...c, tags: c.tags.filter((t) => normalize(t) !== normalize(v)) }));
      break;
    case "pause":
      patchContact(contactId, (c) => ({ ...c, automationsPaused: true }));
      break;
    case "unsubscribe":
      patchContact(contactId, (c) => ({ ...c, subscribed: false }));
      break;
    case "assign":
      patchConversation(convId, (c) => ({ ...c, assignee: v || null }));
      break;
    case "notify":
      push(convId, [{ id: uid("m"), kind: "event", sender: "system", text: `🔔 ${v}`, at: tick() }]);
      break;
  }
}

function visit(aId: string, g: Graph, convId: string, contactId: string, node: FlowNode, ctx: Ctx) {
  if (ctx.steps++ > 40) return;
  const a = state.automations.find((x) => x.id === aId)!;
  hit(aId, node.id);
  const d = node.data;
  const follow = (handle: string) => {
    for (const e of g.edges.filter((x) => x.source === node.id && x.sourceHandle === handle)) {
      const nx = g.nodes.find((n) => n.id === e.target);
      if (nx) visit(aId, g, convId, contactId, nx, ctx);
    }
  };
  const contact = getContact(contactId);
  switch (d.kind) {
    case "trigger":
      return follow("next");
    case "public": {
      const tn = g.nodes.find((n) => n.data.kind === "trigger")?.data;
      if (tn && tn.kind === "trigger" && !isComment(triggerOf(tn).source)) return follow("next"); // nothing to reply to publicly
      const list = d.replies.filter(Boolean);
      if (list.length) {
        push(convId, [{ id: uid("m"), kind: "public", sender: "bot", text: list[(a.nodeHits[node.id] ?? 0) % list.length], nodeId: node.id, at: tick() }]);
        bump(aId, { sent: 1, delivered: 1 });
      }
      return follow("next");
    }
    case "message": {
      const lang = contact.language;
      const text = d.text[lang] || d.text[a.defaultLang] || "";
      const button = d.button[lang] || d.button[a.defaultLang] || "";
      const open = windowOpen(contact);
      const asPrivateReply = !open && !ctx.privateReplyUsed && !d.pdf;
      if (!open && !asPrivateReply) {
        push(convId, [{ id: uid("m"), kind: "event", sender: "system", text: "inbox.system.blocked", at: tick() }]);
        return;
      }
      if (asPrivateReply) ctx.privateReplyUsed = true;
      const msgs: Message[] = [];
      if (text) msgs.push({ id: uid("m"), kind: "text", sender: "bot", text, button: button || undefined, nodeId: node.id, at: tick() });
      if (d.pdf) msgs.push({ id: uid("m"), kind: "doc", sender: "bot", text: d.pdf.name, nodeId: node.id, at: tick() });
      if (msgs.length) {
        push(convId, msgs);
        bump(aId, { sent: msgs.length, delivered: msgs.length, docs: d.pdf ? 1 : 0 });
      }
      return follow("next"); // "tap" continues when the person taps (simulateTap)
    }
    case "condition": {
      const results = d.rows.map((r) => evalRow(r, getContact(contactId)));
      const ok = d.mode === "all" ? results.every(Boolean) : results.some(Boolean);
      return follow(ok ? "yes" : "no");
    }
    case "actions": {
      d.items.forEach((i) => applyAction(a, convId, contactId, i));
      return follow("next");
    }
    case "randomizer": {
      let r = Math.random() * d.paths.reduce((x, y) => x + y, 0);
      let idx = 0;
      for (let i = 0; i < d.paths.length; i++) {
        if (r < d.paths[i]) {
          idx = i;
          break;
        }
        r -= d.paths[i];
      }
      return follow(`p${idx}`);
    }
    case "delay": {
      state = { ...state, waits: [...state.waits, { id: uid("w"), automationId: aId, conversationId: convId, contactId, nodeId: node.id, due: now() + d.minutes * 60_000 }] };
      push(convId, [{ id: uid("m"), kind: "event", sender: "system", text: "inbox.system.waiting", at: tick() }]);
      return;
    }
  }
}

export type SimResult = "ok" | "nomatch" | "dup" | "inactive" | "handled" | "freq";
export type Who = { handle: string; language: Lang; follows?: boolean; followers?: number; optin?: "comment" | "ad" };
/** What the person did: the text they wrote, plus the post or ad it came from. */
export type SimInput = { text: string; postId?: string | null; adId?: string };

export function simulateComment(automationId: string, who: Who, comment: string) {
  return simulateEvent(automationId, who, { text: comment });
}

/** Runs the automation's trigger as if the person had done what `input` says. Works for every trigger source. */
export function simulateEvent(automationId: string, who: Who, input: SimInput): { result: SimResult; conversationId?: string } {
  const a = state.automations.find((x) => x.id === automationId);
  if (!a) return { result: "inactive" };
  const g = editGraph(a);
  const trig = g.nodes.find((n) => n.data.kind === "trigger");
  if (!trig || trig.data.kind !== "trigger") return { result: "inactive" };
  const tt = triggerOf(trig.data);
  const comment = isComment(tt.source);

  if (comment && trig.data.postScope === "specific" && trig.data.postId && input.postId && input.postId !== trig.data.postId) return { result: "nomatch" };
  if (tt.source === "ad" && tt.adId && (input.adId ?? "").trim() !== tt.adId) return { result: "nomatch" };
  if (!matchTrigger(trig.data, input.text)) return { result: "nomatch" };
  if (tt.source === "default_reply") {
    // another live automation that listens for this word wins
    const taken = state.automations.some((o) => {
      if (o.id === a.id || o.status !== "live") return false;
      const t2 = publishedGraph(o).nodes.find((n) => n.data.kind === "trigger")?.data;
      if (!t2 || t2.kind !== "trigger") return false;
      const x = triggerOf(t2);
      return x.source === "dm_keyword" && x.channel === tt.channel && matchTrigger(t2, input.text);
    });
    if (taken) return { result: "handled" };
  }

  const handle = who.handle.replace(/^@/, "").trim() || "visitante";
  let contact = state.contacts.find((c) => c.handle === handle && isDemo(c.id));
  const optedInVia: Contact["optedInVia"] = tt.source === "ad" ? "ad" : comment ? (who.optin ?? "comment") : "dm";
  const extra = { followsAccount: !!who.follows, followers: who.followers ?? 0, optedInVia };
  if (!contact) {
    contact = {
      id: uid("c"),
      name: handle,
      handle,
      language: who.language,
      tags: [],
      subscribed: true,
      automationsPaused: false,
      windowExpiresAt: null,
      lastActivity: now(),
      ...extra,
    };
    state = { ...state, contacts: [contact, ...state.contacts] };
  } else {
    patchContact(contact.id, (c) => ({ ...c, language: who.language, ...extra }));
  }
  contact = getContact(contact.id);
  if (!contact.subscribed || contact.automationsPaused) return { result: "inactive" };

  // Comments fire once per person per post. A default reply respects its frequency. Everything else fires every time.
  const firing = `${contact.id}:${trig.data.postId ?? trig.data.postScope}`;
  if (comment && a.firings.includes(firing)) return { result: "dup" };
  const last = a.lastFire?.[contact.id];
  if (tt.source === "default_reply" && last && now() - last < tt.frequencyHours * HOUR) return { result: "freq" };

  const t = tick();
  const existing = state.conversations.find((c) => c.contactId === contact!.id);
  const convId = existing?.id ?? uid("v");
  const first: Message[] = [
    { id: uid("m"), kind: "event", sender: "system", text: comment ? "inbox.system.opened" : "inbox.system.openedDm", at: t },
    { id: uid("m"), kind: "text", sender: "contact", text: input.text, at: t + 1 },
  ];
  if (existing) {
    patchConversation(existing.id, (c) => ({ ...c, state: "open", automationId: a.id }));
    push(existing.id, first);
  } else {
    state = {
      ...state,
      conversations: [{ id: convId, contactId: contact.id, automationId: a.id, state: "open", assignee: null, unread: 1, reminderAt: null, messages: first, lastAt: t }, ...state.conversations],
    };
  }
  patchAutomation(a.id, (x) => ({
    ...x,
    firings: comment ? [...x.firings, firing] : x.firings,
    lastFire: tt.source === "default_reply" ? { ...(x.lastFire ?? {}), [contact!.id]: now() } : x.lastFire,
    stats: { ...x.stats, runs: x.stats.runs + 1, contacts: x.stats.contacts + 1 },
  }));
  // Writing first opens the 24-hour window. A comment does not (a private reply is the only message allowed).
  patchContact(contact.id, (c) => ({ ...c, lastActivity: t, windowExpiresAt: comment ? c.windowExpiresAt : t + 24 * HOUR }));
  visit(a.id, g, convId, contact.id, trig, { privateReplyUsed: false, steps: 0 });
  emit();
  return { result: "ok", conversationId: convId };
}

/** The contact taps the DM button: opens the 24h window and the flow continues from that button. */
export function simulateTap(conversationId: string) {
  const conv = state.conversations.find((c) => c.id === conversationId);
  if (!conv) return;
  const a = state.automations.find((x) => x.id === conv.automationId);
  const contact = state.contacts.find((c) => c.id === conv.contactId);
  if (!a || !contact) return;
  const last = [...conv.messages].reverse().find((m) => m.button && m.nodeId);
  if (!last) return;
  const g = editGraph(a);
  const node = g.nodes.find((n) => n.id === last.nodeId);
  const t = tick();
  push(conv.id, [{ id: uid("m"), kind: "text", sender: "contact", text: last.button!, at: t }]);
  patchContact(contact.id, (c) => ({ ...c, windowExpiresAt: t + 24 * HOUR, lastActivity: t }));
  bump(a.id, { taps: 1, clicked: 1, read: 1 });
  if (node && !getContact(contact.id).automationsPaused) {
    const ctx: Ctx = { privateReplyUsed: true, steps: 0 };
    for (const e of g.edges.filter((x) => x.source === node.id && x.sourceHandle === "tap")) {
      const nx = g.nodes.find((n) => n.id === e.target);
      if (nx) visit(a.id, g, conv.id, contact.id, nx, ctx);
    }
  }
  emit();
}

/** Test helper: run every waiting step now instead of waiting. Returns how many ran. */
export function fastForwardWaits(): number {
  const list = state.waits;
  state = { ...state, waits: [] };
  for (const w of list) {
    const a = state.automations.find((x) => x.id === w.automationId);
    if (!a) continue;
    const g = editGraph(a);
    const node = g.nodes.find((n) => n.id === w.nodeId);
    if (!node) continue;
    const ctx: Ctx = { privateReplyUsed: false, steps: 0 };
    for (const e of g.edges.filter((x) => x.source === node.id && x.sourceHandle === "next")) {
      const nx = g.nodes.find((n) => n.id === e.target);
      if (nx) visit(a.id, g, w.conversationId, w.contactId, nx, ctx);
    }
  }
  emit();
  return list.length;
}

// ---------- inbox ----------

export function sendAgentMessage(conversationId: string, text: string): { ok: boolean; reason?: "window" } {
  const conv = state.conversations.find((c) => c.id === conversationId);
  const contact = conv && state.contacts.find((c) => c.id === conv.contactId);
  if (!conv || !contact) return { ok: false };
  if (!windowOpen(contact)) return { ok: false, reason: "window" };
  const t = tick();
  const msgs: Message[] = [{ id: uid("m"), kind: "text", sender: "agent", text, at: t }];
  if (!contact.automationsPaused) msgs.unshift({ id: uid("m"), kind: "event", sender: "system", text: "inbox.system.paused", at: t - 1 });
  patchConversation(conv.id, (c) => ({ ...c, messages: [...c.messages, ...msgs.map((m) => (m.sender === "agent" ? { ...m, status: "queued" as const } : m))], lastAt: t, unread: 0 }));
  patchContact(contact.id, (c) => ({ ...c, automationsPaused: true, lastActivity: t }));
  emit();
  if (isReal(conv.id)) {
    wrote();
    void remote.sendAgentRemote(conv.id, text);
  }
  return { ok: true };
}
export function addNote(conversationId: string, text: string) {
  patchConversation(conversationId, (c) => ({
    ...c,
    messages: [...c.messages, { id: uid("m"), kind: "note", sender: "agent", text, at: tick() }],
  }));
  emit();
  if (isReal(conversationId)) {
    wrote();
    void remote.addNoteRemote(conversationId, text);
  }
}
export function markRead(conversationId: string) {
  const c = state.conversations.find((x) => x.id === conversationId);
  if (!c || c.unread === 0) return;
  patchConversation(conversationId, (x) => ({ ...x, unread: 0 }));
  emit();
  if (isReal(conversationId)) {
    wrote();
    void remote.setUnread0(conversationId);
  }
}
export function setConversationState(id: string, s: "open" | "closed") {
  patchConversation(id, (c) => ({ ...c, state: s }));
  emit();
  if (isReal(id)) {
    wrote();
    void remote.setConvState(id, s);
  }
}
export function assignConversation(id: string, userId: string | null) {
  patchConversation(id, (c) => ({ ...c, assignee: userId }));
  emit();
  if (isReal(id)) {
    wrote();
    void remote.setAssignee(id, userId);
  }
}
export function setReminder(id: string, at: number | null) {
  patchConversation(id, (c) => ({ ...c, reminderAt: at }));
  emit();
  if (isReal(id)) {
    wrote();
    void remote.setReminderAt(id, at);
  }
}

// ---------- contacts ----------

export function addTag(contactId: string, tag: string) {
  const v = tag.trim();
  if (!v) return;
  patchContact(contactId, (c) => (c.tags.includes(v) ? c : { ...c, tags: [...c.tags, v] }));
  emit();
  if (isReal(contactId)) {
    wrote();
    void remote.addTagRemote(contactId, v);
  }
}
export function removeTag(contactId: string, tag: string) {
  patchContact(contactId, (c) => ({ ...c, tags: c.tags.filter((t) => t !== tag) }));
  emit();
  if (isReal(contactId)) {
    wrote();
    void remote.removeTagRemote(contactId, tag);
  }
}
export function setAutomationsPaused(contactId: string, paused: boolean) {
  patchContact(contactId, (c) => ({ ...c, automationsPaused: paused }));
  emit();
  if (isReal(contactId)) {
    wrote();
    void remote.setPausedForContact(contactId, paused);
  }
}
export function setSubscribed(contactId: string, v: boolean) {
  patchContact(contactId, (c) => ({ ...c, subscribed: v }));
  emit();
  if (isReal(contactId)) {
    wrote();
    void remote.setContactStatus(contactId, v ? "subscribed" : "unsubscribed");
  }
}
