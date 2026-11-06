// The flow engine, as pure functions: a graph and a person's snapshot go in, a list of things to do comes out.
// No database, no network, no clock (except what the caller passes in), so it can be tested without Meta.
// The browser demo (lib/store.ts) still has its own copy of these rules; the two should be merged later.
import { type PdfRef, type FlowAction, type FlowNode, type Graph, type Row, type TriggerSource, isComment, normalize, triggerOf } from "../flow";
import type { Lang } from "../i18n";

export type Snapshot = {
  language: Lang;
  tags: string[];
  followsAccount: boolean;
  followers: number;
  optedInVia: "comment" | "ad" | "dm";
  windowOpen: boolean; // the 24h chat window
  hour: number; // 0-23 in the workspace's time zone, for "time of day" conditions
};

export type Effect =
  | { type: "public_reply"; nodeId: string; text: string }
  | { type: "message"; nodeId: string; text: string; button?: string; pdf?: PdfRef; mode: "private_reply" | "window" }
  | { type: "blocked"; nodeId: string; reason: "window" }
  | { type: "tag_add"; value: string }
  | { type: "tag_remove"; value: string }
  | { type: "pause" }
  | { type: "unsubscribe" }
  | { type: "assign"; value: string }
  | { type: "notify"; value: string }
  | { type: "wait"; nodeId: string; minutes: number };

export type Step = {
  nodeId: string;
  nodeType: string;
  outcome: "entered" | "sent" | "skipped" | "failed" | "branch_yes" | "branch_no" | "waiting" | "passed";
  detail?: unknown;
};

export type RunInput = {
  graph: Graph;
  /** "trigger" starts at the trigger node; otherwise continue from a specific output (a button tap, a finished wait). */
  start: "trigger" | { nodeId: string; handle: string };
  snapshot: Snapshot;
  source: TriggerSource;
  defaultLang: Lang;
  /** A comment gives exactly one private message before the person taps something. */
  privateReplyAvailable: boolean;
  /** Which public reply variation to use next (rotates). */
  publicRotation: number;
  rand?: () => number;
};

export type RunOutput = { effects: Effect[]; steps: Step[]; snapshot: Snapshot; privateReplyUsed: boolean; truncated: boolean };

export const MAX_STEPS = 40;

export function evalCondition(r: Row, s: Snapshot): boolean {
  const v = r.value.trim();
  const has = (b: boolean) => (r.op === "isnot" ? !b : b);
  const num = (n: number) => {
    const x = Number(v);
    return r.op === "gt" ? n > x : r.op === "lt" ? n < x : n === x;
  };
  switch (r.field) {
    case "tag":
      return has(s.tags.some((t) => normalize(t) === normalize(v)));
    case "language":
      return has(s.language === v);
    case "follows":
      return has(s.followsAccount === (v === "true"));
    case "optin":
      return has(s.optedInVia === v);
    case "windowOpen":
      return has(s.windowOpen === (v === "true"));
    case "followers":
      return num(s.followers);
    case "hour":
      return num(s.hour);
  }
}

export function runGraph(input: RunInput): RunOutput {
  const { graph, defaultLang } = input;
  const snap: Snapshot = { ...input.snapshot, tags: [...input.snapshot.tags] };
  const effects: Effect[] = [];
  const steps: Step[] = [];
  const rand = input.rand ?? Math.random;
  let privateAvail = input.privateReplyAvailable;
  let privateUsed = false;
  let count = 0;
  let truncated = false;
  const trig = graph.nodes.find((n) => n.data.kind === "trigger");
  const comment = isComment(input.source);

  const follow = (node: FlowNode, handle: string) => {
    for (const e of graph.edges.filter((x) => x.source === node.id && x.sourceHandle === handle)) {
      const nx = graph.nodes.find((n) => n.id === e.target);
      if (nx) visit(nx);
    }
  };
  const apply = (a: FlowAction) => {
    const v = (a.value ?? "").trim();
    switch (a.type) {
      case "addTag":
        if (v && !snap.tags.includes(v)) snap.tags.push(v);
        if (v) effects.push({ type: "tag_add", value: v });
        break;
      case "removeTag":
        snap.tags = snap.tags.filter((t) => normalize(t) !== normalize(v));
        if (v) effects.push({ type: "tag_remove", value: v });
        break;
      case "pause":
        effects.push({ type: "pause" });
        break;
      case "unsubscribe":
        effects.push({ type: "unsubscribe" });
        break;
      case "assign":
        effects.push({ type: "assign", value: v });
        break;
      case "notify":
        effects.push({ type: "notify", value: v });
        break;
    }
  };

  function visit(node: FlowNode) {
    if (count++ >= MAX_STEPS) {
      truncated = true;
      return;
    }
    const d = node.data;
    switch (d.kind) {
      case "trigger":
        steps.push({ nodeId: node.id, nodeType: "trigger", outcome: "entered" });
        return follow(node, "next");
      case "public": {
        const list = d.replies.filter(Boolean);
        if (!comment || list.length === 0) {
          steps.push({ nodeId: node.id, nodeType: "public", outcome: "skipped", detail: comment ? "no text" : "not a comment" });
          return follow(node, "next");
        }
        effects.push({ type: "public_reply", nodeId: node.id, text: list[input.publicRotation % list.length] });
        steps.push({ nodeId: node.id, nodeType: "public", outcome: "sent" });
        return follow(node, "next");
      }
      case "message": {
        const lang = snap.language;
        const text = d.text[lang] || d.text[defaultLang] || "";
        const button = d.button[lang] || d.button[defaultLang] || "";
        const asPrivate = !snap.windowOpen && privateAvail && !d.pdf;
        if (!snap.windowOpen && !asPrivate) {
          // Meta: outside the 24h window only the one private reply to a comment is allowed, and never a document.
          effects.push({ type: "blocked", nodeId: node.id, reason: "window" });
          steps.push({ nodeId: node.id, nodeType: "message", outcome: "failed", detail: "window closed" });
          return;
        }
        if (!text && !d.pdf) {
          steps.push({ nodeId: node.id, nodeType: "message", outcome: "skipped", detail: "empty" });
          return follow(node, "next");
        }
        if (asPrivate) {
          privateAvail = false;
          privateUsed = true;
        }
        effects.push({ type: "message", nodeId: node.id, text, button: button || undefined, pdf: d.pdf ?? undefined, mode: asPrivate ? "private_reply" : "window" });
        steps.push({ nodeId: node.id, nodeType: "message", outcome: "sent" });
        return follow(node, "next"); // "tap" continues only when the person taps
      }
      case "condition": {
        const res = d.rows.map((r) => evalCondition(r, snap));
        const ok = d.mode === "all" ? res.every(Boolean) : res.some(Boolean);
        steps.push({ nodeId: node.id, nodeType: "condition", outcome: ok ? "branch_yes" : "branch_no" });
        return follow(node, ok ? "yes" : "no");
      }
      case "actions":
        d.items.forEach(apply);
        steps.push({ nodeId: node.id, nodeType: "actions", outcome: "passed" });
        return follow(node, "next");
      case "randomizer": {
        const total = d.paths.reduce((a, b) => a + b, 0) || 1;
        let r = rand() * total;
        let idx = 0;
        for (let i = 0; i < d.paths.length; i++) {
          if (r < d.paths[i]) {
            idx = i;
            break;
          }
          r -= d.paths[i];
        }
        steps.push({ nodeId: node.id, nodeType: "randomizer", outcome: "passed", detail: { path: idx } });
        return follow(node, `p${idx}`);
      }
      case "delay":
        effects.push({ type: "wait", nodeId: node.id, minutes: d.minutes });
        steps.push({ nodeId: node.id, nodeType: "delay", outcome: "waiting" });
        return; // the job runner continues from this node's "next" when the time is up
    }
  }

  if (input.start === "trigger") {
    if (trig) visit(trig);
  } else {
    const from = graph.nodes.find((n) => n.id === (input.start as { nodeId: string }).nodeId);
    if (from) follow(from, (input.start as { handle: string }).handle);
  }
  return { effects, steps, snapshot: snap, privateReplyUsed: privateUsed, truncated };
}

/** The automation's trigger node, normalised. */
export function triggerNode(graph: Graph) {
  const n = graph.nodes.find((x) => x.data.kind === "trigger");
  return n && n.data.kind === "trigger" ? { node: n, data: n.data, t: triggerOf(n.data) } : null;
}
