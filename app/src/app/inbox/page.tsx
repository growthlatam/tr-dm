"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BellPlus, Check, FileText, Lock, RotateCcw, Search } from "lucide-react";
import { remoteEnabled } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  addNote,
  assignConversation,
  markRead,
  sendAgentMessage,
  setAutomationsPaused,
  setConversationState,
  setReminder,
  useStore,
  windowOpen,
  HOUR,
  type Message,
} from "@/lib/store";
import { Button, EmptyState, Input, Tabs, Textarea, cx, timeAgo } from "@/components/ui";

type Filter = "open" | "closed" | "unread";

export default function InboxPage() {
  const { t, lang } = useI18n();
  const { conversations, contacts, team } = useStore();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      conversations
        .map((c) => ({ c, contact: contacts.find((x) => x.id === c.contactId)! }))
        .filter((r) => r.contact)
        .filter((r) => (filter === "open" ? r.c.state === "open" : filter === "closed" ? r.c.state === "closed" : r.c.unread > 0))
        .filter((r) => (r.contact.name + r.contact.handle).toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.c.lastAt - a.c.lastAt),
    [conversations, contacts, filter, q],
  );
  const active = rows.find((r) => r.c.id === sel) ?? null;

  useEffect(() => {
    if (sel) markRead(sel);
  }, [sel, conversations.length]);

  return (
    <div className="flex h-[calc(100vh-var(--layout-header))] min-h-[520px] flex-col lg:h-screen">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg px-4 py-3 sm:px-6">
        <h1 className="text-lg font-bold">{t("inbox.title")}</h1>
        <Tabs
          label={t("inbox.all")}
          value={filter}
          onChange={setFilter}
          items={[
            { value: "open", label: t("inbox.filter.open") },
            { value: "unread", label: t("inbox.filter.unread") },
            { value: "closed", label: t("inbox.filter.closed") },
          ]}
        />
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-text-muted" aria-hidden />
          <Input aria-label={t("inbox.search")} placeholder={t("inbox.search")} value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[var(--layout-inbox-list)_minmax(0,1fr)]">
        <div className={cx("min-h-0 overflow-y-auto border-r border-border bg-bg", active && "hidden lg:block")}>
          {rows.length === 0 ? (
            <EmptyState title={t("inbox.empty")} text={t("inbox.empty.d")} />
          ) : (
            <ul>
              {rows.map(({ c, contact }) => {
                const last = [...c.messages].reverse().find((m) => m.kind !== "event" && m.kind !== "note");
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setSel(c.id)}
                      aria-current={sel === c.id}
                      className={cx("flex w-full gap-3 border-b border-border px-4 py-3 text-left hover:bg-surface", sel === c.id && "bg-accent-soft")}
                    >
                      <Avatar name={contact.name} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className={cx("truncate text-sm", c.unread ? "font-bold" : "font-medium")}>{contact.name}</span>
                          <span className="shrink-0 text-xs text-text-muted">{timeAgo(c.lastAt, t, lang)}</span>
                        </span>
                        <span className="block truncate text-sm text-text-muted">{last?.kind === "doc" ? `📎 ${last.text}` : last?.text}</span>
                      </span>
                      {c.unread > 0 && <span aria-label="unread" className="mt-2 h-2.5 w-2.5 shrink-0 rounded-pill bg-signature" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={cx("min-h-0 bg-bg", !active && "hidden lg:grid lg:place-items-center")}>
          {active ? (
            <Thread
              key={active.c.id}
              convId={active.c.id}
              onBack={() => setSel(null)}
              team={team}
            />
          ) : (
            <p className="text-sm text-text-muted">{t("inbox.select")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-pill bg-accent text-sm font-semibold text-on-accent">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function Thread({ convId, onBack, team }: { convId: string; onBack: () => void; team: { id: string; name: string }[] }) {
  const { t, lang } = useI18n();
  const { conversations, contacts } = useStore();
  const conv = conversations.find((c) => c.id === convId)!;
  const contact = contacts.find((c) => c.id === conv.contactId)!;
  const [tab, setTab] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const open = windowOpen(contact);
  const fmt = (n: number) => new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(n);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conv.messages.length]);

  function submit() {
    const v = text.trim();
    if (!v) return;
    if (tab === "note") addNote(conv.id, v);
    else {
      const r = sendAgentMessage(conv.id, v);
      if (!r.ok) return setErr(t("inbox.window.closed"));
    }
    setErr(null);
    setText("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <button onClick={onBack} aria-label={t("inbox.title")} className="grid h-8 w-8 place-items-center rounded-md hover:bg-surface lg:hidden">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <Avatar name={contact.name} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{contact.name}</div>
          <label className="sr-only" htmlFor="assignee">
            {t("inbox.assignee")}
          </label>
          <select
            id="assignee"
            value={conv.assignee ?? ""}
            onChange={(e) => assignConversation(conv.id, e.target.value || null)}
            className="h-7 rounded-md border border-border bg-bg px-1 text-xs text-text-muted"
          >
            <option value="">{t("inbox.unassigned")}</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link href="/contacts">
            <Button variant="ghost" size="sm">
              {t("inbox.contact.open")}
            </Button>
          </Link>
          <Button variant="secondary" size="sm" onClick={() => setReminder(conv.id, Date.now() + 24 * HOUR)}>
            <BellPlus className="h-4 w-4" aria-hidden />
            {conv.reminderAt ? t("inbox.reminder.set") : t("inbox.remind")}
          </Button>
          {conv.state === "open" ? (
            <Button variant="secondary" size="sm" onClick={() => setConversationState(conv.id, "closed")}>
              <Check className="h-4 w-4" aria-hidden />
              {t("inbox.close")}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setConversationState(conv.id, "open")}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t("inbox.reopen")}
            </Button>
          )}
        </div>
      </div>

      <div className="border-b border-border bg-surface px-4 py-2 text-xs text-text-muted" role="status">
        {open ? t("inbox.window.open", { t: fmt(contact.windowExpiresAt!) }) : t("inbox.window.closed")}
        {contact.automationsPaused && (
          <span className="ml-3 inline-flex items-center gap-2">
            {t("inbox.paused", { t: remoteEnabled ? "7 d" : "30 min" })}
            <button className="font-semibold text-accent underline" onClick={() => setAutomationsPaused(contact.id, false)}>
              {t("inbox.resume")}
            </button>
          </span>
        )}
      </div>

      <div role="log" aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {conv.messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="mb-2">
          <Tabs label={t("inbox.reply")} value={tab} onChange={setTab} items={[{ value: "reply", label: t("inbox.reply") }, { value: "note", label: t("inbox.note") }]} />
        </div>
        {err && (
          <p role="alert" className="mb-2 text-xs text-danger">
            {err}
          </p>
        )}
        <Textarea
          aria-label={tab === "note" ? t("inbox.note") : t("inbox.reply")}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tab === "note" ? t("inbox.note.ph") : t("inbox.reply.ph")}
          disabled={tab === "reply" && !open}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={submit} disabled={!text.trim() || (tab === "reply" && !open)}>
            {tab === "note" ? t("inbox.save.note") : t("inbox.send")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const { t } = useI18n();
  if (m.kind === "event")
    return (
      <p className="text-center text-xs text-text-muted">
        {m.text.startsWith("inbox.") ? t(m.text as "inbox.system.opened") : m.text}
      </p>
    );
  if (m.kind === "note")
    return (
      <div className="mx-auto flex max-w-[85%] items-start gap-2 rounded-md border border-border bg-warning-soft px-3 py-2 text-sm">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
        <span className="break-words">{m.text}</span>
      </div>
    );
  const mine = m.sender !== "contact";
  return (
    <div className={cx("flex flex-col", mine ? "items-end" : "items-start")}>
      <span className="mb-0.5 text-[11px] text-text-muted">
        {m.fromComment ? "💬 " + t("inbox.msg.comment") : m.sender === "bot" ? t("inbox.sender.bot") : m.sender === "agent" ? t("inbox.sender.you") : ""}
        {m.kind === "public" && " · public"}
      </span>
      <div className={cx("max-w-[85%] break-words rounded-lg px-3 py-2 text-sm", mine ? "bg-bubble-out text-on-bubble-out" : "bg-bubble-in text-text")}>
        {m.kind === "doc" ? (
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4" aria-hidden />
            <span>{m.text}</span>
          </span>
        ) : (
          m.text
        )}
        {m.button && <div className="mt-2 rounded-md border border-white/40 px-2 py-1 text-center font-semibold">{m.button}</div>}
      </div>
      {mine && m.status === "queued" && <span className="mt-0.5 text-[11px] text-text-muted">{t("inbox.msg.queued")}</span>}
      {mine && m.status === "failed" && <span className="mt-0.5 max-w-[85%] text-[11px] text-danger">{t("inbox.msg.failed", { why: m.failure ?? "?" })}</span>}
    </div>
  );
}

