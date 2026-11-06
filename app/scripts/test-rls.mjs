// Proves tenant isolation against the real database. Creates throwaway users, checks, deletes them.
// Needs .env.local with the Supabase URL, anon key and service role key. Usage: npm run db:test
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !svc) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const admin = createClient(url, svc, { auth: { persistSession: false } });
const anonClient0 = createClient(url, anon, { auth: { persistSession: false } });
const tag = crypto.randomBytes(4).toString("hex");
const pw = crypto.randomBytes(16).toString("hex");
const users = {};
const orgs = [];
const emails = [];
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
  if (!ok) failures++;
};

async function mkUser(label) {
  const email = `rls-${label}-${tag}@${label}-${tag}.example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  emails.push(email);
  if (label !== "outsider") await admin.from("allowed_emails").insert({ email });
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email, password: pw });
  if (s.error) throw s.error;
  users[label] = { id: data.user.id, c };
}

try {
  await mkUser("a");
  await mkUser("b");
  await mkUser("viewer");
  await mkUser("outsider");
  await mkUser("admin");
  await mkUser("master");

  const a = users.a.c;
  const b = users.b.c;
  // workspaces are handed out by the administrator: they are made with the service role here, as the admin panel does
  const mkOrg = async (name, owner) => {
    const o = (await admin.from("orgs").insert({ name }).select("id").single()).data.id;
    await admin.from("org_members").insert({ org_id: o, user_id: owner, role: "owner" });
    return o;
  };
  const orgA = await mkOrg("A", users.a.id);
  const orgB = await mkOrg("B", users.b.id);
  orgs.push(orgA, orgB);
  check("each owner sees their own workspace", !!(await a.from("orgs").select("id").eq("id", orgA).maybeSingle()).data && !!(await b.from("orgs").select("id").eq("id", orgB).maybeSingle()).data);
  check("a person cannot see another person's workspace", !(await b.from("orgs").select("id").eq("id", orgA).maybeSingle()).data);
  check("a person on the allowlist cannot create a workspace by themselves", !!(await users.viewer.c.rpc("create_org", { p_name: "mine" })).error);
  await admin.from("app_admins").insert({ user_id: users.master.id });
  const o3 = (await users.master.c.rpc("create_org", { p_name: "Made by the administrator" })).data;
  if (o3) orgs.push(o3);
  check("the administrator can create a workspace", !!o3);
  check("clients cannot read the administrator list", !!(await a.from("app_admins").select("user_id")).error || ((await a.from("app_admins").select("user_id")).data ?? []).length === 0);
  check("clients cannot make themselves administrator", !!(await a.from("app_admins").insert({ user_id: users.a.id })).error);
  check("e-mail not on the allowlist cannot get a workspace", !!(await users.outsider.c.rpc("create_org", { p_name: "X" })).error);
  check("clients cannot read the allowlist", !!(await a.from("allowed_emails").select("email")).error || ((await a.from("allowed_emails").select("email")).data ?? []).length === 0);
  check("clients cannot add themselves to the allowlist", !!(await users.outsider.c.from("allowed_emails").insert({ email: "x@y.test" })).error);

  const graph = { nodes: [], edges: [] };
  const ins = await a.from("automations").insert({ org_id: orgA, name: "A-secret", draft_graph: graph }).select().single();
  check("owner can create an automation", !ins.error, ins.error?.message);
  const idA = ins.data?.id;

  check("other user sees none of it", ((await b.from("automations").select("id")).data ?? []).length === 0);
  check("other user cannot read it by id", !(await b.from("automations").select("id").eq("id", idA).maybeSingle()).data);
  const upd = await b.from("automations").update({ name: "hijacked" }).eq("id", idA).select();
  check("other user cannot update it", (upd.data ?? []).length === 0);
  const del = await b.from("automations").delete().eq("id", idA).select();
  check("other user cannot delete it", (del.data ?? []).length === 0);
  check("other user cannot insert into A's workspace", !!(await b.from("automations").insert({ org_id: orgA, name: "x", draft_graph: graph })).error);
  check("other user cannot publish it", !!(await b.rpc("publish_automation", { p_id: idA })).error);
  check("other user cannot read A's workspace row", !(await b.from("orgs").select("id").eq("id", orgA).maybeSingle()).data);
  check("other user cannot add themselves as member", !!(await b.from("org_members").insert({ org_id: orgA, user_id: users.b.id, role: "owner" })).error);

  const pub = await a.rpc("publish_automation", { p_id: idA });
  check("owner can publish", !pub.error, pub.error?.message);
  check("other user cannot read the published version", ((await b.from("automation_versions").select("id")).data ?? []).length === 0);

  // viewer: member of A's workspace, read only
  await admin.from("org_members").insert({ org_id: orgA, user_id: users.viewer.id, role: "viewer" });
  const v = users.viewer.c;
  check("viewer can read", ((await v.from("automations").select("id")).data ?? []).length === 1);
  check("viewer cannot write", !!(await v.from("automations").insert({ org_id: orgA, name: "nope", draft_graph: graph })).error);
  const vu = await v.from("automations").update({ name: "nope" }).eq("id", idA).select();
  check("viewer cannot update", (vu.data ?? []).length === 0);

  // inbox: team list, notes, agent replies, statistics
  const ch = (await admin.from("channel_accounts").insert({ org_id: orgA, channel: "instagram", external_page_id: "T" + tag, external_ig_id: "T" + tag, display_name: "t" }).select("id").single()).data;
  const ct = (await admin.from("contacts").insert({ org_id: orgA, channel_account_id: ch.id, channel: "instagram", external_id: "X" + tag }).select("id").single()).data;
  const cv = (await admin.from("conversations").insert({ org_id: orgA, contact_id: ct.id, channel_account_id: ch.id }).select("id").single()).data;
  const team = (await a.rpc("org_team")).data ?? [];
  check("org_team lists my workspace's members (owner and viewer)", team.length === 2, String(team.length));
  check("org_team does not list another workspace's members", ((await b.rpc("org_team")).data ?? []).every((t) => t.user_id === users.b.id));
  check("signed-out cannot call org_team", !!(await anonClient0.rpc("org_team")).error || ((await anonClient0.rpc("org_team")).data ?? []).length === 0);
  const msg = (cli, org) => cli.from("messages").insert({ org_id: org, conversation_id: cv.id, channel_account_id: ch.id, direction: "out", sender: "agent", kind: "text", body: { text: "oi" }, status: "queued" });
  check("an editor or owner can queue an agent reply", !(await msg(a, orgA)).error);
  check("a viewer cannot queue a reply", !!(await msg(v, orgA)).error);
  check("another workspace cannot queue a reply into this conversation", !!(await msg(b, orgA)).error);
  check("another workspace cannot read these messages", ((await b.from("messages").select("id").eq("conversation_id", cv.id)).data ?? []).length === 0);
  check("a viewer can read messages", ((await v.from("messages").select("id").eq("conversation_id", cv.id)).data ?? []).length >= 1);
  const note = (cli, who) => cli.from("conversation_notes").insert({ org_id: orgA, conversation_id: cv.id, author_id: who, body: "nota" });
  check("an owner can write a note", !(await note(a, users.a.id)).error);
  check("a viewer cannot write a note", !!(await note(v, users.viewer.id)).error);
  check("a viewer cannot change a conversation", ((await v.from("conversations").update({ state: "closed" }).eq("id", cv.id).select()).data ?? []).length === 0);
  check("an owner can assign and close a conversation", ((await a.from("conversations").update({ assignee_id: users.a.id, state: "closed" }).eq("id", cv.id).select()).data ?? []).length === 1);
  const st = (await a.rpc("automation_stats")).data ?? [];
  check("automation_stats returns a row for my automation", st.some((r) => r.automation_id === idA));
  check("automation_stats shows nothing of another workspace", ((await b.rpc("automation_stats")).data ?? []).every((r) => r.automation_id !== idA));

  // hardening: channel accounts are server-only; only owners create or change owners
  const ca = (cli, org, ig) => cli.from("channel_accounts").insert({ org_id: org, channel: "instagram", external_page_id: ig, external_ig_id: ig, display_name: "x" });
  check("an owner's browser session cannot insert a channel account", !!(await ca(a, orgA, "SQUAT" + tag)).error);
  check("another workspace cannot claim an Instagram id that is already connected", !!(await ca(b, orgB, "T" + tag)).error);
  check("nobody can update a channel account from the browser", !!(await a.from("channel_accounts").update({ display_name: "hijack" }).eq("id", ch.id)).error);
  check("the same Instagram id cannot be connected twice even with a different page id", !!(await admin.from("channel_accounts").insert({ org_id: orgB, channel: "instagram", external_page_id: "OTHER" + tag, external_ig_id: "T" + tag, display_name: "dup" })).error);
  await admin.from("org_members").insert({ org_id: orgA, user_id: users.admin.id, role: "admin" });
  const adm = users.admin.c;
  check("an admin cannot add a new owner", !!(await adm.from("org_members").insert({ org_id: orgA, user_id: users.outsider.id, role: "owner" })).error);
  check("an admin cannot promote themselves to owner", ((await adm.from("org_members").update({ role: "owner" }).eq("user_id", users.admin.id).select()).data ?? []).length === 0);
  check("an admin cannot demote or remove an owner", ((await adm.from("org_members").update({ role: "viewer" }).eq("user_id", users.a.id).select()).data ?? []).length === 0 && ((await adm.from("org_members").delete().eq("user_id", users.a.id).select()).data ?? []).length === 0);
  check("an admin can add an editor", !(await adm.from("org_members").insert({ org_id: orgA, user_id: users.outsider.id, role: "editor" })).error);
  await admin.from("org_members").delete().eq("user_id", users.outsider.id);
  check("an owner can promote someone to owner", ((await a.from("org_members").update({ role: "owner" }).eq("user_id", users.admin.id).select()).data ?? []).length === 1);

  // storage: private PDF bucket
  const pdfBytes = new Blob(["%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"], { type: "application/pdf" });
  const upA = await a.storage.from("assets").upload(`${orgA}/${tag}.pdf`, pdfBytes, { contentType: "application/pdf" });
  check("an owner can upload a PDF into their workspace folder", !upA.error, upA.error?.message);
  check("another workspace cannot upload into this folder", !!(await b.storage.from("assets").upload(`${orgA}/${tag}-b.pdf`, pdfBytes, { contentType: "application/pdf" })).error);
  check("a viewer cannot upload", !!(await v.storage.from("assets").upload(`${orgA}/${tag}-v.pdf`, pdfBytes, { contentType: "application/pdf" })).error);
  check("a path outside any workspace folder is refused", !!(await a.storage.from("assets").upload(`loose-${tag}.pdf`, pdfBytes, { contentType: "application/pdf" })).error);
  check("only PDFs are accepted", !!(await a.storage.from("assets").upload(`${orgA}/${tag}.png`, new Blob(["x"], { type: "image/png" }), { contentType: "image/png" })).error);
  check("a member can read the file", !(await v.storage.from("assets").download(`${orgA}/${tag}.pdf`)).error);
  check("another workspace cannot read the file", !!(await b.storage.from("assets").download(`${orgA}/${tag}.pdf`)).error);
  check("another workspace cannot make a link to it", !!(await b.storage.from("assets").createSignedUrl(`${orgA}/${tag}.pdf`, 60)).error);
  check("a signed-out visitor cannot read the file", !!(await anonClient0.storage.from("assets").download(`${orgA}/${tag}.pdf`)).error);
  check("the bucket is not public", (await fetch(`${url}/storage/v1/object/public/assets/${orgA}/${tag}.pdf`)).status >= 400);
  check("another workspace cannot delete the file", ((await b.storage.from("assets").remove([`${orgA}/${tag}.pdf`])).data ?? []).length === 0);
  await admin.storage.from("assets").remove([`${orgA}/${tag}.pdf`]);

  // channel tokens never reach a browser client
  const tok = await a.from("channel_accounts").select("access_token_enc");
  check("channel token column is not readable by clients", !!tok.error, "got rows or no error");
  const safe = await a.from("channel_accounts").select("id,display_name");
  check("safe channel columns are readable", !safe.error, safe.error?.message);

  // portfolio connections, automations bound to an account, and copying between accounts
  const mkAcc = async (org, id) => (await admin.from("channel_accounts").insert({ org_id: org, channel: "instagram", external_page_id: id, external_ig_id: id, display_name: id }).select("id").single()).data.id;
  const accA1 = await mkAcc(orgA, "PA1" + tag);
  const accA2 = await mkAcc(orgA, "PA2" + tag);
  const accB1 = await mkAcc(orgB, "PB1" + tag);
  const pf = await admin.from("portfolio_connections").insert({ org_id: orgA, name: "Portfolio " + tag }).select("id").single();
  check("the server can create a portfolio connection", !pf.error, pf.error?.message);
  check("a member can read their workspace's portfolio connections", ((await a.from("portfolio_connections").select("id")).data ?? []).length >= 1);
  check("another workspace cannot read them", ((await b.from("portfolio_connections").select("id").eq("org_id", orgA)).data ?? []).length === 0);
  check("a browser cannot create a portfolio connection", !!(await a.from("portfolio_connections").insert({ org_id: orgA, name: "mine" })).error);
  check("a browser cannot rename one", ((await a.from("portfolio_connections").update({ name: "x" }).eq("id", pf.data.id).select()).data ?? []).length === 0);
  const bound = await a.from("automations").insert({ org_id: orgA, name: "bound", draft_graph: graph, channel_account_id: accA1 }).select("id").single();
  check("an automation can be bound to an account of its workspace", !bound.error, bound.error?.message);
  check("an automation cannot point at another workspace's account", !!(await a.from("automations").insert({ org_id: orgA, name: "wrong", draft_graph: graph, channel_account_id: accB1 })).error);
  check("an existing automation cannot be moved to another workspace's account", !!(await a.from("automations").update({ channel_account_id: accB1 }).eq("id", bound.data.id)).error);
  const cp = await a.rpc("copy_automation", { p_id: bound.data.id, p_account: accA2 });
  check("copying to another account of the workspace works", !cp.error && !!cp.data, cp.error?.message);
  const cpRow = (await a.from("automations").select("channel_account_id,status,name").eq("id", cp.data).maybeSingle()).data;
  check("the copy is a draft on the new account", cpRow?.channel_account_id === accA2 && cpRow?.status === "draft" && /copy/.test(cpRow?.name ?? ""), JSON.stringify(cpRow));
  check("copying to another workspace's account is refused", !!(await a.rpc("copy_automation", { p_id: bound.data.id, p_account: accB1 })).error);
  check("another workspace cannot copy A's automation", !!(await b.rpc("copy_automation", { p_id: bound.data.id, p_account: accB1 })).error);
  check("a viewer cannot copy", !!(await v.rpc("copy_automation", { p_id: bound.data.id, p_account: accA2 })).error);

  const anonClient = anonClient0;
  check("signed-out visitor sees nothing", ((await anonClient.from("automations").select("id")).data ?? []).length === 0);
} catch (e) {
  console.error("ERROR", e);
  failures++;
} finally {
  for (const o of orgs) if (o) await admin.from("orgs").delete().eq("id", o);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
  for (const e of emails) await admin.from("allowed_emails").delete().eq("email", e);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
