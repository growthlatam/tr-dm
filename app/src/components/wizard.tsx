"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Heart, Trash2 } from "lucide-react";
import { remoteEnabled } from "@/lib/supabase/client";
import { uploadPdf } from "@/lib/remote";
import { LANGS, useI18n, type Lang } from "@/lib/i18n";
import { saveAutomation, useStore, type Automation, type Post, type PostScope } from "@/lib/store";
import { Tester } from "./tester";
import { Badge, Button, Card, Field, Input, Tabs, Textarea, Toggle, cx } from "./ui";

const MAX_DM = 1000;
const MAX_BTN = 20;
const MAX_PDF = 25 * 1024 * 1024;

function splitWords(s: string) {
  return s
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function fmtSize(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export function Wizard({ existing }: { existing?: Automation }) {
  const { t, lang: uiLang } = useI18n();
  const router = useRouter();
  const { posts: demoPosts, activeAccount } = useStore();
  // Signed in: the account's real latest posts and reels. Otherwise the demo ones.
  const [livePosts, setLivePosts] = useState<Post[] | null>(null);
  const [postsState, setPostsState] = useState<"idle" | "loading" | "error">("idle");
  useEffect(() => {
    if (!remoteEnabled || !activeAccount) return;
    let alive = true;
    setPostsState("loading");
    fetch(`/api/channels/${activeAccount}/media`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { posts: (Omit<Post, "hue"> & { hue?: number })[] }) => {
        if (!alive) return;
        setLivePosts(j.posts.map((p) => ({ ...p, hue: [...p.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7) })));
        setPostsState("idle");
      })
      .catch(() => {
        if (alive) {
          setLivePosts([]);
          setPostsState("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [activeAccount]);
  const posts = remoteEnabled ? livePosts ?? [] : demoPosts;

  const [name, setName] = useState(existing?.name ?? "");
  const [scope, setScope] = useState<PostScope>(existing?.postScope ?? "specific");
  const [postId, setPostId] = useState<string | null>(existing?.postId ?? null);
  const [idInput, setIdInput] = useState("");
  const [anyWord, setAnyWord] = useState(existing?.anyWord ?? false);
  const [kw, setKw] = useState(existing?.keywords.join(", ") ?? "");
  const [pub, setPub] = useState(existing?.publicReply ?? true);
  const [pubText, setPubText] = useState(existing?.publicReplies.join("\n") ?? "");
  const [dmText, setDmText] = useState<Partial<Record<Lang, string>>>(existing?.dm.text ?? {});
  const [dmBtn, setDmBtn] = useState<Partial<Record<Lang, string>>>(existing?.dm.button ?? {});
  const [defaultLang] = useState<Lang>(existing?.defaultLang ?? uiLang);
  const [dmLang, setDmLang] = useState<Lang>(existing?.defaultLang ?? uiLang);
  const [pdf, setPdf] = useState(existing?.pdf ?? null);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const [tag, setTag] = useState(existing?.tag ?? "");
  const [follow, setFollow] = useState(existing?.requireFollow ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedId, setSavedId] = useState<string | undefined>(existing?.id);
  const [preview, setPreview] = useState<"post" | "comments" | "dm">("post");
  const fileRef = useRef<HTMLInputElement>(null);

  const words = useMemo(() => splitWords(kw), [kw]);
  const post = posts.find((p) => p.id === postId);
  const curText = dmText[dmLang] ?? "";
  const curBtn = dmBtn[dmLang] ?? "";

  function buildInput(status?: Automation["status"]) {
    return {
      name: name.trim(),
      postScope: scope,
      postId: scope === "specific" ? postId : null,
      anyWord,
      keywords: anyWord ? [] : words,
      publicReply: pub,
      publicReplies: pub ? pubText.split("\n").map((s) => s.trim()).filter(Boolean) : [],
      dm: { text: dmText, button: dmBtn },
      defaultLang,
      pdf,
      tag: tag.trim(),
      requireFollow: follow,
      status,
    };
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t("wiz.err.name");
    if (scope === "specific" && !postId) e.post = t("wiz.err.post");
    if (!anyWord && words.length === 0) e.kw = t("wiz.err.kw");
    const label = LANGS.find((l) => l.code === defaultLang)?.label ?? defaultLang;
    if (!(dmText[defaultLang] ?? "").trim()) e.dm = t("wiz.err.dm", { lang: label });
    const b = (dmBtn[defaultLang] ?? "").trim();
    if (!b || b.length > MAX_BTN) e.btn = t("wiz.err.btn");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onPdf(f: File | undefined) {
    setPdfErr(null);
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) return setPdfErr(t("wiz.pdf.wrongtype"));
    if (f.size > MAX_PDF) return setPdfErr(t("wiz.pdf.toolarge"));
    if (!remoteEnabled) return setPdf({ name: f.name, size: f.size });
    try {
      setPdf(await uploadPdf(f));
    } catch (x) {
      setPdfErr(t(x instanceof Error && x.message === "notpdf" ? "wiz.pdf.notpdf" : "wiz.pdf.uploadfail"));
    }
  }

  function save(status?: Automation["status"]) {
    if (!validate()) {
      document.getElementById("wiz-errors")?.focus();
      return;
    }
    const a = saveAutomation(buildInput(status) as never, savedId);
    setSavedId(a.id);
    if (status === "live") router.push(`/automations/${a.id}`);
  }

  const langItems = LANGS.map((l) => ({
    value: l.code,
    label: l.code,
    dot: !(dmText[l.code] ?? "").trim() || !(dmBtn[l.code] ?? "").trim(),
  }));

  return (
    <div className="mx-auto max-w-content px-4 pb-16 pt-6 sm:px-8">
      <Link href="/automations" className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("flow.back")}
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t("wiz.title")}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => save()}>
            {t("wiz.save")}
          </Button>
          <Button onClick={() => save("live")}>{t("wiz.activate")}</Button>
        </div>
      </div>

      {Object.keys(errors).length > 0 && (
        <div id="wiz-errors" tabIndex={-1} role="alert" className="mb-4 rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
          <ul className="list-disc pl-4">
            {Object.values(errors).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card className="p-5">
            <Field label={t("wiz.name")} htmlFor="wiz-name" error={errors.name}>
              <Input id="wiz-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("wiz.name.ph")} invalid={!!errors.name} maxLength={80} />
            </Field>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">1. {t("wiz.s1")}</h2>
            <fieldset className="space-y-2">
              <legend className="sr-only">{t("wiz.s1")}</legend>
              {(
                [
                  ["specific", t("wiz.post.specific")],
                  ["all", t("wiz.post.all")],
                  ["next", t("wiz.post.next")],
                ] as [PostScope, string][]
              ).map(([v, label]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="scope" checked={scope === v} onChange={() => setScope(v)} className="h-4 w-4 accent-[var(--color-accent)]" />
                  {label}
                </label>
              ))}
            </fieldset>
            {scope === "specific" && (
              <div className="space-y-3">
                {remoteEnabled && postsState === "loading" && <p role="status" className="text-sm text-text-muted">{t("wiz.post.loading")}</p>}
                {remoteEnabled && postsState === "error" && <p role="alert" className="text-sm text-danger">{t("wiz.post.err")}</p>}
                {remoteEnabled && postsState === "idle" && livePosts?.length === 0 && <p className="text-sm text-text-muted">{t("wiz.post.none")}</p>}
                <ul role="radiogroup" aria-label={t("wiz.post.specific")} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {posts.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={postId === p.id}
                        onClick={() => setPostId(p.id)}
                        className={cx("w-full overflow-hidden rounded-md border-2 text-left", postId === p.id ? "border-accent" : "border-border")}
                      >
                        {p.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="block aspect-square w-full object-cover" />
                        ) : (
                          <span aria-hidden className="block aspect-square" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 60% 35%), hsl(${(p.hue + 50) % 360} 70% 55%))` }} />
                        )}
                        <span className="block truncate px-2 py-1.5 text-xs">{p.caption}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label={t("wiz.post.id")} htmlFor="wiz-postid">
                      <Input id="wiz-postid" value={idInput} onChange={(e) => setIdInput(e.target.value)} placeholder={t("wiz.post.id.ph")} />
                    </Field>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!idInput.trim()}
                    onClick={() => {
                      setPostId(idInput.trim());
                      setIdInput("");
                    }}
                  >
                    {t("wiz.post.id.use")}
                  </Button>
                </div>
                {postId && !post && (
                  <p className="text-sm text-text-muted">
                    ID: <span className="font-mono">{postId}</span>
                  </p>
                )}
                {errors.post && (
                  <p role="alert" className="text-xs text-danger">
                    {errors.post}
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">2. {t("wiz.s2")}</h2>
            <fieldset className="space-y-2">
              <legend className="sr-only">{t("wiz.s2")}</legend>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="kw" checked={!anyWord} onChange={() => setAnyWord(false)} className="h-4 w-4 accent-[var(--color-accent)]" />
                {t("wiz.kw.some")}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="kw" checked={anyWord} onChange={() => setAnyWord(true)} className="h-4 w-4 accent-[var(--color-accent)]" />
                {t("wiz.kw.any")}
              </label>
            </fieldset>
            {!anyWord && (
              <div className="space-y-2">
                <Input aria-label={t("wiz.kw.some")} value={kw} onChange={(e) => setKw(e.target.value)} placeholder={t("wiz.kw.ph")} invalid={!!errors.kw} />
                <div className="flex flex-wrap gap-1.5" aria-live="polite">
                  {words.map((w) => (
                    <Badge key={w} tone="info">
                      {w}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-text-muted">{t("wiz.kw.hint")}</p>
              </div>
            )}
            <Toggle checked={pub} onChange={setPub} label={t("wiz.reply.public")} />
            {pub && <Textarea aria-label={t("wiz.reply.public")} rows={3} value={pubText} onChange={(e) => setPubText(e.target.value)} placeholder={t("wiz.reply.public.ph")} />}
          </Card>

          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">3. {t("wiz.s3")}</h2>
              <Tabs label={t("wiz.lang")} value={dmLang} onChange={setDmLang} items={langItems} />
            </div>
            {dmLang !== defaultLang && !curText.trim() && <p className="text-xs text-warning">{t("wiz.lang.missing")}</p>}
            <Field label={t("wiz.dm.text")} htmlFor="wiz-dm" error={dmLang === defaultLang ? errors.dm : null} hint={`${t("wiz.dm.chars", { n: MAX_DM - curText.length })} · ${t("wiz.dm.vars")}`}>
              <Textarea
                id="wiz-dm"
                rows={5}
                lang={dmLang}
                maxLength={MAX_DM}
                value={curText}
                onChange={(e) => setDmText({ ...dmText, [dmLang]: e.target.value })}
                invalid={dmLang === defaultLang && !!errors.dm}
              />
            </Field>
            <Field label={t("wiz.dm.button")} htmlFor="wiz-btn" hint={t("wiz.dm.button.hint")} error={dmLang === defaultLang ? errors.btn : null}>
              <Input id="wiz-btn" lang={dmLang} maxLength={MAX_BTN} value={curBtn} onChange={(e) => setDmBtn({ ...dmBtn, [dmLang]: e.target.value })} invalid={dmLang === defaultLang && !!errors.btn} />
            </Field>

            <div>
              <div className="mb-1.5 text-sm font-semibold">{t("wiz.pdf")}</div>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" id="wiz-pdf" onChange={(e) => onPdf(e.target.files?.[0])} />
              {pdf ? (
                <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm">
                  <FileText className="h-5 w-5 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{pdf.name}</span>
                  <span className="text-text-muted">{fmtSize(pdf.size)}</span>
                  <button onClick={() => setPdf(null)} aria-label={t("wiz.pdf.remove")} className="grid h-8 w-8 place-items-center rounded-md hover:bg-surface">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="wiz-pdf"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    onPdf(e.dataTransfer.files?.[0]);
                  }}
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed border-border-input px-4 py-6 text-center text-sm hover:bg-surface"
                >
                  <FileText className="h-5 w-5 text-text-muted" aria-hidden />
                  <span className="font-medium text-accent">{t("wiz.pdf.drop")}</span>
                  <span className="text-xs text-text-muted">{t("wiz.pdf.limit")}</span>
                </label>
              )}
              {pdfErr && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {pdfErr}
                </p>
              )}
            </div>

            <Field label={t("wiz.tag")} htmlFor="wiz-tag">
              <Input id="wiz-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t("wiz.tag.ph")} maxLength={40} />
            </Field>
            <Toggle checked={follow} onChange={setFollow} label={t("wiz.follow")} />
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Phone
            tab={preview}
            setTab={setPreview}
            post={post?.caption ?? (scope === "specific" ? "" : t(scope === "all" ? "wiz.post.all" : "wiz.post.next"))}
            comment={anyWord ? "…" : words[0] ?? "…"}
            publicReply={pub ? pubText.split("\n").find((l) => l.trim()) ?? "" : ""}
            dm={curText}
            btn={curBtn}
            pdf={pdf?.name}
          />
          <Tester savedId={savedId} keyword={anyWord ? "info" : words[0] ?? "info"} defaultLang={defaultLang} />
        </aside>
      </div>
    </div>
  );
}

function Phone({
  tab,
  setTab,
  post,
  comment,
  publicReply,
  dm,
  btn,
  pdf,
}: {
  tab: "post" | "comments" | "dm";
  setTab: (t: "post" | "comments" | "dm") => void;
  post: string;
  comment: string;
  publicReply: string;
  dm: string;
  btn: string;
  pdf?: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-3 flex justify-center">
        <Tabs
          label={t("wiz.preview")}
          value={tab}
          onChange={setTab}
          items={[
            { value: "post", label: t("wiz.preview.post") },
            { value: "comments", label: t("wiz.preview.comments") },
            { value: "dm", label: t("wiz.preview.dm") },
          ]}
        />
      </div>
      <div className="mx-auto h-[420px] w-[250px] overflow-hidden rounded-[28px] border-[6px] border-text bg-accent p-3 text-xs text-on-accent" aria-label={t("wiz.preview")} role="img">
        {tab === "post" && (
          <div className="flex h-full flex-col gap-3">
            <div aria-hidden className="aspect-square rounded-md bg-gradient-to-br from-accent-soft to-signature" />
            <div className="flex gap-3" aria-hidden>
              <Heart className="h-4 w-4" />
            </div>
            <p className="line-clamp-3">{post}</p>
          </div>
        )}
        {tab === "comments" && (
          <div className="space-y-3">
            <div className="font-semibold">{t("wiz.preview.comments")}</div>
            <p>
              <span className="font-semibold">visitor </span>
              {comment}
            </p>
            {publicReply && (
              <p className="ml-4 rounded-md bg-white/10 p-2">
                <span className="font-semibold">tr_marketing </span>
                {publicReply}
              </p>
            )}
          </div>
        )}
        {tab === "dm" && (
          <div className="space-y-2">
            <div className="max-w-[90%] rounded-lg bg-white/15 p-2.5 text-[11px] leading-snug">{dm || "…"}</div>
            {btn && <div className="max-w-[90%] rounded-md bg-white/10 px-2.5 py-1.5 text-center font-semibold">{btn}</div>}
            {pdf && (
              <div className="mt-4 flex max-w-[90%] items-center gap-2 rounded-lg bg-white/15 p-2.5">
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{pdf}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
