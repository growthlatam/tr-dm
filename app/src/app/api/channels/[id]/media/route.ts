import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { graphBase } from "@/lib/channels";
import { decryptToken } from "@/lib/crypto";
import { serverClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The latest posts and reels of one connected Instagram account, for the post picker. The token never leaves the server. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const sb = await serverClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // row level security: only returns the account if it is in one of the caller's workspaces
  const { data: acc } = await sb.from("channel_accounts").select("id,org_id,status,external_ig_id").eq("id", id).maybeSingle();
  if (!acc || !acc.external_ig_id) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (acc.status !== "connected") return NextResponse.json({ error: "not connected" }, { status: 409 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: row } = await db.from("channel_accounts").select("access_token_enc").eq("id", id).single();
  let token: string;
  try {
    token = decryptToken(row?.access_token_enc as string);
  } catch {
    return NextResponse.json({ error: "token" }, { status: 502 });
  }
  const u = new URL(`${graphBase()}/${acc.external_ig_id}/media`);
  u.searchParams.set("fields", "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp");
  u.searchParams.set("limit", "12");
  const r = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("[media]", r.status, String(j?.error?.message ?? "").slice(0, 120));
    return NextResponse.json({ error: "meta", code: j?.error?.code ?? r.status }, { status: 502 });
  }
  const posts = ((j?.data ?? []) as Record<string, string>[]).map((m) => ({
    id: String(m.id),
    caption: String(m.caption ?? "").replace(/\s+/g, " ").slice(0, 140),
    kind: m.media_product_type === "REELS" ? "reel" : "post",
    date: String(m.timestamp ?? "").slice(0, 10),
    image: m.media_type === "VIDEO" ? (m.thumbnail_url ?? null) : (m.media_url ?? m.thumbnail_url ?? null),
  }));
  return NextResponse.json({ posts });
}
