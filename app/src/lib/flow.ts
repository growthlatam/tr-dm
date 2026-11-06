import type { Key, Lang } from "./i18n";

export type PostScope = "specific" | "all" | "next";

/** What starts a flow. Comments need the private-reply rules; every other source starts with the person writing first. */
export type TriggerSource = "ig_comment" | "fb_comment" | "dm_keyword" | "ad" | "story_reply" | "story_mention" | "default_reply";
export const SOURCES: TriggerSource[] = ["ig_comment", "fb_comment", "dm_keyword", "ad", "story_reply", "story_mention", "default_reply"];
export type Channel = "instagram" | "messenger";
export type MatchMode = "contains" | "is" | "word" | "starts" | "notcontain";
export const MATCH_MODES: MatchMode[] = ["contains", "is", "word", "starts", "notcontain"];

export type Field = "tag" | "language" | "follows" | "optin" | "followers" | "windowOpen" | "hour";
export type Op = "is" | "isnot" | "gt" | "lt";
export type Row = { field: Field; op: Op; value: string };

export type ActionType = "addTag" | "removeTag" | "pause" | "assign" | "unsubscribe" | "notify";
export type FlowAction = { type: ActionType; value?: string };

export type TriggerData = {
  kind: "trigger";
  postScope: PostScope;
  postId: string | null;
  anyWord: boolean;
  keywords: string[];
  /** Fields below are optional so flows saved before they existed keep working. */
  source?: TriggerSource;
  channel?: Channel;
  match?: MatchMode;
  excludes?: string[];
  adId?: string;
  frequencyHours?: number;
};

export type NodeData =
  | TriggerData
  | { kind: "public"; replies: string[] }
  | { kind: "message"; text: Partial<Record<Lang, string>>; button: Partial<Record<Lang, string>>; pdf: PdfRef | null }
  | { kind: "condition"; mode: "all" | "any"; rows: Row[] }
  | { kind: "actions"; items: FlowAction[] }
  | { kind: "randomizer"; paths: number[] }
  | { kind: "delay"; minutes: number };

export type Kind = NodeData["kind"];
export type FlowNode = { id: string; type: Kind; position: { x: number; y: number }; data: NodeData };
export type FlowEdge = { id: string; source: string; sourceHandle: string; target: string };
export type Graph = { nodes: FlowNode[]; edges: FlowEdge[] };

/** A document attached to a message. `path` is where the file lives in storage; without it only the name is known (demo mode). */
export type PdfRef = { name: string; size: number; path?: string };
export const MAX_PDF = 25 * 1024 * 1024;
export const MAX_BTN = 20;

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;

export const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Trigger with every optional field filled in. */
export function triggerOf(d: TriggerData) {
  const source = d.source ?? "ig_comment";
  const channel: Channel = source === "fb_comment" ? "messenger" : source === "ig_comment" || source === "story_reply" || source === "story_mention" ? "instagram" : (d.channel ?? "instagram");
  return { source, channel, match: d.match ?? ("contains" as MatchMode), excludes: d.excludes ?? [], adId: (d.adId ?? "").trim(), frequencyHours: d.frequencyHours ?? 24 };
}
export const isComment = (s: TriggerSource) => s === "ig_comment" || s === "fb_comment";
export const usesKeywords = (s: TriggerSource) => s === "ig_comment" || s === "fb_comment" || s === "dm_keyword" || s === "story_reply";
/** true when the source lets the channel be chosen (the others fix it). */
export const channelIsFree = (s: TriggerSource) => s === "dm_keyword" || s === "ad" || s === "default_reply";

const esc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Does this text start the flow? Sources without keywords accept any text. */
export function matchTrigger(d: TriggerData, text: string): boolean {
  const t = triggerOf(d);
  if (!usesKeywords(t.source)) return true;
  const c = normalize(text);
  if (t.excludes.some((x) => x.trim() && c.includes(normalize(x)))) return false;
  if (d.anyWord) return true;
  const ks = d.keywords.map(normalize).filter(Boolean);
  if (t.match === "notcontain") return ks.length > 0 && ks.every((k) => !c.includes(k));
  return ks.some((k) => {
    switch (t.match) {
      case "is":
        return c === k;
      case "starts":
        return c.startsWith(k);
      case "word":
        return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(k)}($|[^\\p{L}\\p{N}])`, "u").test(c);
      default:
        return c.includes(k);
    }
  });
}

export function opsFor(f: Field): Op[] {
  if (f === "followers" || f === "hour") return ["gt", "lt", "is"];
  return ["is", "isnot"];
}

export function defaultData(kind: Kind): NodeData {
  switch (kind) {
    case "trigger":
      return { kind, source: "ig_comment", postScope: "specific", postId: null, anyWord: false, keywords: [] };
    case "public":
      return { kind, replies: [] };
    case "message":
      return { kind, text: {}, button: {}, pdf: null };
    case "condition":
      return { kind, mode: "all", rows: [{ field: "tag", op: "is", value: "" }] };
    case "actions":
      return { kind, items: [{ type: "addTag", value: "" }] };
    case "randomizer":
      return { kind, paths: [50, 50] };
    case "delay":
      return { kind, minutes: 60 };
  }
}

/** Output handles of a node, in order. A message with a button also gets a "tap" output. */
export function handlesOf(n: FlowNode, lang?: Lang): { id: string; label?: Key | string }[] {
  const d = n.data;
  switch (d.kind) {
    case "condition":
      return [
        { id: "yes", label: "ed.cond.yes" },
        { id: "no", label: "ed.cond.no" },
      ];
    case "randomizer":
      return d.paths.map((p, i) => ({ id: `p${i}`, label: `${p}%` }));
    case "message": {
      const hasBtn = Object.values(d.button).some((v) => (v ?? "").trim()) || (lang ? !!(d.button[lang] ?? "").trim() : false);
      return hasBtn ? [{ id: "next" }, { id: "tap", label: "ed.h.tap" }] : [{ id: "next" }];
    }
    default:
      return [{ id: "next" }];
  }
}

export function hasButton(d: Extract<NodeData, { kind: "message" }>) {
  return Object.values(d.button).some((v) => (v ?? "").trim());
}

/** The graph the quick wizard produces: trigger -> tag -> public reply -> DM -(tap)-> PDF. */
export function buildGraph(a: {
  postScope: PostScope;
  postId: string | null;
  anyWord: boolean;
  keywords: string[];
  publicReply: boolean;
  publicReplies: string[];
  dm: { text: Partial<Record<Lang, string>>; button: Partial<Record<Lang, string>> };
  pdf: PdfRef | null;
  tag: string;
}): Graph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let x = 0;
  let prev: { id: string; handle: string } | null = null;
  const add = (data: NodeData) => {
    const id = uid("n");
    nodes.push({ id, type: data.kind, position: { x, y: 120 }, data });
    if (prev) edges.push({ id: uid("e"), source: prev.id, sourceHandle: prev.handle, target: id });
    prev = { id, handle: "next" };
    x += 340;
    return id;
  };
  add({ kind: "trigger", source: "ig_comment", postScope: a.postScope, postId: a.postId, anyWord: a.anyWord, keywords: a.keywords });
  if (a.tag) add({ kind: "actions", items: [{ type: "addTag", value: a.tag }] });
  if (a.publicReply && a.publicReplies.length) add({ kind: "public", replies: a.publicReplies });
  const dmId = add({ kind: "message", text: a.dm.text, button: a.dm.button, pdf: null });
  if (a.pdf) {
    prev = { id: dmId, handle: "tap" };
    add({ kind: "message", text: {}, button: {}, pdf: a.pdf });
  }
  return { nodes, edges };
}

export type Issue = { nodeId?: string; key: Key; vars?: Record<string, string | number> };

/** Rules Meta imposes plus basic completeness. Used before going live. */
export function validateGraph(g: Graph, defaultLang: Lang, opts: { requireUpload?: boolean } = {}): Issue[] {
  const out: Issue[] = [];
  const triggers = g.nodes.filter((n) => n.data.kind === "trigger");
  if (triggers.length !== 1) out.push({ key: "ed.i.trigger" });
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const trigNode = triggers[0]?.data;
  const trig = trigNode && trigNode.kind === "trigger" ? trigNode : null;
  // When the person writes first (DM, ad, story) the 24-hour window is already open.
  const windowOpenAtStart = !!trig && !isComment(triggerOf(trig).source);
  const outs = (id: string, h?: string) => g.edges.filter((e) => e.source === id && (!h || e.sourceHandle === h));

  // reachability
  const seen = new Set<string>();
  const stack = triggers.map((t) => t.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    outs(id).forEach((e) => stack.push(e.target));
  }
  for (const n of g.nodes) if (!seen.has(n.id)) out.push({ nodeId: n.id, key: "ed.i.unreachable" });

  // cycles (a loop would send forever)
  const color = new Map<string, 1 | 2>();
  let cyc = false;
  const dfs = (id: string) => {
    color.set(id, 1);
    for (const e of outs(id)) {
      const c = color.get(e.target);
      if (c === 1) cyc = true;
      else if (!c) dfs(e.target);
    }
    color.set(id, 2);
  };
  triggers.forEach((t) => dfs(t.id));
  if (cyc) out.push({ key: "ed.i.cycle" });

  for (const n of g.nodes) {
    const d = n.data;
    if (d.kind === "trigger") {
      const tt = triggerOf(d);
      if (isComment(tt.source) && d.postScope === "specific" && !d.postId) out.push({ nodeId: n.id, key: "ed.i.post" });
      if (usesKeywords(tt.source) && !d.anyWord && d.keywords.length === 0) out.push({ nodeId: n.id, key: "ed.i.kw" });
      if (tt.source === "default_reply" && !(tt.frequencyHours > 0)) out.push({ nodeId: n.id, key: "ed.i.freq" });
      if (outs(n.id).length === 0) out.push({ nodeId: n.id, key: "ed.i.noaction" });
    }
    if (d.kind === "public" && d.replies.filter(Boolean).length === 0) out.push({ nodeId: n.id, key: "ed.i.public" });
    if (d.kind === "public" && trig && !isComment(triggerOf(trig).source)) out.push({ nodeId: n.id, key: "ed.i.publicnc" });
    if (d.kind === "message") {
      const txt = (d.text[defaultLang] ?? "").trim();
      if (!txt && !d.pdf) out.push({ nodeId: n.id, key: "ed.i.msg", vars: { lang: defaultLang } });
      for (const [l, b] of Object.entries(d.button)) if ((b ?? "").length > MAX_BTN) out.push({ nodeId: n.id, key: "ed.i.btn", vars: { lang: l } });
      if (hasButton(d) && !(d.button[defaultLang] ?? "").trim()) out.push({ nodeId: n.id, key: "ed.i.btndef", vars: { lang: defaultLang } });
      if (d.pdf && d.pdf.size > MAX_PDF) out.push({ nodeId: n.id, key: "ed.i.pdf" });
      if (d.pdf && opts.requireUpload && !d.pdf.path) out.push({ nodeId: n.id, key: "ed.i.pdfupload" });
    }
    if (d.kind === "condition") {
      if (d.rows.length === 0 || d.rows.some((r) => !r.value.trim())) out.push({ nodeId: n.id, key: "ed.i.cond" });
      if (outs(n.id, "yes").length === 0 && outs(n.id, "no").length === 0) out.push({ nodeId: n.id, key: "ed.i.nobranch" });
    }
    if (d.kind === "actions" && (d.items.length === 0 || d.items.some((i) => ["addTag", "removeTag", "assign", "notify"].includes(i.type) && !(i.value ?? "").trim())))
      out.push({ nodeId: n.id, key: "ed.i.act" });
    if (d.kind === "randomizer") {
      const sum = d.paths.reduce((a, b) => a + b, 0);
      if (sum !== 100) out.push({ nodeId: n.id, key: "ed.i.rand", vars: { n: sum } });
    }
    if (d.kind === "delay" && !(d.minutes > 0)) out.push({ nodeId: n.id, key: "ed.i.delay" });
  }

  // Meta: only the first message after a comment can go out before the person taps something.
  // Count messages on every path that does not pass through a "tap" edge.
  const memo = new Set<string>();
  const walk = (id: string, count: number) => {
    const n = byId.get(id);
    if (!n) return;
    let c = count;
    if (n.data.kind === "message") {
      c += 1;
      if (c > 1 || n.data.pdf) {
        const key = id + ":" + c;
        if (!memo.has(key)) {
          memo.add(key);
          out.push({ nodeId: id, key: "ed.i.window" });
        }
        return;
      }
    }
    for (const e of outs(id)) {
      if (n.data.kind === "message" && e.sourceHandle === "tap") continue; // a tap opens the window
      walk(e.target, c);
    }
  };
  if (!windowOpenAtStart) triggers.forEach((t) => walk(t.id, 0));

  // Ads: the first message the person sees needs a button (what the ad flow requires).
  if (trig && triggerOf(trig).source === "ad") {
    const seenA = new Set<string>();
    const q = triggers.map((t) => t.id);
    while (q.length) {
      const id = q.pop()!;
      if (seenA.has(id)) continue;
      seenA.add(id);
      const nn = byId.get(id)!;
      if (nn.data.kind === "message") {
        if (!hasButton(nn.data)) out.push({ nodeId: id, key: "ed.i.adbtn" });
        continue;
      }
      outs(id).forEach((e) => q.push(e.target));
    }
  }

  // A wait longer than 24h also closes a window that started open.
  if (windowOpenAtStart) {
    for (const n of g.nodes) {
      if (n.data.kind === "delay" && n.data.minutes >= 1440 && outs(n.id).some((e) => byId.get(e.target)?.data.kind === "message")) out.push({ nodeId: n.id, key: "ed.i.delaywindow" });
    }
  }
  // delays also need an open window (a delay does not reopen it)
  for (const n of g.nodes) {
    if (windowOpenAtStart) break;
    if (n.data.kind !== "delay") continue;
    // reachable from the trigger only without a tap?
    const free = new Set<string>();
    const st = triggers.map((t) => t.id);
    while (st.length) {
      const id = st.pop()!;
      if (free.has(id)) continue;
      free.add(id);
      const nn = byId.get(id)!;
      outs(id).forEach((e) => {
        if (nn.data.kind === "message" && e.sourceHandle === "tap") return;
        st.push(e.target);
      });
    }
    if (free.has(n.id)) {
      const after = outs(n.id).some((e) => byId.get(e.target)?.data.kind === "message");
      if (after) out.push({ nodeId: n.id, key: "ed.i.delaywindow" });
    }
  }
  // de-duplicate
  const uniq = new Map<string, Issue>();
  out.forEach((i) => uniq.set(`${i.nodeId ?? ""}|${i.key}`, i));
  return [...uniq.values()];
}
