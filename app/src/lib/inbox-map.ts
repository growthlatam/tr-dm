// Turns database rows into the shapes the inbox and contacts screens already use. Pure, so it can be tested.
import type { Lang } from "./i18n";
import type { Contact, Conversation, Message } from "./store";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const LANGS: Lang[] = ["en", "pt-BR", "es-AR"];
const ms = (v: unknown) => (v ? Date.parse(String(v)) : 0);

export function mapContact(c: Row, tags: string[], pausedUntil: string | null, now = Date.now()): Contact {
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ");
  const src = c.opt_in_source === "ad" ? "ad" : c.opt_in_source === "comment" ? "comment" : "dm";
  return {
    id: c.id,
    name: full || c.username || c.external_id,
    handle: c.username || c.external_id,
    language: (LANGS.includes(c.language) ? c.language : "pt-BR") as Lang,
    tags,
    subscribed: c.status === "subscribed" || c.status === "visitor",
    automationsPaused: !!pausedUntil && ms(pausedUntil) > now,
    optedInVia: src,
    followsAccount: c.follows_account ?? undefined,
    followers: c.follower_count ?? undefined,
    windowExpiresAt: c.window_expires_at ? ms(c.window_expires_at) : null,
    lastActivity: ms(c.last_interaction_at) || ms(c.created_at),
  };
}

export function mapMessage(r: Row): Message | null {
  const b = r.body ?? {};
  const at = ms(r.created_at);
  const base = { id: r.id as string, at, status: r.status as Message["status"], failure: (r.failure_reason as string) ?? undefined };
  if (r.kind === "event") return { ...base, kind: "event", sender: "system", text: String(b.key ?? ""), status: undefined };
  if (r.direction === "in") {
    if (r.kind === "postback") return { ...base, kind: "text", sender: "contact", text: String(b.text || b.payload || "↩"), status: undefined };
    if (b.story_mention && !b.text) return { ...base, kind: "text", sender: "contact", text: "↩ story mention", status: undefined };
    return { ...base, kind: "text", sender: "contact", text: String(b.text ?? ""), status: undefined, fromComment: r.kind === "comment" || undefined };
  }
  const sender = (r.sender === "agent" ? "agent" : r.sender === "system" ? "system" : "bot") as Message["sender"];
  if (r.kind === "public_reply") return { ...base, kind: "public", sender, text: String(b.text ?? "") };
  if (r.kind === "doc") return { ...base, kind: "doc", sender, text: String(b.name ?? "document"), nodeId: r.node_id ?? undefined };
  return { ...base, kind: "text", sender, text: String(b.text ?? ""), button: b.button || undefined, nodeId: r.node_id ?? undefined };
}

export function mapConversation(c: Row, msgs: Row[], notes: Row[]): Conversation {
  const messages: Message[] = [
    ...msgs.map(mapMessage).filter((m): m is Message => !!m),
    ...notes.map((n) => ({ id: n.id as string, kind: "note" as const, sender: "agent" as const, text: String(n.body ?? ""), at: ms(n.created_at) })),
  ].sort((a, b) => a.at - b.at);
  const lastAuto = [...msgs].reverse().find((m) => m.automation_id)?.automation_id ?? null;
  return {
    id: c.id,
    contactId: c.contact_id,
    automationId: lastAuto,
    state: c.state === "closed" ? "closed" : "open",
    assignee: c.assignee_id ?? null,
    unread: c.unread_count ?? 0,
    reminderAt: c.reminder_at ? ms(c.reminder_at) : null,
    messages,
    lastAt: ms(c.last_message_at) || (messages.length ? messages[messages.length - 1].at : ms(c.created_at)),
  };
}
