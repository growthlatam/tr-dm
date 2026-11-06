import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendQueued } from "@/lib/engine/sender";
import { serverClient } from "@/lib/supabase/server";

/** Called right after an agent queues a reply, so it goes out now instead of at the next scheduled run. Only touches the caller's workspace. */
export async function POST() {
  const sb = await serverClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: m } = await sb.from("org_members").select("org_id,role").eq("user_id", data.user.id).maybeSingle();
  if (!m || m.role === "viewer") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const r = await sendQueued(db, { limit: 10, orgId: m.org_id as string }); // does nothing unless META_SEND_ENABLED=true
  return NextResponse.json(r);
}
