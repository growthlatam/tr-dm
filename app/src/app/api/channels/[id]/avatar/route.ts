import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { graphBase } from "@/lib/channels";
import { decryptToken } from "@/lib/crypto";
import { serverClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Instagram serves profile pictures from these hosts only. Anything else is not followed. */
const CDN = /^https:\/\/[a-z0-9.-]+\.(cdninstagram\.com|fbcdn\.net)\//i;

/** The profile picture of one connected account. Meta's picture links expire, so the browser asks us and we look up a fresh one. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new NextResponse(null, { status: 400 });
  const sb = await serverClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return new NextResponse(null, { status: 401 });
  const { data: acc } = await sb.from("channel_accounts").select("id,status,external_ig_id").eq("id", id).maybeSingle(); // row level security: only the caller's workspaces
  if (!acc?.external_ig_id || acc.status !== "connected") return new NextResponse(null, { status: 404 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: row } = await db.from("channel_accounts").select("access_token_enc").eq("id", id).single();
  let token: string;
  try {
    token = decryptToken(row?.access_token_enc as string);
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  const r = await fetch(`${graphBase()}/${acc.external_ig_id}?fields=profile_picture_url`, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  const url = String(j?.profile_picture_url ?? "");
  if (!r.ok || !CDN.test(url)) return new NextResponse(null, { status: 404 });
  const res = NextResponse.redirect(url, 307);
  res.headers.set("cache-control", "private, max-age=21600"); // the browser keeps it for six hours, so we do not call Meta on every page
  return res;
}
