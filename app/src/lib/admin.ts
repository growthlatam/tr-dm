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

export type WorkspaceCounts = { members: number; accounts: number; automations: number; contacts: number };

/** What lives in each workspace, so the administrator can tell an empty leftover from the real one. */
export async function workspaceCounts(db: SupabaseClient, orgIds: string[]): Promise<Record<string, WorkspaceCounts>> {
  const out: Record<string, WorkspaceCounts> = {};
  await Promise.all(
    orgIds.map(async (id) => {
      const n = async (table: string, notDisconnected = false) => {
        let q = db.from(table).select("id", { count: "exact", head: true }).eq("org_id", id);
        if (notDisconnected) q = q.neq("status", "disconnected");
        return (await q).count ?? 0;
      };
      const [members, accounts, automations, contacts] = await Promise.all([n("org_members"), n("channel_accounts", true), n("automations"), n("contacts")]);
      out[id] = { members, accounts, automations, contacts };
    }),
  );
  return out;
}

/** Deletes a workspace and everything in it (the database cascades), plus its stored files. The caller has already checked the name. */
export async function deleteWorkspace(db: SupabaseClient, orgId: string): Promise<void> {
  // stored PDFs live under <workspace id>/ in the private bucket
  for (let i = 0; i < 20; i++) {
    const { data } = await db.storage.from("assets").list(orgId, { limit: 100 });
    if (!data?.length) break;
    const rm = await db.storage.from("assets").remove(data.map((f) => `${orgId}/${f.name}`));
    if (rm.error) throw new Error("storage: " + rm.error.message);
  }
  const r = await db.from("orgs").delete().eq("id", orgId);
  if (r.error) throw new Error("delete: " + r.error.message);
}
