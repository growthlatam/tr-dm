import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverClient } from "@/lib/supabase/server";

export type AdminCtx = { db: SupabaseClient; userId: string; email: string };

/** Service-role client. Only for routes that already proved the caller is the master administrator. */
export const serviceClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/** The caller must be signed in and listed in app_admins. Writes must also come from our own address (no cross-site posts). */
export async function requireAdmin(req: NextRequest): Promise<{ ok: true; ctx: AdminCtx } | { ok: false; res: NextResponse }> {
  const no = (status: number, error: string) => ({ ok: false as const, res: NextResponse.json({ error }, { status }) });
  const sb = await serverClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return no(401, "unauthorized");
  const db = serviceClient();
  const { data: row } = await db.from("app_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!row) return no(403, "forbidden");
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
    if (!origin || (site && origin !== site && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) return no(403, "bad origin");
  }
  return { ok: true, ctx: { db, userId: data.user.id, email: (data.user.email ?? "").toLowerCase() } };
}
