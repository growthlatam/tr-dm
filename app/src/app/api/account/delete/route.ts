import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { serverClient } from "@/lib/supabase/server";

const Body = z.object({ email: z.string().email().max(320) });

/** Deletes the signed-in person. Workspaces they were the only member of go with them. */
export async function POST(req: NextRequest) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ error: "not configured" }, { status: 501 });
  const sb = await serverClient();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return NextResponse.json({ error: "confirmation does not match" }, { status: 400 });
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
  const { data: mine } = await admin.from("org_members").select("org_id").eq("user_id", user.id);
  for (const { org_id } of mine ?? []) {
    const { count } = await admin.from("org_members").select("id", { count: "exact", head: true }).eq("org_id", org_id).neq("user_id", user.id);
    if (!count) await admin.from("orgs").delete().eq("id", org_id); // cascades to everything the workspace owned
  }
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: "delete failed" }, { status: 500 });
  await sb.auth.signOut();
  return NextResponse.json({ ok: true });
}
