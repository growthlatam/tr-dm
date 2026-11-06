import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { deleteWorkspace, requireAdmin, workspaceCounts } from "@/lib/admin";

const ROLES = ["owner", "admin", "editor", "agent", "viewer"] as const;
const email = z.string().trim().toLowerCase().email().max(200);
const uuid = z.string().uuid();

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_user"), email, note: z.string().max(200).optional(), org_id: uuid.optional(), role: z.enum(ROLES).optional() }),
  z.object({ action: z.literal("remove_user"), email }),
  z.object({ action: z.literal("create_workspace"), name: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("rename_workspace"), org_id: uuid, name: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("delete_workspace"), org_id: uuid, confirm_name: z.string().max(120) }),
  z.object({ action: z.literal("set_membership"), user_id: uuid, org_id: uuid, role: z.enum(ROLES).nullable() }),
]);

/** Everything the admin panel shows: workspaces, people who may sign in, and who is in which workspace. */
export async function GET(req: NextRequest) {
  const g = await requireAdmin(req);
  if (!g.ok) return g.res;
  if (req.nextUrl.searchParams.get("me")) return NextResponse.json({ admin: true }); // cheap probe for the menu
  const { db } = g.ctx;
  const [orgs, allowed, members, admins] = await Promise.all([
    db.from("orgs").select("id,name,created_at").order("created_at"),
    db.from("allowed_emails").select("email,note,created_at").order("created_at"),
    db.from("org_members").select("user_id,org_id,role"),
    db.from("app_admins").select("user_id"),
  ]);
  if (orgs.error || allowed.error || members.error || admins.error) return NextResponse.json({ error: "server" }, { status: 500 });
  const users: { id: string; email: string; last: string | null }[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return NextResponse.json({ error: "server" }, { status: 500 });
    for (const u of data.users) users.push({ id: u.id, email: (u.email ?? "").toLowerCase(), last: u.last_sign_in_at ?? null });
    if (data.users.length < 200) break;
  }
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const adminIds = new Set((admins.data ?? []).map((a) => a.user_id as string));
  const people = (allowed.data ?? []).map((a) => {
    const u = byEmail.get(a.email as string);
    return {
      email: a.email as string,
      note: (a.note as string) ?? null,
      user_id: u?.id ?? null, // null: allowed, has not signed in yet
      last_sign_in: u?.last ?? null,
      is_admin: !!u && adminIds.has(u.id),
      memberships: u ? (members.data ?? []).filter((m) => m.user_id === u.id).map((m) => ({ org_id: m.org_id as string, role: m.role as string })) : [],
    };
  });
  const counts = await workspaceCounts(db, (orgs.data ?? []).map((o) => o.id as string));
  return NextResponse.json({ me: g.ctx.email, workspaces: (orgs.data ?? []).map((o) => ({ ...o, counts: counts[o.id as string] })), people });
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin(req);
  if (!g.ok) return g.res;
  const { db, userId } = g.ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const b = parsed.data;
  const fail = (e: unknown) => {
    console.error("[admin]", b.action, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  };
  const audit = (org_id: string | null, action: string, detail: object) => org_id ? db.from("audit_log").insert({ org_id, actor_id: userId, action, entity: "admin", detail }) : Promise.resolve();

  // find a signed-in user by e-mail
  const findUser = async (e: string) => {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const u = data.users.find((x) => (x.email ?? "").toLowerCase() === e);
      if (u) return u;
      if (data.users.length < 200) return null;
    }
    return null;
  };

  try {
    switch (b.action) {
      case "add_user": {
        const r = await db.from("allowed_emails").upsert({ email: b.email, note: b.note ?? null });
        if (r.error) return fail(r.error);
        if (b.org_id) {
          // create the account now (no e-mail is sent) so the person can be placed in the workspace before their first sign-in
          let u = await findUser(b.email);
          if (!u) {
            const c = await db.auth.admin.createUser({ email: b.email, email_confirm: true });
            if (c.error) return fail(c.error);
            u = c.data.user;
          }
          const m = await db.from("org_members").upsert({ org_id: b.org_id, user_id: u.id, role: b.role ?? "editor" }, { onConflict: "org_id,user_id" });
          if (m.error) return fail(m.error);
        }
        await audit(b.org_id ?? null, "admin.add_user", { email: b.email });
        return NextResponse.json({ ok: true });
      }
      case "remove_user": {
        const u = await findUser(b.email);
        if (b.email === g.ctx.email) return NextResponse.json({ error: "cannot remove yourself" }, { status: 400 });
        if (u) {
          const a = await db.from("app_admins").select("user_id").eq("user_id", u.id).maybeSingle();
          if (a.data) return NextResponse.json({ error: "cannot remove an administrator" }, { status: 400 });
          const d = await db.from("org_members").delete().eq("user_id", u.id);
          if (d.error) return fail(d.error);
        }
        const r = await db.from("allowed_emails").delete().eq("email", b.email);
        if (r.error) return fail(r.error);
        return NextResponse.json({ ok: true });
      }
      case "create_workspace": {
        const r = await db.from("orgs").insert({ name: b.name }).select("id").single();
        if (r.error) return fail(r.error);
        // the administrator can always see and manage what they create
        await db.from("org_members").upsert({ org_id: r.data.id, user_id: userId, role: "owner" }, { onConflict: "org_id,user_id" });
        await audit(r.data.id as string, "admin.create_workspace", { name: b.name });
        return NextResponse.json({ ok: true, id: r.data.id });
      }
      case "rename_workspace": {
        const r = await db.from("orgs").update({ name: b.name }).eq("id", b.org_id);
        if (r.error) return fail(r.error);
        return NextResponse.json({ ok: true });
      }
      case "delete_workspace": {
        // the name must be typed exactly: this removes the workspace's accounts, automations, contacts, messages and files for good
        const o = await db.from("orgs").select("id,name").eq("id", b.org_id).maybeSingle();
        if (o.error) return fail(o.error);
        if (!o.data) return NextResponse.json({ error: "not found" }, { status: 404 });
        if (b.confirm_name.trim() !== String(o.data.name).trim()) return NextResponse.json({ error: "name does not match" }, { status: 400 });
        console.warn("[admin] deleting workspace", o.data.id, "by", g.ctx.email);
        await deleteWorkspace(db, b.org_id);
        return NextResponse.json({ ok: true });
      }
      case "set_membership": {
        if (b.role === null) {
          const r = await db.from("org_members").delete().eq("org_id", b.org_id).eq("user_id", b.user_id);
          if (r.error) return fail(r.error);
        } else {
          const r = await db.from("org_members").upsert({ org_id: b.org_id, user_id: b.user_id, role: b.role }, { onConflict: "org_id,user_id" });
          if (r.error) return fail(r.error);
        }
        await audit(b.org_id, "admin.set_membership", { user: b.user_id, role: b.role });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    return fail(e);
  }
}
