"use client";
import { useState } from "react";
import { FileText, Plus, Trash2, X } from "lucide-react";
import { LANGS, useI18n, type Key, type Lang } from "@/lib/i18n";
import { MATCH_MODES, MAX_BTN, MAX_PDF, SOURCES, channelIsFree, isComment, opsFor, triggerOf, usesKeywords, type Channel, type MatchMode, type TriggerSource, type ActionType, type Field as FField, type FlowNode, type NodeData, type Row } from "@/lib/flow";
import type { Post } from "@/lib/store";
import { remoteEnabled } from "@/lib/supabase/client";
import { uploadPdf } from "@/lib/remote";
import { Button, Field, Input, Tabs, Textarea, cx } from "../ui";
import { KIND_META, nodeTitle } from "./nodes";

const sel = "h-10 w-full rounded-md border border-border-input bg-bg px-2 text-sm";
const FIELDS: FField[] = ["tag", "language", "follows", "optin", "followers", "windowOpen", "hour"];
const ACTIONS: ActionType[] = ["addTag", "removeTag", "pause", "assign", "unsubscribe", "notify"];
const fKey = (f: FField) => `ed.f.${f === "windowOpen" ? "window" : f}` as Key;

function words(s: string) {
  return s
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export function NodePanel({
  node,
  update,
  remove,
  posts,
  defaultLang,
  team,
}: {
  node: FlowNode;
  update: (d: NodeData) => void;
  remove: () => void;
  posts: Post[];
  defaultLang: Lang;
  team: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const d = node.data;
  const meta = KIND_META[d.kind];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <meta.icon className="h-4 w-4 text-accent" aria-hidden />
          {nodeTitle(d, t)}
        </h2>
        {d.kind !== "trigger" && (
          <Button variant="ghost" size="sm" onClick={remove}>
            <Trash2 className="h-4 w-4" aria-hidden />
            {t("ed.delete")}
          </Button>
        )}
      </div>
      {d.kind === "trigger" && <TriggerEditor d={d} update={update} posts={posts} />}
      {d.kind === "public" && <PublicEditor d={d} update={update} />}
      {d.kind === "message" && <MessageEditor d={d} update={update} defaultLang={defaultLang} />}
      {d.kind === "condition" && <ConditionEditor d={d} update={update} />}
      {d.kind === "actions" && <ActionsEditor d={d} update={update} team={team} />}
      {d.kind === "randomizer" && <RandomizerEditor d={d} update={update} />}
      {d.kind === "delay" && <DelayEditor d={d} update={update} />}
    </div>
  );
}

function TriggerEditor({ d, update, posts }: { d: Extract<NodeData, { kind: "trigger" }>; update: (d: NodeData) => void; posts: Post[] }) {
  const { t } = useI18n();
  const [idIn, setIdIn] = useState("");
  const [kw, setKw] = useState(d.keywords.join(", "));
  const [ex, setEx] = useState((d.excludes ?? []).join(", "));
  const tt = triggerOf(d);
  const net = tt.source === "fb_comment" ? "facebook" : "instagram";
  const shown = posts.filter((p) => (p.net ?? "instagram") === net);
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Field label={t("ed.src.label")} htmlFor="tp-src">
          <select
            id="tp-src"
            value={tt.source}
            onChange={(e) => {
              const source = e.target.value as TriggerSource;
              // a post picked for Instagram is not a Facebook post
              const picked = posts.find((p) => p.id === d.postId);
              const wrongNet = !!picked && (picked.net ?? "instagram") !== (source === "fb_comment" ? "facebook" : "instagram");
              update({ ...d, source, postId: wrongNet ? null : d.postId });
            }}
            className={sel}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`ed.src.${s}` as Key)}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-text-muted">{t(`ed.src.d.${tt.source}` as Key)}</p>
      </div>
      {channelIsFree(tt.source) && (
        <Field label={t("ed.ch.label")} htmlFor="tp-ch">
          <select id="tp-ch" value={tt.channel} onChange={(e) => update({ ...d, channel: e.target.value as Channel })} className={sel}>
            <option value="instagram">{t("ed.ch.instagram")}</option>
            <option value="messenger">{t("ed.ch.messenger")}</option>
          </select>
        </Field>
      )}
      {isComment(tt.source) && (
        <>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-semibold">{t("wiz.s1")}</legend>
            {(["specific", "all", "next"] as const).map((v) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="scope" checked={d.postScope === v} onChange={() => update({ ...d, postScope: v })} className="h-4 w-4 accent-[var(--color-accent)]" />
                {t(v === "specific" ? "wiz.post.specific" : v === "all" ? "wiz.post.all" : "wiz.post.next")}
              </label>
            ))}
          </fieldset>
          {d.postScope === "specific" && (
            <div className="space-y-2">
              <select aria-label={t("wiz.post.specific")} value={shown.some((p) => p.id === d.postId) ? d.postId! : ""} onChange={(e) => update({ ...d, postId: e.target.value || null })} className={sel}>
                <option value="">—</option>
                {shown.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.caption}
                  </option>
                ))}
              </select>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label={t("wiz.post.id")} htmlFor="tp-id">
                    <Input id="tp-id" value={idIn} onChange={(e) => setIdIn(e.target.value)} placeholder={t("wiz.post.id.ph")} />
                  </Field>
                </div>
                <Button
                  variant="secondary"
                  disabled={!idIn.trim()}
                  onClick={() => {
                    update({ ...d, postId: idIn.trim() });
                    setIdIn("");
                  }}
                >
                  {t("wiz.post.id.use")}
                </Button>
              </div>
              {d.postId && !shown.some((p) => p.id === d.postId) && (
                <p className="text-xs text-text-muted">
                  ID: <span className="font-mono">{d.postId}</span>
                </p>
              )}
            </div>
          )}
        </>
      )}
      {tt.source === "ad" && (
        <Field label={t("ed.adid.label")} htmlFor="tp-ad">
          <Input id="tp-ad" value={d.adId ?? ""} onChange={(e) => update({ ...d, adId: e.target.value })} className="font-mono" />
        </Field>
      )}
      {tt.source === "default_reply" && (
        <Field label={t("ed.freq.label")} htmlFor="tp-freq">
          <Input id="tp-freq" type="number" min={1} value={d.frequencyHours ?? 24} onChange={(e) => update({ ...d, frequencyHours: Number(e.target.value) })} />
        </Field>
      )}
      {usesKeywords(tt.source) && (
        <>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-semibold">{t(isComment(tt.source) ? "wiz.s2" : "ed.kw.legend")}</legend>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="kwmode" checked={!d.anyWord} onChange={() => update({ ...d, anyWord: false })} className="h-4 w-4 accent-[var(--color-accent)]" />
              {t("wiz.kw.some")}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="kwmode" checked={d.anyWord} onChange={() => update({ ...d, anyWord: true })} className="h-4 w-4 accent-[var(--color-accent)]" />
              {t("wiz.kw.any")}
            </label>
          </fieldset>
          {!d.anyWord && (
            <>
              <Field label={t("ed.keywords")} htmlFor="tp-kw" hint={t("wiz.kw.hint")}>
                <Input
                  id="tp-kw"
                  value={kw}
                  onChange={(e) => {
                    setKw(e.target.value);
                    update({ ...d, keywords: words(e.target.value) });
                  }}
                  placeholder={t("wiz.kw.ph")}
                />
              </Field>
              {!isComment(tt.source) && (
                <Field label={t("ed.match.label")} htmlFor="tp-match">
                  <select id="tp-match" value={tt.match} onChange={(e) => update({ ...d, match: e.target.value as MatchMode })} className={sel}>
                    {MATCH_MODES.map((m) => (
                      <option key={m} value={m}>
                        {t(`ed.match.${m}` as Key)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
          <Field label={t("ed.excl.label")} htmlFor="tp-ex" hint={t("ed.excl.hint")}>
            <Input
              id="tp-ex"
              value={ex}
              onChange={(e) => {
                setEx(e.target.value);
                update({ ...d, excludes: words(e.target.value) });
              }}
            />
          </Field>
        </>
      )}
    </div>
  );
}

function PublicEditor({ d, update }: { d: Extract<NodeData, { kind: "public" }>; update: (d: NodeData) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState(d.replies.join("\n"));
  return (
    <Field label={t("flow.step.public")} htmlFor="pe" hint={t("wiz.reply.public.ph")}>
      <Textarea
        id="pe"
        rows={5}
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          update({ ...d, replies: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) });
        }}
      />
    </Field>
  );
}

function MessageEditor({ d, update, defaultLang }: { d: Extract<NodeData, { kind: "message" }>; update: (d: NodeData) => void; defaultLang: Lang }) {
  const { t } = useI18n();
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [err, setErr] = useState<string | null>(null);
  const [busyPdf, setBusyPdf] = useState(false);
  const text = d.text[lang] ?? "";
  const btn = d.button[lang] ?? "";
  return (
    <div className="space-y-4">
      <Tabs
        label={t("wiz.lang")}
        value={lang}
        onChange={setLang}
        items={LANGS.map((l) => ({ value: l.code, label: l.code, dot: !(d.text[l.code] ?? "").trim() && !d.pdf }))}
      />
      <Field label={t("wiz.dm.text")} htmlFor="me-t" hint={`${t("wiz.dm.chars", { n: 1000 - text.length })} · ${t("wiz.dm.vars")}`}>
        <Textarea id="me-t" rows={5} lang={lang} maxLength={1000} value={text} onChange={(e) => update({ ...d, text: { ...d.text, [lang]: e.target.value } })} />
      </Field>
      <Field label={t("ed.btn.opt")} htmlFor="me-b" hint={t("ed.msg.hint")}>
        <Input id="me-b" lang={lang} maxLength={MAX_BTN} value={btn} onChange={(e) => update({ ...d, button: { ...d.button, [lang]: e.target.value } })} />
      </Field>
      <div>
        <div className="mb-1.5 text-sm font-semibold">{t("wiz.pdf")}</div>
        {d.pdf ? (
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <FileText className="h-4 w-4 text-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{d.pdf.name}</span>
            <button onClick={() => update({ ...d, pdf: null })} aria-label={t("wiz.pdf.remove")} className="grid h-7 w-7 place-items-center rounded-md hover:bg-surface">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <input
              id="me-pdf"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setErr(null);
                if (!f) return;
                if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) return setErr(t("wiz.pdf.wrongtype"));
                if (f.size > MAX_PDF) return setErr(t("wiz.pdf.toolarge"));
                if (!remoteEnabled) return update({ ...d, pdf: { name: f.name, size: f.size } }); // demo mode keeps only the name
                setBusyPdf(true);
                try {
                  update({ ...d, pdf: await uploadPdf(f) });
                } catch (x) {
                  setErr(t(x instanceof Error && x.message === "notpdf" ? "wiz.pdf.notpdf" : "wiz.pdf.uploadfail"));
                }
                setBusyPdf(false);
                e.target.value = "";
              }}
            />
            <label htmlFor="me-pdf" className="flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed border-border-input px-3 py-4 text-center text-sm hover:bg-surface">
              <span className="font-medium text-accent">{busyPdf ? t("wiz.pdf.uploading") : t("wiz.pdf.drop")}</span>
              <span className="text-xs text-text-muted">{t("wiz.pdf.limit")}</span>
            </label>
          </>
        )}
        {err && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}

function valueInput(r: Row, set: (v: string) => void, t: ReturnType<typeof useI18n>["t"], id: string) {
  switch (r.field) {
    case "language":
      return (
        <select id={id} aria-label={t("ed.cond.value")} value={r.value} onChange={(e) => set(e.target.value)} className={sel}>
          <option value="">—</option>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      );
    case "follows":
    case "windowOpen":
      return (
        <select id={id} aria-label={t("ed.cond.value")} value={r.value} onChange={(e) => set(e.target.value)} className={sel}>
          <option value="">—</option>
          <option value="true">{t("ed.v.true")}</option>
          <option value="false">{t("ed.v.false")}</option>
        </select>
      );
    case "optin":
      return (
        <select id={id} aria-label={t("ed.cond.value")} value={r.value} onChange={(e) => set(e.target.value)} className={sel}>
          <option value="">—</option>
          <option value="comment">{t("ed.v.comment")}</option>
          <option value="ad">{t("ed.v.ad")}</option>
          <option value="dm">{t("ed.v.dm")}</option>
        </select>
      );
    case "followers":
    case "hour":
      return <Input id={id} aria-label={t("ed.cond.value")} type="number" min={0} max={r.field === "hour" ? 23 : undefined} value={r.value} onChange={(e) => set(e.target.value)} />;
    default:
      return <Input id={id} aria-label={t("ed.cond.value")} value={r.value} onChange={(e) => set(e.target.value)} />;
  }
}

function ConditionEditor({ d, update }: { d: Extract<NodeData, { kind: "condition" }>; update: (d: NodeData) => void }) {
  const { t } = useI18n();
  const setRow = (i: number, r: Row) => update({ ...d, rows: d.rows.map((x, j) => (j === i ? r : x)) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{t("ed.cond.matches")}</span>
        <select aria-label={t("ed.cond.matches")} value={d.mode} onChange={(e) => update({ ...d, mode: e.target.value as "all" | "any" })} className="h-9 rounded-md border border-border-input bg-bg px-2 text-sm font-semibold text-accent">
          <option value="all">{t("ed.cond.all")}</option>
          <option value="any">{t("ed.cond.any")}</option>
        </select>
      </div>
      <ul className="space-y-3">
        {d.rows.map((r, i) => (
          <li key={i} className="space-y-2 rounded-md border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <select
                aria-label={t("ed.cond.matches")}
                value={r.field}
                onChange={(e) => {
                  const f = e.target.value as FField;
                  setRow(i, { field: f, op: opsFor(f)[0], value: "" });
                }}
                className={sel}
              >
                {FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {t(fKey(f))}
                  </option>
                ))}
              </select>
              <button onClick={() => update({ ...d, rows: d.rows.filter((_, j) => j !== i) })} aria-label={t("ed.cond.remove")} className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-bg">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <select aria-label="op" value={r.op} onChange={(e) => setRow(i, { ...r, op: e.target.value as Row["op"] })} className={sel}>
                {opsFor(r.field).map((o) => (
                  <option key={o} value={o}>
                    {t(`ed.op.${o}` as Key)}
                  </option>
                ))}
              </select>
              {valueInput(r, (v) => setRow(i, { ...r, value: v }), t, `cv-${i}`)}
            </div>
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="sm" onClick={() => update({ ...d, rows: [...d.rows, { field: "tag", op: "is", value: "" }] })}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("ed.cond.addrow")}
      </Button>
    </div>
  );
}

function ActionsEditor({ d, update, team }: { d: Extract<NodeData, { kind: "actions" }>; update: (d: NodeData) => void; team: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const setItem = (i: number, v: { type: ActionType; value?: string }) => update({ ...d, items: d.items.map((x, j) => (j === i ? v : x)) });
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {d.items.map((it, i) => (
          <li key={i} className="space-y-2 rounded-md border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <select aria-label={t("ed.node.actions")} value={it.type} onChange={(e) => setItem(i, { type: e.target.value as ActionType, value: "" })} className={sel}>
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {t(`ed.act.${a}` as Key)}
                  </option>
                ))}
              </select>
              <button onClick={() => update({ ...d, items: d.items.filter((_, j) => j !== i) })} aria-label={t("ed.act.remove")} className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-bg">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {(it.type === "addTag" || it.type === "removeTag" || it.type === "notify") && (
              <Input aria-label={t("ed.act.value")} value={it.value ?? ""} onChange={(e) => setItem(i, { ...it, value: e.target.value })} placeholder={it.type === "notify" ? "…" : t("wiz.tag.ph")} />
            )}
            {it.type === "assign" && (
              <select aria-label={t("ed.act.value")} value={it.value ?? ""} onChange={(e) => setItem(i, { ...it, value: e.target.value })} className={sel}>
                <option value="">—</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="sm" onClick={() => update({ ...d, items: [...d.items, { type: "addTag", value: "" }] })}>
        <Plus className="h-4 w-4" aria-hidden />
        {t("ed.act.add")}
      </Button>
    </div>
  );
}

function RandomizerEditor({ d, update }: { d: Extract<NodeData, { kind: "randomizer" }>; update: (d: NodeData) => void }) {
  const { t } = useI18n();
  const sum = d.paths.reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {d.paths.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <label htmlFor={`rp-${i}`} className="w-20 shrink-0 text-sm">
              {t("ed.rand.path", { n: i + 1 })}
            </label>
            <Input id={`rp-${i}`} type="number" min={0} max={100} value={p} onChange={(e) => update({ ...d, paths: d.paths.map((x, j) => (j === i ? Math.max(0, Math.min(100, Number(e.target.value) || 0)) : x)) })} />
            <span className="text-sm text-text-muted">%</span>
            {d.paths.length > 2 && (
              <button
                onClick={() => update({ ...d, paths: d.paths.filter((_, j) => j !== i) })}
                aria-label={t("ed.rand.remove")}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md hover:bg-surface"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className={cx("text-sm", sum === 100 ? "text-success" : "text-danger")} role="status">
        {t("ed.rand.sum", { n: sum })}
      </p>
      {d.paths.length < 4 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const n = d.paths.length + 1;
            const even = Math.floor(100 / n);
            const paths = Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - even * (n - 1) : even));
            update({ ...d, paths });
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("ed.rand.add")}
        </Button>
      )}
    </div>
  );
}

function DelayEditor({ d, update }: { d: Extract<NodeData, { kind: "delay" }>; update: (d: NodeData) => void }) {
  const { t } = useI18n();
  const unit = d.minutes % 1440 === 0 && d.minutes > 0 ? 1440 : d.minutes % 60 === 0 && d.minutes > 0 ? 60 : 1;
  const [u, setU] = useState(unit);
  const val = Math.round(d.minutes / u);
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">{t("ed.delay.wait")}</div>
      <div className="grid grid-cols-[1fr_130px] gap-2">
        <Input aria-label={t("ed.delay.wait")} type="number" min={1} value={val} onChange={(e) => update({ ...d, minutes: Math.max(0, Number(e.target.value) || 0) * u })} />
        <select
          aria-label={t("ed.delay.wait")}
          value={u}
          onChange={(e) => {
            const nu = Number(e.target.value);
            setU(nu);
            update({ ...d, minutes: val * nu });
          }}
          className={sel}
        >
          <option value={1}>{t("ed.unit.min")}</option>
          <option value={60}>{t("ed.unit.hour")}</option>
          <option value={1440}>{t("ed.unit.day")}</option>
        </select>
      </div>
    </div>
  );
}
