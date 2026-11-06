"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { LANGS, useI18n, type Key, type Lang } from "@/lib/i18n";
import { isComment, triggerOf, usesKeywords, type TriggerData } from "@/lib/flow";
import { fastForwardWaits, simulateEvent, simulateTap, useSimStore } from "@/lib/store";
import { Button, Card, Field, Input } from "./ui";

/** Simulates a person commenting. Nothing leaves the browser. */
export function Tester({ savedId, keyword, defaultLang, advanced, trigger }: { savedId?: string; keyword: string; defaultLang: Lang; advanced?: boolean; trigger?: TriggerData }) {
  const { t } = useI18n();
  const { conversations, contacts, waits, posts } = useSimStore();
  const tt = trigger ? triggerOf(trigger) : null;
  const source = tt?.source ?? "ig_comment";
  const comment_ = isComment(source);
  const shown = posts.filter((p) => (p.net ?? "instagram") === (source === "fb_comment" ? "facebook" : "instagram"));
  const [postId, setPostId] = useState<string>(trigger?.postId ?? "");
  const [adId, setAdId] = useState(tt?.adId ?? "");
  const [handle, setHandle] = useState("visitor_" + Math.floor(Math.random() * 900 + 100));
  const [comment, setComment] = useState(source === "story_mention" ? t("ed.t.mention.text") : usesKeywords(source) ? keyword : "👋");
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [follows, setFollows] = useState(false);
  const [followers, setFollowers] = useState(120);
  const [optin, setOptin] = useState<"comment" | "ad">("comment");
  const [msg, setMsg] = useState<string | null>(null);
  const [conv, setConv] = useState<string | null>(null);
  const [tapped, setTapped] = useState(false);

  const c = conversations.find((x) => x.id === conv);
  const person = c && contacts.find((x) => x.id === c.contactId);
  const myWaits = waits.filter((w) => w.conversationId === conv).length;
  const canTap = !!c && !tapped && [...c.messages].some((m) => m.button && m.nodeId);

  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">{t("wiz.test.title")}</h2>
      <p className="text-xs text-text-muted">{t("wiz.test.d")}</p>
      <Field label={t("wiz.test.handle")} htmlFor="t-handle">
        <Input id="t-handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
      </Field>
      {source !== "story_mention" && (
        <Field label={t(comment_ ? "wiz.test.comment" : "ed.t.message")} htmlFor="t-comment">
          <Input id="t-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      )}
      {advanced && comment_ && (
        <Field label={t("ed.t.post")} htmlFor="t-post">
          <select id="t-post" value={postId} onChange={(e) => setPostId(e.target.value)} className="h-10 w-full rounded-md border border-border-input bg-bg px-2 text-sm">
            <option value="">—</option>
            {shown.map((p) => (
              <option key={p.id} value={p.id}>
                {p.caption}
              </option>
            ))}
          </select>
        </Field>
      )}
      {advanced && source === "ad" && (
        <Field label={t("ed.t.adid")} htmlFor="t-ad">
          <Input id="t-ad" value={adId} onChange={(e) => setAdId(e.target.value)} className="font-mono" />
        </Field>
      )}
      <Field label={t("wiz.lang")} htmlFor="t-lang">
        <select id="t-lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="h-10 w-full rounded-md border border-border-input bg-bg px-2 text-sm">
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      {advanced && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={follows} onChange={(e) => setFollows(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            {t("ed.t.follows")}
          </label>
          <Field label={t("ed.t.followers")} htmlFor="t-followers">
            <Input id="t-followers" type="number" min={0} value={followers} onChange={(e) => setFollowers(Number(e.target.value))} />
          </Field>
          {comment_ && (
          <Field label={t("ed.t.optin")} htmlFor="t-optin">
            <select id="t-optin" value={optin} onChange={(e) => setOptin(e.target.value as "comment" | "ad")} className="h-10 w-full rounded-md border border-border-input bg-bg px-2 text-sm">
              <option value="comment">{t("ed.v.comment")}</option>
              <option value="ad">{t("ed.v.ad")}</option>
            </select>
          </Field>
          )}
        </>
      )}
      {!savedId && <p className="text-xs text-warning">{t("wiz.test.needsave")}</p>}
      <Button
        className="w-full"
        disabled={!savedId}
        onClick={() => {
          if (!savedId) return;
          const r = simulateEvent(savedId, { handle, language: lang, follows, followers, optin }, { text: comment, postId: postId || null, adId });
          setTapped(false);
          setConv(r.conversationId ?? null);
          setMsg(
            r.result === "ok"
              ? t("wiz.test.result.ok")
              : r.result === "dup"
                ? t("wiz.test.result.dup")
                : r.result === "handled"
                  ? t("ed.t.result.handled")
                  : r.result === "freq"
                    ? t("ed.t.result.freq")
                    : t("wiz.test.result.nomatch"),
          );
          if (r.result === "ok") setHandle("visitor_" + Math.floor(Math.random() * 900 + 100));
        }}
      >
        <Send className="h-4 w-4" aria-hidden />
        {t(comment_ ? "wiz.test.send" : "ed.t.sendmsg")}
      </Button>
      {msg && (
        <p role="status" className="text-sm">
          {msg}
        </p>
      )}
      {canTap && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            simulateTap(conv!);
            setTapped(true);
          }}
        >
          {t("wiz.test.tap")}
        </Button>
      )}
      {advanced && waits.length > 0 && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            const n = fastForwardWaits();
            setMsg(t("ed.t.ff.done", { n }));
          }}
        >
          {t("ed.t.ff")} ({t("ed.t.waiting", { n: waits.length })})
        </Button>
      )}
      {advanced && c && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">
            {t("ed.t.transcript")}
            {person && <span className="font-normal text-text-muted"> · @{person.handle}</span>}
            {myWaits > 0 && <span className="font-normal text-text-muted"> · {t("ed.t.waiting", { n: myWaits })}</span>}
          </h3>
          <ol className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border bg-surface p-2 text-xs">
            {c.messages.map((m) => (
              <li key={m.id} className={m.sender === "contact" ? "text-text" : m.kind === "event" ? "italic text-text-muted" : "text-accent"}>
                {m.sender === "contact" ? "◀ " : m.kind === "event" ? "" : "▶ "}
                {m.kind === "event" && m.text.startsWith("inbox.") ? t(m.text as Key) : m.kind === "doc" ? `📎 ${m.text}` : m.text}
                {m.button ? ` [${m.button}]` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
