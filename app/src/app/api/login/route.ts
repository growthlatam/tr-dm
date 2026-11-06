import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

// Best-effort brake against guessing e-mails, in memory (so per server instance; a speed bump, not a real rate limiter).
// Two buckets, both keyed on the CALLER: all tries from one address, and tries of one address by one caller. There is no bucket
// on the e-mail alone, so nobody can lock a colleague out by repeating their address.
const hits = new Map<string, number[]>();
const MAX_KEYS = 5000;
let lastPrune = 0;
function tooMany(key: string, max: number) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.delete(key); // re-insert so Map order is "least recently used first"
  hits.set(key, list);
  // Hard bound on memory: prune expired keys at most every 30 s, and if the map is still over the cap drop the oldest keys.
  if (hits.size > MAX_KEYS) {
    if (now - lastPrune > 30_000) {
      lastPrune = now;
      for (const [k, v] of hits) if (v[v.length - 1] < now - 60_000) hits.delete(k);
    }
    for (const k of hits.keys()) {
      if (hits.size <= MAX_KEYS * 0.9) break;
      hits.delete(k);
    }
  }
  return list.length > max;
}

/**
 * Passwordless sign-in for an allowlist. If the e-mail is on `allowed_emails`, the server asks Supabase for a one-time
 * sign-in token (no e-mail is sent), redeems it right away and sets the session cookies.
 * Anyone who knows an allowed address can sign in as that person: this is an access list, not strong authentication.
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "not configured" }, { status: 501 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { email } = parsed.data;
  // Only the address the platform sets: Vercel writes x-real-ip itself, a client cannot choose it. x-forwarded-for is
  // client-controlled and is not trusted. With no trusted address (local development) there is no brake rather than one
  // bucket shared by everybody, which would let one caller lock all the others out.
  const ip = req.headers.get("x-real-ip");
  if (ip && (tooMany("ip:" + ip, 20) || tooMany("pair:" + ip + "|" + email, 6))) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: allowed, error: lookupError } = await admin.from("allowed_emails").select("email").eq("email", email).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "server" }, { status: 500 });
  if (!allowed) return NextResponse.json({ error: "not allowed" }, { status: 403 });

  // first time: create the account (already confirmed, no password). "already exists" is the normal case afterwards.
  await admin.auth.admin.createUser({ email, email_confirm: true });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const token = link.data?.properties?.hashed_token;
  if (link.error || !token) return NextResponse.json({ error: "server" }, { status: 500 });

  const sb = await serverClient();
  const { error } = await sb.auth.verifyOtp({ token_hash: token, type: "magiclink" });
  if (error) return NextResponse.json({ error: "server" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
