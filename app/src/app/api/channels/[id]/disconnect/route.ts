import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serverClient } from "@/lib/supabase/server";

/** Forgets the token and stops using the account. Owners and admins only. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const sb = await serverClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // RLS: only returns the row if it belongs to the caller's workspace
  const { data: acc } = await sb.from("channel_accounts").select("id,org_id").eq("id", id).maybeSingle();
  if (!acc) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: m } = await sb.from("org_members").select("role").eq("user_id", data.user.id).eq("org_id", acc.org_id).maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role as string)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const r = await db.from("channel_accounts").update({ status: "disconnected", access_token_enc: null, token_expires_at: null }).eq("id", id);
  if (r.error) return NextResponse.json({ error: "server" }, { status: 500 });
  await db.from("audit_log").insert({ org_id: acc.org_id, actor_id: data.user.id, action: "channel.disconnect", entity: "channel_account", entity_id: id });
  return NextResponse.json({ ok: true });
}
