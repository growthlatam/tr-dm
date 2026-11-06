// Turns one stored webhook event into something the engine understands. Pure: no database.
import type { Channel } from "../flow";

export type Inbound = {
  channel: Channel;
  /** Instagram professional account id or Facebook Page id that received the event. */
  accountId: string;
  kind: "comment" | "message" | "postback" | "story_mention" | "ignore";
  senderId: string;
  username?: string;
  text: string;
  postId?: string;
  commentId?: string;
  mid?: string;
  adId?: string;
  /** The person replied to one of the account's stories. */
  storyReply?: boolean;
  /** Button payload for postbacks. */
  payload?: string;
  ignoreReason?: string;
};

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** `externalEventId` looks like "instagram:comments:123": the first part is Meta's `object`. */
export function normalizeEvent(externalEventId: string, payload: unknown): Inbound | null {
  const object = externalEventId.split(":")[0];
  const channel: Channel = object === "instagram" ? "instagram" : "messenger";
  const p = o(payload);
  const accountId = s(p.entry_id);
  if (!accountId || (object !== "instagram" && object !== "page")) return null;
  const skip = (reason: string, senderId = ""): Inbound => ({ channel, accountId, kind: "ignore", senderId, text: "", ignoreReason: reason });

  // ---- comments (Instagram "comments", Facebook Page "feed") ----
  if (p.change) {
    const ch = o(p.change);
    const v = o(ch.value);
    if (ch.field === "comments") {
      const from = o(v.from);
      if (s(from.id) === accountId) return skip("own comment", s(from.id));
      if (v.parent_id) return skip("reply to a comment");
      return { channel, accountId, kind: "comment", senderId: s(from.id), username: s(from.username) || undefined, text: s(v.text), postId: s(o(v.media).id) || undefined, commentId: s(v.id) };
    }
    if (ch.field === "feed") {
      if (v.item !== "comment" || v.verb !== "add") return skip("not a new comment");
      const from = o(v.from);
      if (s(from.id) === accountId) return skip("own comment", s(from.id));
      if (v.parent_id && s(v.parent_id) !== s(v.post_id)) return skip("reply to a comment");
      return { channel, accountId, kind: "comment", senderId: s(from.id), username: s(from.name) || undefined, text: s(v.message), postId: s(v.post_id) || undefined, commentId: s(v.comment_id) };
    }
    if (ch.field === "mentions") {
      const media = s(v.media_id);
      return skip(media ? "post or comment mention (not a story)" : "mention");
    }
    return skip(`unhandled field ${s(ch.field)}`);
  }

  // ---- messaging (DMs, story replies and mentions, button taps, ad entry) ----
  const m = o(p.messaging);
  const senderId = s(o(m.sender).id);
  if (!senderId) return skip("no sender");
  if (senderId === accountId) return skip("echo of our own message", senderId);
  const msg = o(m.message);
  const post = o(m.postback);
  const ref = o(m.referral ?? msg.referral);
  const adId = s(ref.ad_id) || undefined;
  if (msg.is_echo) return skip("echo", senderId);
  if (m.postback) return { channel, accountId, kind: "postback", senderId, text: s(post.title), payload: s(post.payload), mid: s(post.mid) || undefined };
  if (m.message) {
    const attachments = Array.isArray(msg.attachments) ? (msg.attachments as Obj[]) : [];
    if (attachments.some((a) => a.type === "story_mention")) return { channel, accountId, kind: "story_mention", senderId, text: "", mid: s(msg.mid) || undefined };
    const quick = o(msg.quick_reply);
    if (quick.payload) return { channel, accountId, kind: "postback", senderId, text: s(msg.text), payload: s(quick.payload), mid: s(msg.mid) || undefined };
    const text = s(msg.text);
    if (!text && !attachments.length) return skip("empty message", senderId);
    return { channel, accountId, kind: "message", senderId, text, mid: s(msg.mid) || undefined, adId, storyReply: !!o(msg.reply_to).story };
  }
  if (m.referral) return { channel, accountId, kind: "message", senderId, text: "", adId, mid: undefined };
  return skip("receipt or unknown", senderId);
}

// ---- opt-out and opt-in words (Meta and local rules: always honour a request to stop) ----
const strip = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
const STOP = ["stop", "unsubscribe", "cancel", "cancelar", "parar", "pare", "sair", "baja", "darme de baja", "desuscribir", "desinscrever", "descadastrar", "cancelar suscripcion"];
const START = ["start", "subscribe", "iniciar", "comecar", "suscribir", "suscribirme", "voltar"];
export const isStopWord = (t: string) => STOP.includes(strip(t));
export const isStartWord = (t: string) => START.includes(strip(t));

export const STOP_CONFIRMATION: Record<"en" | "pt-BR" | "es-AR", string> = {
  en: "Done. You will not get more automated messages from us. Send START to receive them again.",
  "pt-BR": "Pronto. Você não receberá mais mensagens automáticas nossas. Envie INICIAR para voltar a recebê-las.",
  "es-AR": "Listo. No vas a recibir más mensajes automáticos nuestros. Escribí INICIAR para volver a recibirlos.",
};
