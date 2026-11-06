// Offline checks for the pure flow engine. Run: npx tsx scripts/test-engine.ts
import { buildGraph, type Graph } from "../src/lib/flow";
import { runGraph, type Snapshot } from "../src/lib/engine/run";

let fails = 0;
const ck = (n: string, ok: boolean, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  " + x)); if (!ok) fails++; };

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ language: "pt-BR", tags: [], followsAccount: false, followers: 0, optedInVia: "comment", windowOpen: false, hour: 10, ...o });
const wizard = buildGraph({
  postScope: "specific", postId: "p1", anyWord: false, keywords: ["guia"], publicReply: true, publicReplies: ["Enviado!", "Olhe seu DM"],
  dm: { text: { "pt-BR": "Olá!" }, button: { "pt-BR": "Quero" } }, pdf: { name: "g.pdf", size: 1000 }, tag: "lead",
});
const base = { graph: wizard, defaultLang: "pt-BR" as const, publicRotation: 0 };

// comment: tag, public reply, ONE private message with a button, no document before the tap
const c = runGraph({ ...base, start: "trigger", snapshot: snap(), source: "ig_comment", privateReplyAvailable: true });
const kinds = c.effects.map((e) => e.type);
ck("comment: tag + public reply + one message, no document", JSON.stringify(kinds) === JSON.stringify(["tag_add", "public_reply", "message"]), kinds.join(","));
const m = c.effects.find((e) => e.type === "message");
ck("comment: the message is a private reply with its button and no pdf", !!m && m.type === "message" && m.mode === "private_reply" && m.button === "Quero" && !m.pdf);
ck("comment: private reply is marked used", c.privateReplyUsed);

// tap: window is open, the document goes out
const tapNode = wizard.nodes.find((n) => n.data.kind === "message")!;
const t = runGraph({ ...base, start: { nodeId: tapNode.id, handle: "tap" }, snapshot: snap({ windowOpen: true }), source: "ig_comment", privateReplyAvailable: false });
const doc = t.effects.find((e) => e.type === "message");
ck("tap: document sent inside the window", !!doc && doc.type === "message" && doc.pdf?.name === "g.pdf" && doc.mode === "window");

// tap with the window somehow closed: blocked, never sent
const tb = runGraph({ ...base, start: { nodeId: tapNode.id, handle: "tap" }, snapshot: snap({ windowOpen: false }), source: "ig_comment", privateReplyAvailable: false });
ck("closed window: document is blocked", tb.effects.some((e) => e.type === "blocked") && !tb.effects.some((e) => e.type === "message"));

// public replies rotate
const r1 = runGraph({ ...base, publicRotation: 1, start: "trigger", snapshot: snap(), source: "ig_comment", privateReplyAvailable: true });
const pr = r1.effects.find((e) => e.type === "public_reply");
ck("public reply rotates", !!pr && pr.type === "public_reply" && pr.text === "Olhe seu DM");

// DM trigger: the person wrote first, window open, no public reply, the document can go straight away
const dmGraph: Graph = JSON.parse(JSON.stringify(wizard));
const trg = dmGraph.nodes.find((n) => n.data.kind === "trigger")!;
if (trg.data.kind === "trigger") trg.data.source = "dm_keyword";
const d = runGraph({ graph: dmGraph, defaultLang: "pt-BR", publicRotation: 0, start: "trigger", snapshot: snap({ windowOpen: true, optedInVia: "dm" }), source: "dm_keyword", privateReplyAvailable: false });
ck("dm: no public reply, message sent in the window", !d.effects.some((e) => e.type === "public_reply") && d.effects.some((e) => e.type === "message" && e.mode === "window"));
ck("dm: public step is recorded as skipped", d.steps.some((s) => s.nodeType === "public" && s.outcome === "skipped"));

// language fallback
const es = runGraph({ ...base, start: "trigger", snapshot: snap({ language: "es-AR" }), source: "ig_comment", privateReplyAvailable: true });
const em = es.effects.find((e) => e.type === "message");
ck("language falls back to the default", !!em && em.type === "message" && em.text === "Olá!");

// condition + randomizer + wait + loop guard
const mk = (nodes: Graph["nodes"], edges: Graph["edges"]): Graph => ({ nodes, edges });
const N = (id: string, data: Graph["nodes"][number]["data"]) => ({ id, type: data.kind, position: { x: 0, y: 0 }, data });
const E = (s: string, h: string, t: string) => ({ id: s + h + t, source: s, sourceHandle: h, target: t });
const g2 = mk(
  [
    N("t", { kind: "trigger", source: "dm_keyword", postScope: "all", postId: null, anyWord: true, keywords: [] }),
    N("c", { kind: "condition", mode: "all", rows: [{ field: "tag", op: "is", value: "vip" }] }),
    N("yes", { kind: "actions", items: [{ type: "addTag", value: "saw-yes" }] }),
    N("no", { kind: "actions", items: [{ type: "addTag", value: "saw-no" }] }),
  ],
  [E("t", "next", "c"), E("c", "yes", "yes"), E("c", "no", "no")],
);
const base2 = { graph: g2, defaultLang: "pt-BR" as const, publicRotation: 0, start: "trigger" as const, source: "dm_keyword" as const, privateReplyAvailable: false };
const yes = runGraph({ ...base2, snapshot: snap({ tags: ["VIP"], windowOpen: true }) });
const no = runGraph({ ...base2, snapshot: snap({ windowOpen: true }) });
ck("condition: tag is case-insensitive, yes branch", yes.effects.some((e) => e.type === "tag_add" && e.value === "saw-yes") && !yes.effects.some((e) => e.type === "tag_add" && e.value === "saw-no"));
ck("condition: no branch", no.effects.some((e) => e.type === "tag_add" && e.value === "saw-no"));

const g3 = mk(
  [N("t", { kind: "trigger", source: "dm_keyword", postScope: "all", postId: null, anyWord: true, keywords: [] }), N("r", { kind: "randomizer", paths: [30, 70] }), N("a", { kind: "actions", items: [{ type: "addTag", value: "A" }] }), N("b", { kind: "actions", items: [{ type: "addTag", value: "B" }] })],
  [E("t", "next", "r"), E("r", "p0", "a"), E("r", "p1", "b")],
);
const pick = (x: number) => runGraph({ ...base2, graph: g3, rand: () => x, snapshot: snap({ windowOpen: true }) }).effects.find((e) => e.type === "tag_add");
ck("randomizer: low draw goes to path 0, high draw to path 1", (pick(0.1) as { value: string }).value === "A" && (pick(0.9) as { value: string }).value === "B");

const g4 = mk([N("t", { kind: "trigger", source: "dm_keyword", postScope: "all", postId: null, anyWord: true, keywords: [] }), N("w", { kind: "delay", minutes: 60 }), N("a", { kind: "actions", items: [{ type: "addTag", value: "after" }] })], [E("t", "next", "w"), E("w", "next", "a")]);
const w = runGraph({ ...base2, graph: g4, snapshot: snap({ windowOpen: true }) });
ck("wait: stops at the delay and asks to be resumed", w.effects.some((e) => e.type === "wait" && e.minutes === 60) && !w.effects.some((e) => e.type === "tag_add"));
const w2 = runGraph({ ...base2, graph: g4, start: { nodeId: "w", handle: "next" }, snapshot: snap({ windowOpen: true }) });
ck("wait: resuming continues after the delay", w2.effects.some((e) => e.type === "tag_add" && e.value === "after"));

const loop = mk([N("t", { kind: "trigger", source: "dm_keyword", postScope: "all", postId: null, anyWord: true, keywords: [] }), N("a", { kind: "actions", items: [{ type: "addTag", value: "x" }] }), N("b", { kind: "actions", items: [{ type: "addTag", value: "y" }] })], [E("t", "next", "a"), E("a", "next", "b"), E("b", "next", "a")]);
const lp = runGraph({ ...base2, graph: loop, snapshot: snap({ windowOpen: true }) });
ck("a loop in the graph is cut at 40 steps", lp.truncated && lp.steps.length <= 40);

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
