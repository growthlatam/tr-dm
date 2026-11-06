// Deleting a workspace removes everything in it, including stored files, and leaves other workspaces alone. Throwaway data, live database.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
const { deleteWorkspace, workspaceCounts } = await import("../src/lib/admin");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let fails = 0;
const ck = (n: string, ok: boolean, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  " + x)); if (!ok) fails++; };
const one = async (q: any) => { const r = await q; if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };
const tag = randomBytes(4).toString("hex");
const orgs: string[] = [];

try {
  const mk = async (name: string) => { const o = await one(db.from("orgs").insert({ name }).select("id").single()); orgs.push(o.id); return o.id as string; };
  const doomed = await mk("del-test-" + tag);
  const keep = await mk("keep-test-" + tag);

  // fill the doomed one with every kind of data a real workspace has
  const pf = await one(db.from("portfolio_connections").insert({ org_id: doomed, name: "pf" }).select("id").single());
  const acc = await one(db.from("channel_accounts").insert({ org_id: doomed, channel: "instagram", external_page_id: "D" + tag, external_ig_id: "D" + tag, display_name: "d", portfolio_id: pf.id }).select("id").single());
  const auto = await one(db.from("automations").insert({ org_id: doomed, name: "a", channel_account_id: acc.id, draft_graph: { nodes: [], edges: [] } }).select("id").single());
  const ver = await one(db.from("automation_versions").insert({ automation_id: auto.id, org_id: doomed, version: 1, graph: { nodes: [], edges: [] } }).select("id").single());
  await one(db.from("automations").update({ live_version_id: ver.id }).eq("id", auto.id));
  const ct = await one(db.from("contacts").insert({ org_id: doomed, channel_account_id: acc.id, channel: "instagram", external_id: "X" + tag }).select("id").single());
  const cv = await one(db.from("conversations").insert({ org_id: doomed, contact_id: ct.id, channel_account_id: acc.id }).select("id").single());
  await one(db.from("messages").insert({ org_id: doomed, conversation_id: cv.id, channel_account_id: acc.id, direction: "out", sender: "bot", kind: "text", body: { text: "oi" }, status: "queued", automation_id: auto.id }));
  const run = await one(db.from("runs").insert({ org_id: doomed, automation_id: auto.id, version_id: ver.id, contact_id: ct.id, status: "running" }).select("id").single());
  await one(db.from("events").insert({ org_id: doomed, type: "trigger_fired", contact_id: ct.id, automation_id: auto.id }));
  await one(db.from("automation_firings").insert({ org_id: doomed, automation_id: auto.id, contact_id: ct.id, post_external_id: "p#c" }));
  const tg = await one(db.from("tags").insert({ org_id: doomed, name: "t" }).select("id").single());
  await one(db.from("contact_tags").insert({ contact_id: ct.id, tag_id: tg.id, org_id: doomed }));
  await one(db.from("audit_log").insert({ org_id: doomed, action: "x", entity: "x" }));
  const path = `${doomed}/${tag}.pdf`;
  await one(db.storage.from("assets").upload(path, new Blob(["%PDF-1.4 t"], { type: "application/pdf" }), { contentType: "application/pdf" }));
  await one(db.from("assets").insert({ org_id: doomed, kind: "pdf", file_name: "t.pdf", mime_type: "application/pdf", size_bytes: 10, storage_path: path }));
  await one(db.from("channel_accounts").insert({ org_id: keep, channel: "instagram", external_page_id: "K" + tag, external_ig_id: "K" + tag, display_name: "k" }));

  const c = await workspaceCounts(db, [doomed, keep]);
  ck("counts describe what is inside", c[doomed].accounts === 1 && c[doomed].automations === 1 && c[doomed].contacts === 1 && c[keep].accounts === 1 && c[keep].automations === 0, JSON.stringify(c));

  await deleteWorkspace(db, doomed);

  ck("the workspace is gone", !(await one(db.from("orgs").select("id").eq("id", doomed).maybeSingle())));
  for (const t of ["channel_accounts", "automations", "contacts", "conversations", "messages", "runs", "events", "automation_firings", "tags", "audit_log", "assets", "portfolio_connections", "automation_versions"]) {
    const col = t === "automation_versions" ? "org_id" : "org_id";
    const n = (await db.from(t).select("id", { count: "exact", head: true }).eq(col, doomed)).count ?? 0;
    ck(`nothing left in ${t}`, n === 0, String(n));
  }
  const left = await db.storage.from("assets").list(doomed);
  ck("the stored files are gone", (left.data ?? []).length === 0);
  const still = await workspaceCounts(db, [keep]);
  ck("another workspace is untouched", still[keep].accounts === 1);
  ck("the run row is gone too", !(await one(db.from("runs").select("id").eq("id", run.id).maybeSingle())));
} catch (e) {
  console.error("ERROR", e);
  fails++;
} finally {
  for (const o of orgs) await db.from("orgs").delete().eq("id", o);
}
console.log(fails ? `\n${fails} check(s) failed` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
