"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Clock, Filter, MessageSquare, Reply, Shuffle, Zap, Wrench } from "lucide-react";
import { useI18n, type Key, type Lang } from "@/lib/i18n";
import { channelIsFree, isComment, triggerOf, usesKeywords, type Kind, type NodeData } from "@/lib/flow";
import { cx } from "../ui";

export const KIND_META: Record<Kind, { icon: typeof Zap; title: Key; tone: string }> = {
  trigger: { icon: Zap, title: "ed.node.trigger", tone: "bg-node-trigger" },
  public: { icon: Reply, title: "ed.node.public", tone: "bg-surface-raised" },
  message: { icon: MessageSquare, title: "ed.node.message", tone: "bg-surface-raised" },
  condition: { icon: Filter, title: "ed.node.condition", tone: "bg-node-condition" },
  actions: { icon: Wrench, title: "ed.node.actions", tone: "bg-node-action" },
  randomizer: { icon: Shuffle, title: "ed.node.random", tone: "bg-node-condition" },
  delay: { icon: Clock, title: "ed.node.delay", tone: "bg-node-action" },
};

type T = (k: Key, v?: Record<string, string | number>) => string;

const fieldKey = (f: string) => `ed.f.${f === "windowOpen" ? "window" : f}` as Key;
const opKey = (o: string) => `ed.op.${o}` as Key;

/** A trigger is named after what starts it; every other step after its kind. */
export function nodeTitle(d: NodeData, t: T): string {
  return d.kind === "trigger" ? t(`ed.src.${triggerOf(d).source}` as Key) : t(KIND_META[d.kind].title);
}

export function summaryOf(d: NodeData, t: T, lang: Lang, posts: { id: string; caption: string }[] = []): string[] {
  switch (d.kind) {
    case "trigger": {
      const tt = triggerOf(d);
      const out: string[] = [];
      if (isComment(tt.source)) out.push(d.postScope === "specific" ? (posts.find((p) => p.id === d.postId)?.caption ?? d.postId ?? "—") : t(d.postScope === "all" ? "wiz.post.all" : "wiz.post.next"));
      if (usesKeywords(tt.source)) out.push(d.anyWord ? t("flow.trigger.anyword") : t("flow.trigger.kw", { kw: d.keywords.join(", ") || "—" }));
      if (tt.source === "ad") out.push(tt.adId ? `ID: ${tt.adId}` : t("flow.trigger.anyword"));
      if (tt.source === "default_reply") out.push(`≤ 1 / ${tt.frequencyHours} ${t("ed.unit.hour")}`);
      if (channelIsFree(tt.source)) out.push(t(`ed.ch.${tt.channel}` as Key));
      return out;
    }
    case "public":
      return [d.replies.filter(Boolean)[0] ?? "—", d.replies.filter(Boolean).length > 1 ? `+${d.replies.filter(Boolean).length - 1}` : ""];
    case "message": {
      const txt = d.text[lang] || Object.values(d.text).find(Boolean) || "";
      const btn = d.button[lang] || Object.values(d.button).find(Boolean) || "";
      return [txt || (d.pdf ? "" : "—"), btn ? `[ ${btn} ]` : "", d.pdf ? `📎 ${d.pdf.name}` : ""];
    }
    case "condition":
      return d.rows.slice(0, 3).map((r) => `${t(fieldKey(r.field))} ${t(opKey(r.op))} ${r.value || "…"}`).concat(d.rows.length > 3 ? [`+${d.rows.length - 3}`] : []);
    case "actions":
      return d.items.slice(0, 3).map((i) => `${t(`ed.act.${i.type}` as Key)}${i.value ? `: ${i.value}` : ""}`).concat(d.items.length > 3 ? [`+${d.items.length - 3}`] : []);
    case "randomizer":
      return [d.paths.map((p) => `${p}%`).join(" / ")];
    case "delay":
      return [d.minutes % 1440 === 0 ? `${d.minutes / 1440} ${t("ed.unit.day")}` : d.minutes % 60 === 0 ? `${d.minutes / 60} ${t("ed.unit.hour")}` : `${d.minutes} ${t("ed.unit.min")}`];
  }
}

export type RFData = {
  d: NodeData;
  hits: number;
  invalid: boolean;
  lang: Lang;
  posts: { id: string; caption: string }[];
  outs: { id: string; label?: string }[];
};

export function StepNode({ data, selected }: NodeProps) {
  const { t } = useI18n();
  const { d, hits, invalid, lang, posts, outs } = data as unknown as RFData;
  const meta = KIND_META[d.kind];
  const Icon = meta.icon;
  const lines = summaryOf(d, t, lang, posts).filter(Boolean);
  return (
    <div
      className={cx(
        "w-node rounded-lg border bg-surface-raised shadow-card",
        meta.tone,
        selected ? "border-accent ring-2 ring-accent" : invalid ? "border-danger ring-2 ring-danger" : "border-border",
      )}
    >
      {d.kind !== "trigger" && <Handle type="target" position={Position.Left} aria-label="in" className="!h-3 !w-3 !border-2 !border-accent !bg-bg" />}
      <div className="p-3 pb-2">
        <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{nodeTitle(d, t)}</span>
          {invalid && <AlertTriangle className="h-4 w-4 shrink-0 text-danger" aria-label="!" />}
          {hits > 0 && <span className="shrink-0 rounded-pill bg-accent-soft px-1.5 text-xs text-accent">{hits}×</span>}
        </div>
        <div className="space-y-0.5">
          {lines.map((l, i) => (
            <p key={i} className="line-clamp-2 break-words text-xs text-text-muted">
              {l}
            </p>
          ))}
        </div>
      </div>
      <div className="pb-1">
        {outs.map((o) => (
          <div key={o.id} className="relative flex h-6 items-center justify-end pr-3 text-xs text-text-muted">
            {o.label && <span>{o.label}</span>}
            <Handle id={o.id} type="source" position={Position.Right} aria-label={o.label ?? "out"} className="!h-3 !w-3 !border-2 !border-accent !bg-accent" />
          </div>
        ))}
      </div>
    </div>
  );
}
