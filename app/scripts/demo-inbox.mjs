// Puts three clearly fake conversations in your workspace so you can see the real inbox. Usage:
//   npm run db:demo-inbox -- you@company.com          adds them
//   npm run db:demo-inbox -- you@company.com clean    removes them (contacts whose username starts with demo_)
import { createClient } from "@supabase/supabase-js";

const [email, mode] = process.argv.slice(2);
if (!email) { console.error("Usage: npm run db:demo-inbox -- <your e-mail> [clean]"); process.exit(1); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let user = null;
for (let page = 1; !user && page < 20; page++) {
  const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
  user = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  if (!data?.users.length) break;
}
if (!user) { console.error("No user with that e-mail. Sign in once first."); process.exit(1); }
const mem = (await db.from("org_members").select("org_id").eq("user_id", user.id).maybeSingle()).data;
if (!mem) { console.error("No workspace yet."); process.exit(1); }
const org = mem.org_id;

if (mode === "clean") {
  const r = await db.from("contacts").delete().eq("org_id", org).like("username", "demo\\_%").select("id");
  await db.from("channel_accounts").delete().eq("org_id", org).eq("external_ig_id", "DEMO0001");
  console.log("removed", r.data?.length ?? 0, "demo contacts");
  process.exit(0);
}

const ig = (await db.from("channel_accounts").select("id").eq("org_id", org).eq("channel", "instagram").neq("external_ig_id", "DEMO0001").limit(1).maybeSingle()).data
  ?? (await db.from("channel_accounts").upsert({ org_id: org, channel: "instagram", external_page_id: "DEMO0001", external_ig_id: "DEMO0001", display_name: "demo_account", status: "disconnected" }, { onConflict: "channel,external_page_id,external_ig_id" }).select("id").single()).data;
const auto = (await db.from("automations").select("id").eq("org_id", org).limit(1).maybeSingle()).data;
const ago = (m) => new Date(Date.now() - m * 60_000).toISOString();
const people = [
  { u: "demo_marina", lang: "pt-BR", src: "comment", win: true, tags: ["whitepaper-lead"], msgs: [
    ["in", "contact", "comment", { text: "Quero o guia!" }, "delivered", 60],
    ["out", "bot", "public_reply", { text: "Enviado! Olhe suas mensagens 📩", comment_id: "demo1" }, "sent", 59],
    ["out", "bot", "text", { text: "Olá! Toque no botão e enviaremos o guia.", button: "Quero receber" }, "sent", 59],
    ["in", "contact", "postback", { text: "Quero receber" }, "delivered", 55],
    ["out", "bot", "doc", { name: "guia-ia-juridico.pdf" }, "failed", 55, "documents need a public file URL (file storage is not built yet)"],
  ] },
  { u: "demo_tomas", lang: "es-AR", src: "dm", win: true, tags: [], msgs: [
    ["in", "contact", "text", { text: "Hola, ¿tienen precios para Onvio?" }, "delivered", 20],
    ["out", "bot", "text", { text: "¡Hola! Un asesor te responde enseguida." }, "queued", 19],
  ] },
  { u: "demo_lee", lang: "en", src: "ad", win: false, tags: ["from-ad"], msgs: [
    ["in", "contact", "text", { text: "Is there a demo?" }, "delivered", 3000],
  ] },
];
for (const p of people) {
  const c = (await db.from("contacts").upsert({ org_id: org, channel_account_id: ig.id, channel: "instagram", external_id: "DEMO-" + p.u, username: p.u, language: p.lang, opt_in_source: p.src, opted_in: true, status: "subscribed", window_expires_at: p.win ? new Date(Date.now() + 20 * 3600_000).toISOString() : null, last_interaction_at: ago(p.msgs.at(-1)[5]) }, { onConflict: "channel_account_id,external_id" }).select("id").single()).data;
  const v = (await db.from("conversations").upsert({ org_id: org, contact_id: c.id, channel_account_id: ig.id, unread_count: 1, last_message_at: ago(p.msgs.at(-1)[5]) }, { onConflict: "contact_id,channel_account_id" }).select("id").single()).data;
  await db.from("messages").delete().eq("conversation_id", v.id);
  await db.from("messages").insert(p.msgs.map(([d, s, k, b, st, m, why]) => ({ org_id: org, conversation_id: v.id, channel_account_id: ig.id, direction: d, sender: s, kind: k, body: b, status: st, failure_reason: why ?? null, created_at: ago(m), automation_id: d === "out" && auto ? auto.id : null })));
  for (const t of p.tags) {
    const tag = (await db.from("tags").upsert({ org_id: org, name: t }, { onConflict: "org_id,name" }).select("id").single()).data;
    await db.from("contact_tags").upsert({ contact_id: c.id, tag_id: tag.id, org_id: org }, { onConflict: "contact_id,tag_id" });
  }
}
console.log("added 3 demo conversations. Remove with: npm run db:demo-inbox -- " + email + " clean");
