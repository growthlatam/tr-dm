"use client";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { ArrowLeft, ChevronDown, Plus, Redo2, Undo2 } from "lucide-react";
import { useI18n, type Key } from "@/lib/i18n";
import {
  defaultData,
  handlesOf,
  uid,
  validateGraph,
  type FlowNode,
  type Graph,
  type Kind,
  type NodeData,
} from "@/lib/flow";
import {
  discardDraft,
  editGraph,
  hasUnpublished,
  publishDraft,
  publishedGraph,
  renameAutomation,
  saveDraftGraph,
  setAutomationStatus,
  useHydrated,
  useStore,
  type Automation,
} from "@/lib/store";
import { remoteEnabled } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, Tabs, cx } from "../ui";
import { Tester } from "../tester";
import { KIND_META, StepNode, nodeTitle, summaryOf, type RFData } from "./nodes";
import { NodePanel } from "./panel";

const nodeTypes = {
  trigger: StepNode,
  public: StepNode,
  message: StepNode,
  condition: StepNode,
  actions: StepNode,
  randomizer: StepNode,
  delay: StepNode,
};

const ADDABLE: { kind: Kind; key: Key }[] = [
  { kind: "message", key: "ed.add.message" },
  { kind: "public", key: "ed.add.public" },
  { kind: "condition", key: "ed.add.condition" },
  { kind: "actions", key: "ed.add.actions" },
  { kind: "randomizer", key: "ed.add.random" },
  { kind: "delay", key: "ed.add.delay" },
];

/** Drop edges that point nowhere or leave from an output that no longer exists. */
function clean(g: Graph, lang: Automation["defaultLang"]): Graph {
  const ids = new Map(g.nodes.map((n) => [n.id, n]));
  const edges = g.edges.filter((e) => {
    const s = ids.get(e.source);
    return s && ids.has(e.target) && handlesOf(s, lang).some((h) => h.id === e.sourceHandle);
  });
  return edges.length === g.edges.length ? g : { ...g, edges };
}

export function FlowEditor({ id }: { id: string }) {
  const { t } = useI18n();
  const { automations } = useStore();
  const ready = useHydrated();
  const a = automations.find((x) => x.id === id);
  if (!ready) return <p role="status" className="p-8 text-sm text-text-muted">{t("common.loading")}</p>;
  if (!a) return <p className="p-8 text-sm text-text-muted">{t("flow.notfound")}</p>;
  return (
    <ReactFlowProvider>
      <Body key={a.id} a={a} />
    </ReactFlowProvider>
  );
}

function Body({ a }: { a: Automation }) {
  const { t, lang } = useI18n();
  const { posts, team } = useStore();
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);

  const [graph, setGraph] = useState<Graph>(() => structuredClone(editGraph(a)));
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const past = useRef<Graph[]>([]);
  const future = useRef<Graph[]>([]);
  const [, bumpHist] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [tab, setTab] = useState<"step" | "issues" | "test">("step");
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState(a.name);
  const [published, setPublished] = useState(false);

  const issues = useMemo(() => validateGraph(graph, a.defaultLang, { requireUpload: remoteEnabled }), [graph, a.defaultLang]);
  const bad = useMemo(() => new Set(issues.map((i) => i.nodeId).filter(Boolean) as string[]), [issues]);
  const selNode = graph.nodes.find((n) => n.id === selId) ?? null;
  const unpublished = hasUnpublished(a);

  const commit = useCallback(
    (next: Graph, record = true) => {
      const g = clean(next, a.defaultLang);
      if (record) {
        past.current = [...past.current.slice(-49), graphRef.current];
        future.current = [];
        bumpHist((n) => n + 1);
      }
      graphRef.current = g;
      setGraph(g);
      saveDraftGraph(a.id, g);
      setPublished(false);
    },
    [a.id, a.defaultLang],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(graphRef.current);
    graphRef.current = prev;
    setGraph(prev);
    saveDraftGraph(a.id, prev);
    bumpHist((n) => n + 1);
  }, [a.id]);
  const redo = useCallback(() => {
    const nx = future.current.pop();
    if (!nx) return;
    past.current.push(graphRef.current);
    graphRef.current = nx;
    setGraph(nx);
    saveDraftGraph(a.id, nx);
    bumpHist((n) => n + 1);
  }, [a.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/input|textarea|select/i.test(el.tagName)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const label = useCallback((k?: string) => (k ? (k.startsWith("ed.") ? t(k as Key) : k) : undefined), [t]);

  const rfNodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n) => {
        const hs = handlesOf(n, a.defaultLang);
        const outs = hs.map((h) => ({ id: h.id, label: label(h.label) ?? (hs.length > 1 && h.id === "next" ? t("ed.h.next") : undefined) }));
        const data: RFData = { d: n.data, hits: a.nodeHits[n.id] ?? 0, invalid: bad.has(n.id), lang: a.defaultLang, posts, outs };
        return { id: n.id, type: n.type, position: n.position, data: data as unknown as Record<string, unknown>, selected: n.id === selId, deletable: n.type !== "trigger" };
      }),
    [graph.nodes, a.nodeHits, a.defaultLang, bad, posts, selId, label, t],
  );
  const rfEdges: Edge[] = useMemo(
    () => graph.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } })),
    [graph.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removed = changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
      if (removed.length) {
        commit({ nodes: graphRef.current.nodes.filter((n) => !removed.includes(n.id)), edges: graphRef.current.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)) });
        if (selId && removed.includes(selId)) setSelId(null);
      }
      const moves = changes.filter((c) => c.type === "position" && c.position);
      if (moves.length) {
        setGraph((g) => {
          const n = { ...g, nodes: g.nodes.map((x) => { const m = moves.find((c) => (c as { id: string }).id === x.id) as { position?: { x: number; y: number } } | undefined; return m?.position ? { ...x, position: m.position } : x; }) };
          graphRef.current = n;
          return n;
        });
      }
    },
    [commit, selId],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
      if (removed.length) commit({ ...graphRef.current, edges: graphRef.current.edges.filter((e) => !removed.includes(e.id)) });
    },
    [commit],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle || c.source === c.target) return;
      const g = graphRef.current;
      if (g.nodes.find((n) => n.id === c.target)?.type === "trigger") return;
      const edges = g.edges.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle));
      commit({ ...g, edges: [...edges, { id: uid("e"), source: c.source, sourceHandle: c.sourceHandle, target: c.target }] });
    },
    [commit],
  );

  function addNode(kind: Kind) {
    setMenu(false);
    const g = graphRef.current;
    const from = selNode;
    let pos = { x: 40, y: 40 };
    if (from) pos = { x: from.position.x + 340, y: from.position.y + g.edges.filter((e) => e.source === from.id).length * 110 };
    else if (wrap.current) {
      const r = wrap.current.getBoundingClientRect();
      pos = rf.screenToFlowPosition({ x: r.left + r.width / 2 - 140, y: r.top + r.height / 2 - 60 });
    }
    const n: FlowNode = { id: uid("n"), type: kind, position: pos, data: defaultData(kind) };
    let edges = g.edges;
    if (from) {
      const free = handlesOf(from, a.defaultLang).find((h) => !g.edges.some((e) => e.source === from.id && e.sourceHandle === h.id));
      if (free) edges = [...edges, { id: uid("e"), source: from.id, sourceHandle: free.id, target: n.id }];
    }
    commit({ nodes: [...g.nodes, n], edges });
    setSelId(n.id);
    setTab("step");
  }

  function updateNode(d: NodeData) {
    if (!selId) return;
    commit({ ...graphRef.current, nodes: graphRef.current.nodes.map((n) => (n.id === selId ? { ...n, data: d } : n)) }, true);
  }
  function removeSel() {
    if (!selId) return;
    const g = graphRef.current;
    commit({ nodes: g.nodes.filter((n) => n.id !== selId), edges: g.edges.filter((e) => e.source !== selId && e.target !== selId) });
    setSelId(null);
  }
  function publish() {
    if (issues.length) {
      setTab("issues");
      return;
    }
    publishDraft(a.id);
    setPublished(true);
  }

  const order = useMemo(() => {
    const trig = graph.nodes.find((n) => n.type === "trigger");
    const seen: string[] = [];
    const q = trig ? [trig.id] : [];
    while (q.length) {
      const idn = q.shift()!;
      if (seen.includes(idn)) continue;
      seen.push(idn);
      graph.edges.filter((e) => e.source === idn).forEach((e) => q.push(e.target));
    }
    return [...seen, ...graph.nodes.filter((n) => !seen.includes(n.id)).map((n) => n.id)].map((i) => graph.nodes.find((n) => n.id === i)!);
  }, [graph]);

  const trigData = graph.nodes.find((n) => n.data.kind === "trigger")?.data;
  const keyword = trigData && trigData.kind === "trigger" ? (trigData.anyWord ? "info" : trigData.keywords[0] ?? "info") : "info";
  const tone = { live: "success", paused: "warning", draft: "muted" } as const;

  return (
    <div className="flex h-[calc(100vh-var(--layout-header))] flex-col lg:h-screen">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg px-3 py-2">
        <Link href="/automations" aria-label={t("flow.back")} className="grid h-9 w-9 place-items-center rounded-md hover:bg-surface">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <Input
          aria-label={t("wiz.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && renameAutomation(a.id, name.trim())}
          className="h-9 max-w-[260px] font-semibold"
        />
        <Badge tone={tone[a.status]}>{t(`auto.status.${a.status}` as "auto.status.live")}</Badge>
        {unpublished && !published && <Badge tone="info">{t("ed.unpublished")}</Badge>}
        {published && <Badge tone="success">{t("ed.published")}</Badge>}
        <span className="text-xs text-text-muted" role="status">
          {t("ed.saved")}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={undo} disabled={past.current.length === 0} aria-label={t("ed.undo")}>
            <Undo2 className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" onClick={redo} disabled={future.current.length === 0} aria-label={t("ed.redo")}>
            <Redo2 className="h-4 w-4" aria-hidden />
          </Button>
          <div className="relative">
            <Button variant="secondary" size="sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("ed.add")}
              <ChevronDown className="h-3 w-3" aria-hidden />
            </Button>
            {menu && (
              <ul role="menu" className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-border bg-bg p-1 shadow-pop">
                {ADDABLE.map((x) => {
                  const M = KIND_META[x.kind];
                  return (
                    <li key={x.kind} role="none">
                      <button role="menuitem" onClick={() => addNode(x.kind)} className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-surface">
                        <M.icon className="h-4 w-4 text-accent" aria-hidden />
                        {t(x.key)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {!a.custom && !a.draftGraph && (
            <Link href={`/automations/${a.id}/edit`}>
              <Button variant="ghost" size="sm">
                {t("ed.quick")}
              </Button>
            </Link>
          )}
          {a.draftGraph && unpublished && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const g = structuredClone(publishedGraph(a));
                setGraph(g);
                graphRef.current = g;
                past.current = [];
                future.current = [];
                discardDraft(a.id);
                setSelId(null);
              }}
            >
              {t("ed.discard")}
            </Button>
          )}
          {a.status === "live" && (
            <Button variant="secondary" size="sm" onClick={() => setAutomationStatus(a.id, "paused")}>
              {t("flow.pause")}
            </Button>
          )}
          <Button size="sm" onClick={publish}>
            {t("ed.publish")}
            {issues.length > 0 && <span className="rounded-pill bg-danger px-1.5 text-xs text-white">{issues.length}</span>}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div ref={wrap} className="relative min-h-[320px] flex-1 bg-canvas">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSelId(n.id);
              setTab("step");
            }}
            onPaneClick={() => setSelId(null)}
            onNodeDragStart={() => {
              past.current = [...past.current.slice(-49), graphRef.current];
              future.current = [];
              bumpHist((n) => n + 1);
            }}
            onNodeDragStop={() => setTimeout(() => saveDraftGraph(a.id, graphRef.current), 0)}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.3}
            deleteKeyCode={["Backspace", "Delete"]}
            snapToGrid
            snapGrid={[8, 8]}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="max-h-[48vh] w-full shrink-0 overflow-y-auto border-t border-border bg-bg p-4 lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0">
          <div className="mb-4">
            <Tabs
              label={t("ed.steps")}
              value={tab}
              onChange={setTab}
              items={[
                { value: "step", label: t("ed.steps") },
                { value: "issues", label: issues.length ? `${t("ed.issues").split(" ")[0]} (${issues.length})` : "✓", dot: issues.length > 0 },
                { value: "test", label: t("wiz.test.title") },
              ]}
            />
          </div>

          {tab === "step" &&
            (selNode ? (
              <>
                <NodePanel node={selNode} update={updateNode} remove={removeSel} posts={posts} defaultLang={a.defaultLang} team={team} />
                {(a.nodeHits[selNode.id] ?? 0) > 0 && <p className="mt-4 text-xs text-text-muted">{t("ed.hits", { n: a.nodeHits[selNode.id] })}</p>}
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-text-muted">{t("ed.nosel")}</p>
                <dl className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["flow.m.runs", a.stats.runs],
                      ["flow.m.contacts", a.stats.contacts],
                      ["flow.m.taps", a.stats.taps],
                      ["flow.m.docs", a.stats.docs],
                    ] as const
                  ).map(([k, v]) => (
                    <Card key={k} className="p-2.5">
                      <dt className="text-xs text-text-muted">{t(k)}</dt>
                      <dd className="text-xl font-bold">{v}</dd>
                    </Card>
                  ))}
                </dl>
                <ol className="space-y-1.5" aria-label={t("ed.steps")}>
                  {order.map((n, i) => (
                    <li key={n.id}>
                      <button
                        onClick={() => setSelId(n.id)}
                        className={cx("w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-surface", bad.has(n.id) ? "border-danger" : "border-border")}
                      >
                        <span className="font-medium">
                          {i + 1}. {nodeTitle(n.data, t)}
                        </span>
                        <span className="block truncate text-xs text-text-muted">{summaryOf(n.data, t, a.defaultLang, posts).filter(Boolean)[0]}</span>
                        {graph.edges
                          .filter((e) => e.source === n.id)
                          .map((e) => (
                            <span key={e.id} className="block text-xs text-text-muted">
                              {label(handlesOf(n, a.defaultLang).find((h) => h.id === e.sourceHandle)?.label) ?? "→"} → {nodeTitle(graph.nodes.find((x) => x.id === e.target)!.data, t)}
                            </span>
                          ))}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}

          {tab === "issues" && (
            <div>
              {issues.length > 0 && <h2 className="mb-2 font-semibold">{t("ed.issues")}</h2>}
              {issues.length === 0 ? (
                <p role="status" className="text-sm text-success">
                  {t("ed.issues.none")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {issues.map((i, k) => (
                    <li key={k} className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
                      {i.nodeId && (
                        <button
                          className="mb-0.5 block text-xs font-semibold underline"
                          onClick={() => {
                            setSelId(i.nodeId!);
                            setTab("step");
                          }}
                        >
                          {nodeTitle(graph.nodes.find((n) => n.id === i.nodeId)!.data, t)}
                        </button>
                      )}
                      {t(i.key, i.vars)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "test" && <Tester savedId={a.id} keyword={keyword} defaultLang={a.defaultLang} trigger={trigData && trigData.kind === "trigger" ? trigData : undefined} advanced />}
        </aside>
      </div>
    </div>
  );
}
