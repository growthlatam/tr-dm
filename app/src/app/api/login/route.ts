import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

// Best-effort brake against guessing e-mails: 8 tries a minute per caller and per address.
// (In-memory, so it is per server instance. Good enough to slow a script down, not a real rate limiter.)
const hits = new Map<string, number[]>();
function tooMany(key: string) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 8;
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
  // Vercel sets x-real-ip itself (a client cannot spoof it); fall back to the forwarded chain only outside Vercel.
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  if (tooMany("ip:" + ip) || tooMany("mail:" + email)) return NextResponse.json({ error: "slow down" }, { status: 429 }); // per caller and per address

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
