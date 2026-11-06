// Manage who can sign in. Usage:
//   npm run db:allow -- add someone@example.com [note]
//   npm run db:allow -- remove someone@example.com
//   npm run db:allow -- list
import { createClient } from "@supabase/supabase-js";

const [cmd, rawEmail, ...note] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const email = (rawEmail ?? "").trim().toLowerCase();

if (cmd === "list") {
  const { data, error } = await db.from("allowed_emails").select("email,note,created_at").order("created_at");
  if (error) throw error;
  for (const r of data) console.log(r.email.padEnd(40), r.note ?? "");
  console.log(`${data.length} allowed`);
} else if ((cmd === "add" || cmd === "remove") && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  const { error } = cmd === "add" ? await db.from("allowed_emails").upsert({ email, note: note.join(" ") || null }) : await db.from("allowed_emails").delete().eq("email", email);
  if (error) throw error;
  console.log(cmd === "add" ? "allowed:" : "removed:", email);
} else {
  console.error("Usage: npm run db:allow -- add|remove <email> [note]   or   npm run db:allow -- list");
  process.exit(1);
}
