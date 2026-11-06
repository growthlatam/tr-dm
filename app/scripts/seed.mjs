// Adds one demo automation (fake content, no real people) to the workspace of SEED_EMAIL. Usage:
//   SEED_EMAIL=you@example.com npm run db:seed
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_EMAIL;
if (!url || !svc || !email) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, and SEED_EMAIL in the command.");
  process.exit(1);
}
const admin = createClient(url, svc, { auth: { persistSession: false } });
let user = null;
for (let page = 1; !user && page < 20; page++) {
  const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  user = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  if (!data?.users.length) break;
}
if (!user) {
  console.error("No user with that email. Sign in once first so the workspace exists.");
  process.exit(1);
}
const { data: mem } = await admin.from("org_members").select("org_id").eq("user_id", user.id).maybeSingle();
if (!mem) {
  console.error("That user has no workspace yet. Open the app once while signed in.");
  process.exit(1);
}
const t = { en: "Hi! Tap the button and we will send you the guide.", "pt-BR": "Olá! Toque no botão e enviaremos o guia.", "es-AR": "¡Hola! Tocá el botón y te enviamos la guía." };
const b = { en: "Send it to me", "pt-BR": "Quero receber", "es-AR": "Quiero recibirlo" };
const graph = {
  nodes: [
    { id: "n_t", type: "trigger", position: { x: 0, y: 120 }, data: { kind: "trigger", source: "dm_keyword", channel: "instagram", postScope: "all", postId: null, anyWord: false, keywords: ["guia", "guía", "guide"] } },
    { id: "n_a", type: "actions", position: { x: 340, y: 120 }, data: { kind: "actions", items: [{ type: "addTag", value: "demo-lead" }] } },
    { id: "n_m", type: "message", position: { x: 680, y: 120 }, data: { kind: "message", text: t, button: b, pdf: null } },
  ],
  edges: [
    { id: "e1", source: "n_t", sourceHandle: "next", target: "n_a" },
    { id: "e2", source: "n_a", sourceHandle: "next", target: "n_m" },
  ],
};
const { error } = await admin.from("automations").insert({ org_id: mem.org_id, name: "Demo: send a guide on keyword", draft_graph: graph, custom: true, has_unpublished_changes: true });
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log("Seeded one demo automation (draft) for", email);
