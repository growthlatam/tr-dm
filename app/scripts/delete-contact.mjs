// Deletes everything about one person (contact, conversations, messages, tags, runs) after a data-deletion request.
// Usage: npm run db:forget -- <instagram-or-messenger-id | @username>
import { createClient } from "@supabase/supabase-js";

const who = (process.argv[2] ?? "").replace(/^@/, "").trim();
if (!who) {
  console.error("Usage: npm run db:forget -- <platform id or @username>");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await db.from("contacts").select("id,username,external_id,org_id").or(`external_id.eq.${who},username.eq.${who}`);
if (error) throw error;
if (!data.length) {
  console.log("Nobody found for", who);
  process.exit(0);
}
for (const c of data) {
  await db.from("webhook_events").delete().filter("payload->messaging->sender->>id", "eq", c.external_id); // raw stored events (DMs and taps)
  await db.from("webhook_events").delete().filter("payload->change->value->from->>id", "eq", c.external_id); // raw stored events (comments)
  const r = await db.from("contacts").delete().eq("id", c.id); // cascades to conversations, messages, tags, firings, runs
  if (r.error) throw r.error;
  await db.from("audit_log").insert({ org_id: c.org_id, action: "contact.delete", entity: "contact", detail: { reason: "data deletion request" } });
  console.log("deleted contact", c.external_id, c.username ?? "");
}
