import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** AES-256-GCM for channel access tokens. The key lives only in the server environment (CHANNEL_TOKEN_KEY, 32 bytes, base64). */
function key(): Buffer {
  const k = Buffer.from(process.env.CHANNEL_TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("CHANNEL_TOKEN_KEY must be 32 bytes in base64");
  return k;
}

/** Returns a PostgREST bytea literal ("\\x...") holding iv(12) + tag(16) + ciphertext. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "\\x" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("hex");
}

/** Accepts what PostgREST returns for a bytea column ("\\x..." hex). */
export function decryptToken(stored: string): string {
  const raw = Buffer.from(stored.startsWith("\\x") ? stored.slice(2) : stored, "hex");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/** A value the browser carries during the login round trip, signed so it cannot be forged (CSRF protection). */
export function signState(payload: object, secret = process.env.CHANNEL_TOKEN_KEY ?? ""): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function readState<T>(value: string | undefined, secret = process.env.CHANNEL_TOKEN_KEY ?? ""): T | null {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}
