// Manage the master administrator. Usage:
//   npm run db:admin -- add someone@example.com    (the person must have signed in at least once)
//   npm run db:admin -- remove someone@example.com
//   npm run db:admin -- list
import { createClient } from "@supabase/supabase-js";

const [cmd, rawEmail] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const email = (rawEmail ?? "").trim().toLowerCase();

async function findUser(e) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => (x.email ?? "").toLowerCase() === e);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

if (cmd === "list") {
  const { data, error } = await db.from("app_admins").select("user_id,created_at");
  if (error) throw error;
  for (const r of data) {
    const { data: u } = await db.auth.admin.getUserById(r.user_id);
    console.log((u?.user?.email ?? r.user_id).padEnd(40), r.created_at);
  }
  console.log(`${data.length} administrator(s)`);
} else if ((cmd === "add" || cmd === "remove") && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  const u = await findUser(email);
  if (!u) {
    console.error("No user with that e-mail. They must sign in once first.");
    process.exit(1);
  }
  const { error } = cmd === "add" ? await db.from("app_admins").upsert({ user_id: u.id }) : await db.from("app_admins").delete().eq("user_id", u.id);
  if (error) throw error;
  console.log(cmd === "add" ? "administrator:" : "removed:", email);
} else {
  console.error("Usage: npm run db:admin -- add|remove <email>   or   npm run db:admin -- list");
  process.exit(1);
}
