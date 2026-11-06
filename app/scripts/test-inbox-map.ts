// Offline checks for turning database rows into inbox messages. Run: npx tsx scripts/test-inbox-map.ts
import { mapContact, mapConversation, mapMessage } from "../src/lib/inbox-map";
let fails = 0;
const ck = (n: string, ok: boolean, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  " + x)); if (!ok) fails++; };
const T = (m: number) => new Date(Date.UTC(2026, 10, 5, 12, m)).toISOString();

const c = mapContact({ id: "c1", external_id: "17841", username: "ana", first_name: null, last_name: null, status: "subscribed", language: "es-AR", opt_in_source: "comment", window_expires_at: new Date(Date.now() + 3600_000).toISOString(), last_interaction_at: T(0), created_at: T(0) }, ["lead"], null);
ck("contact: handle and name from the username, language kept, tags carried", c.handle === "ana" && c.name === "ana" && c.language === "es-AR" && c.tags[0] === "lead" && c.subscribed && c.optedInVia === "comment");
ck("contact: an open window reads as open", !!c.windowExpiresAt && c.windowExpiresAt > Date.now());
const c2 = mapContact({ id: "c2", external_id: "9", username: null, first_name: "Ana", last_name: "Lima", status: "unsubscribed", language: "xx", opt_in_source: "ad", created_at: T(0) }, [], new Date(Date.now() + 3600_000).toISOString());
ck("contact: full name wins, unknown language falls back, unsubscribed and paused are reflected", c2.name === "Ana Lima" && c2.language === "pt-BR" && !c2.subscribed && c2.automationsPaused && c2.optedInVia === "ad");

const rows = [
  { id: "m1", direction: "in", sender: "contact", kind: "comment", body: { text: "quero o guia" }, status: "delivered", created_at: T(1) },
  { id: "m2", direction: "out", sender: "bot", kind: "public_reply", body: { text: "Enviado!" }, status: "sent", created_at: T(2), automation_id: "a1" },
  { id: "m3", direction: "out", sender: "bot", kind: "text", body: { text: "Olá!", button: "Quero", mode: "private_reply" }, status: "queued", created_at: T(3), automation_id: "a1", node_id: "n1" },
  { id: "m4", direction: "in", sender: "contact", kind: "postback", body: { text: "Quero", payload: "tap:x:n1" }, status: "delivered", created_at: T(4) },
  { id: "m5", direction: "out", sender: "bot", kind: "doc", body: { name: "g.pdf" }, status: "failed", failure_reason: "documents need a public file URL", created_at: T(5), automation_id: "a1" },
  { id: "m6", direction: "out", sender: "system", kind: "event", body: { key: "inbox.system.blocked" }, status: "failed", created_at: T(6) },
  { id: "m7", direction: "out", sender: "agent", kind: "text", body: { text: "Oi, posso ajudar?" }, status: "queued", created_at: T(7) },
  { id: "m8", direction: "in", sender: "contact", kind: "text", body: { story_mention: true, text: "" }, status: "delivered", created_at: T(8) },
];
const conv = mapConversation({ id: "v1", contact_id: "c1", state: "open", assignee_id: "u1", unread_count: 2, reminder_at: null, last_message_at: T(8), created_at: T(0) }, rows, [{ id: "n1", body: "cliente quente", created_at: T(9) }]);
const kinds = conv.messages.map((m) => `${m.sender}:${m.kind}`);
ck("conversation: messages and notes are merged in time order", conv.messages.length === 9 && conv.messages[conv.messages.length - 1].kind === "note", kinds.join(","));
ck("conversation: unread, assignee and state carried over", conv.unread === 2 && conv.assignee === "u1" && conv.state === "open");
ck("conversation: the latest automation is found from the messages", conv.automationId === "a1");
const m3 = conv.messages.find((m) => m.id === "m3")!;
ck("bot message: text, button and delivery state", m3.text === "Olá!" && m3.button === "Quero" && m3.status === "queued" && m3.sender === "bot");
const m5 = conv.messages.find((m) => m.id === "m5")!;
ck("document: shown by file name, failure reason kept", m5.kind === "doc" && m5.text === "g.pdf" && m5.status === "failed" && /file URL/.test(m5.failure ?? ""));
ck("public reply is marked public", conv.messages.find((m) => m.id === "m2")!.kind === "public");
ck("system event keeps its i18n key", conv.messages.find((m) => m.id === "m6")!.text === "inbox.system.blocked" && conv.messages.find((m) => m.id === "m6")!.kind === "event");
ck("agent message is shown as the agent's", conv.messages.find((m) => m.id === "m7")!.sender === "agent");
ck("inbound comment and button tap come from the contact without a status", conv.messages.find((m) => m.id === "m1")!.sender === "contact" && conv.messages.find((m) => m.id === "m4")!.text === "Quero" && conv.messages.find((m) => m.id === "m1")!.status === undefined);
ck("a public comment is flagged so the inbox can label it", conv.messages.find((m) => m.id === "m1")!.fromComment === true && conv.messages.find((m) => m.id === "m4")!.fromComment !== true);
ck("an empty story mention still shows something", conv.messages.find((m) => m.id === "m8")!.text.length > 0);
ck("a message with no kind we know does not crash", mapMessage({ id: "x", direction: "out", sender: "bot", kind: "weird", body: null, created_at: T(1) }) !== null);
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
