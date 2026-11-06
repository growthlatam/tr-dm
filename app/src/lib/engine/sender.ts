// Sends queued messages through the Instagram API. Off unless META_SEND_ENABLED=true, so nothing leaves by accident.
import type { SupabaseClient } from "@supabase/supabase-js";
import { graphBase } from "../channels";
import { decryptToken } from "../crypto";

type DB = SupabaseClient;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type F = typeof fetch;

const LEASE_MS = 5 * 60_000;
const RETRY_MS = 2 * 60_000;
const GIVE_UP_MS = 60 * 60_000;
const PRIVATE_REPLY_DAYS = 7;
const TEXT_BYTES = 1000; // Meta: text must be 1000 bytes or less
const BUTTON_TEXT = 640;
const BUTTON_TITLE = 20;

/** Cuts text to a byte limit without splitting a character. */
export function clipBytes(s: string, max: number): string {
  if (Buffer.byteLength(s, "utf8") <= max) return s;
  let out = "";
  for (const ch of s) {
    if (Buffer.byteLength(out + ch, "utf8") > max - 3) break; // leave room for the 3-byte ellipsis
    out += ch;
  }
  return out + "…";
}

type Built = { url: string; body: unknown } | { skip: string };

/** The request for one queued message, or the reason it cannot be sent. */
export function buildRequest(msg: Row, igId: string, contact: Row | null, now: Date): Built {
  const b = msg.body ?? {};
  const base = graphBase();
  if (msg.kind === "public_reply") {
    if (!b.comment_id) return { skip: "no comment id" };
    return { url: `${base}/${b.comment_id}/replies`, body: { message: clipBytes(String(b.text ?? ""), TEXT_BYTES) } };
  }
  if (msg.kind === "doc") {
    if (!b.url) return { skip: "this document has no stored file: upload it again in the flow editor" };
    if (b.mode === "private_reply") return { skip: "documents cannot be a private reply" };
  }
  let recipient: Record<string, string>;
  if (b.mode === "private_reply") {
    if (!b.recipient?.comment_id) return { skip: "no comment id" };
    if (now.getTime() - new Date(msg.created_at).getTime() > PRIVATE_REPLY_DAYS * 86_400_000) return { skip: "comment is older than 7 days" };
    recipient = { comment_id: b.recipient.comment_id };
  } else {
    if (!b.recipient?.id) return { skip: "no recipient" };
    const exp = contact?.window_expires_at ? new Date(contact.window_expires_at) : null;
    if (!exp || exp <= now) return { skip: "24h window closed" };
    recipient = { id: b.recipient.id };
  }
  const url = `${base}/${igId}/messages`;
  if (msg.kind === "doc") return { url, body: { recipient, message: { attachment: { type: "file", payload: { url: b.url } } } } };
  const text = String(b.text ?? "");
  if (b.button && b.payload) {
    return { url, body: { recipient, message: { attachment: { type: "template", payload: { template_type: "button", text: [...text].slice(0, BUTTON_TEXT).join(""), buttons: [{ type: "postback", title: [...String(b.button)].slice(0, BUTTON_TITLE).join(""), payload: b.payload }] } } } } };
  }
  return { url, body: { recipient, message: { text: clipBytes(text, TEXT_BYTES) } } };
}

export type SendResult = { disabled?: boolean; sent: number; failed: number; retry: number; skipped: number };

export async function sendQueued(db: DB, opts: { limit?: number; fetchImpl?: F; now?: Date; enabled?: boolean; orgId?: string } = {}): Promise<SendResult> {
  const out: SendResult = { sent: 0, failed: 0, retry: 0, skipped: 0 };
  if (!(opts.enabled ?? process.env.META_SEND_ENABLED === "true")) return { ...out, disabled: true };
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  let query = db.from("messages").select("*").eq("direction", "out").in("sender", ["bot", "agent"]).eq("status", "queued");
  if (opts.orgId) query = query.eq("org_id", opts.orgId);
  const { data: queue } = await query.in("kind", ["text", "doc", "public_reply"]).or(`scheduled_for.is.null,scheduled_for.lte.${now.toISOString()}`).order("created_at").limit(opts.limit ?? 25);
  const accounts = new Map<string, Row | null>();
  const fail = (id: string, reason: string) => db.from("messages").update({ status: "failed", failure_reason: reason.slice(0, 300), scheduled_for: null }).eq("id", id);

  for (const m of (queue ?? []) as Row[]) {
    // lease: whoever moves scheduled_for first owns the message for a few minutes
    const lease = new Date(now.getTime() + LEASE_MS).toISOString();
    const claim = await db.from("messages").update({ scheduled_for: lease }).eq("id", m.id).eq("status", "queued").or(m.scheduled_for ? `scheduled_for.eq.${m.scheduled_for}` : "scheduled_for.is.null").select("id");
    if (claim.error || !claim.data?.length) continue;

    if (!accounts.has(m.channel_account_id)) accounts.set(m.channel_account_id, ((await db.from("channel_accounts").select("id,channel,external_ig_id,access_token_enc,token_expires_at,status").eq("id", m.channel_account_id).maybeSingle()).data as Row) ?? null);
    const acc = accounts.get(m.channel_account_id);
    if (!acc || acc.status === "disconnected") { await fail(m.id, "account disconnected"); out.failed++; continue; }
    if (acc.channel !== "instagram") { await fail(m.id, "sending on Messenger is not built yet"); out.failed++; continue; }
    if (!acc.access_token_enc) { await fail(m.id, "no access token"); out.failed++; continue; }
    if (acc.token_expires_at && new Date(acc.token_expires_at) < now) { await fail(m.id, "access token expired: reconnect the account"); out.failed++; continue; }

    const conv = ((await db.from("conversations").select("contact_id").eq("id", m.conversation_id).maybeSingle()).data as Row) ?? null;
    const contact = conv ? (((await db.from("contacts").select("id,status,window_expires_at").eq("id", conv.contact_id).maybeSingle()).data as Row) ?? null) : null;
    // automation messages stop for people who opted out; the confirmation of the opt-out itself (no automation) still goes
    if (contact && (contact.status === "unsubscribed" || contact.status === "blocked") && m.automation_id) {
      await fail(m.id, `contact is ${contact.status}`); out.skipped++; continue;
    }

    if (m.kind === "doc" && m.body?.path && !m.body?.url) {
      // the file stays private; Meta gets a link that stops working after an hour
      const signed = await db.storage.from("assets").createSignedUrl(String(m.body.path), 3600);
      if (signed.error || !signed.data?.signedUrl) { await fail(m.id, "document file not found in storage"); out.failed++; continue; }
      m.body = { ...m.body, url: signed.data.signedUrl };
    }
    const req = buildRequest(m, acc.external_ig_id, contact, now);
    if ("skip" in req) { await fail(m.id, req.skip); out.skipped++; continue; }

    let token: string;
    try { token = decryptToken(acc.access_token_enc); } catch { await fail(m.id, "token could not be decrypted"); out.failed++; continue; }
    try {
      const r = await f(req.url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(req.body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        await db.from("messages").update({ status: "sent", external_message_id: j.message_id ?? j.id ?? null, scheduled_for: null, failure_reason: null }).eq("id", m.id);
        if (contact) await db.from("events").insert({ org_id: m.org_id, type: "message_sent", contact_id: contact.id, automation_id: m.automation_id ?? null });
        out.sent++;
      } else if (r.status >= 500 || r.status === 429) {
        if (now.getTime() - new Date(m.created_at).getTime() > GIVE_UP_MS) { await fail(m.id, `gave up after retries (HTTP ${r.status})`); out.failed++; }
        else { await db.from("messages").update({ scheduled_for: new Date(now.getTime() + RETRY_MS).toISOString() }).eq("id", m.id); out.retry++; }
      } else {
        const code = j?.error?.code;
        if (code === 190) await db.from("channel_accounts").update({ status: "token_expired" }).eq("id", acc.id); // Meta says the token is invalid
        await fail(m.id, `Meta ${code ?? r.status}${j?.error?.error_subcode ? "/" + j.error.error_subcode : ""}: ${j?.error?.message ?? "request refused"}`);
        out.failed++;
      }
    } catch (e) {
      // network trouble: try again shortly, give up after an hour
      if (now.getTime() - new Date(m.created_at).getTime() > GIVE_UP_MS) { await fail(m.id, `network: ${e instanceof Error ? e.message : e}`); out.failed++; }
      else { await db.from("messages").update({ scheduled_for: new Date(now.getTime() + RETRY_MS).toISOString() }).eq("id", m.id); out.retry++; }
    }
  }
  return out;
}
