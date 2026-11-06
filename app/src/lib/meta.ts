import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/** Meta signs every webhook body with the app secret: header `X-Hub-Signature-256: sha256=<hex>`. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return given.length === want.length && timingSafeEqual(given, want);
}

export type MetaEvent = {
  /** Stable id used to drop duplicates (Meta retries). */
  id: string;
  /** "instagram" or "page" (Messenger and Facebook Page events). */
  object: string;
  /** Instagram account id or Page id the event belongs to. */
  accountId: string;
  /** What happened: a webhook field ("comments", "feed", "mentions") or "messaging". */
  kind: string;
  payload: unknown;
};

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

/** Splits a webhook body into one event per comment / message / postback / receipt. */
export function eventsFrom(body: unknown): MetaEvent[] {
  const b = body as { object?: string; entry?: Record<string, unknown>[] } | null;
  if (!b || typeof b.object !== "string" || !Array.isArray(b.entry)) return [];
  const out: MetaEvent[] = [];
  for (const entry of b.entry) {
    const accountId = String(entry.id ?? "");
    const changes = Array.isArray(entry.changes) ? (entry.changes as { field?: string; value?: Record<string, unknown> }[]) : [];
    for (const c of changes) {
      const v = c.value ?? {};
      const key = v.id ?? v.comment_id ?? v.mid ?? v.post_id ?? sha(c);
      out.push({ id: `${b.object}:${c.field}:${key}`, object: b.object, accountId, kind: String(c.field ?? "change"), payload: { entry_id: accountId, time: entry.time, change: c } });
    }
    const messaging = Array.isArray(entry.messaging) ? (entry.messaging as Record<string, unknown>[]) : [];
    for (const m of messaging) {
      const msg = m.message as { mid?: string } | undefined;
      const post = m.postback as { mid?: string } | undefined;
      const kind = m.message ? "message" : m.postback ? "postback" : m.read ? "read" : m.delivery ? "delivery" : m.referral ? "referral" : "other";
      const key = msg?.mid ?? post?.mid ?? `${(m.sender as { id?: string } | undefined)?.id ?? ""}:${m.timestamp ?? ""}:${sha(m)}`;
      out.push({ id: `${b.object}:${kind}:${key}`, object: b.object, accountId, kind: `messaging.${kind}`, payload: { entry_id: accountId, time: entry.time, messaging: m } });
    }
  }
  return out;
}
