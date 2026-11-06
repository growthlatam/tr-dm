// Sends a signed, Meta-shaped comment to the deployed webhook and checks that it was stored, processed and queued.
// Uses a throwaway workspace that is deleted at the end. Run:
//   NODE_EXTRA_CA_CERTS=.ca-bundle.pem npx tsx --env-file=.env.local scripts/test-prod-webhook.mts https://tr-dm-automation.vercel.app
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "node:crypto";
import { buildGraph } from "../src/lib/flow";

const base = process.argv[2] ?? "https://tr-dm-automation.vercel.app";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const secret = process.env.META_APP_SECRET!;
let fails = 0;
const ck = (n: string, ok: boolean, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  " + x)); if (!ok) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IG = `7${Date.now()}`.slice(0, 15);
const cid = `c${randomBytes(4).toString("hex")}`;
let orgId = "";
try {
  orgId = ((await db.from("orgs").insert({ name: "prod-webhook-test" }).select("id").single()).data as { id: string }).id;
  const acc = (await db.from("channel_accounts").insert({ org_id: orgId, channel: "instagram", external_page_id: IG, external_ig_id: IG, display_name: "t" }).select("id").single()).data as { id: string };
  const graph = buildGraph({ postScope: "specific", postId: "M1", anyWord: false, keywords: ["guia"], publicReply: true, publicReplies: ["Enviado!"], dm: { text: { "pt-BR": "Olá!" }, button: { "pt-BR": "Quero" } }, pdf: { name: "g.pdf", size: 1 }, tag: "lead" });
  const a = (await db.from("automations").insert({ org_id: orgId, name: "t", status: "live", draft_graph: graph, custom: true, channel_account_id: acc.id }).select("id").single()).data as { id: string };
  const v = (await db.from("automation_versions").insert({ automation_id: a.id, org_id: orgId, version: 1, graph }).select("id").single()).data as { id: string };
  await db.from("automations").update({ live_version_id: v.id }).eq("id", a.id);

  const body = JSON.stringify({ object: "instagram", entry: [{ id: IG, time: 1, changes: [{ field: "comments", value: { id: cid, text: "quero o guia", from: { id: "P1", username: "pessoa" }, media: { id: "M1" } } }] }] });
  const sign = (b: string, s = secret) => "sha256=" + createHmac("sha256", s).update(b).digest("hex");
  const post = (b: string, sig: string) => fetch(base + "/api/webhooks/meta", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: b });

  ck("unsigned body is refused (401)", (await post(body, "sha256=00")).status === 401);
  ck("body signed with the wrong secret is refused (401)", (await post(body, sign(body, "wrong"))).status === 401);
  const ok = await post(body, sign(body));
  ck("correctly signed body is accepted (200)", ok.status === 200, String(ok.status));

  let queued: any[] = [];
  for (let i = 0; i < 12 && queued.length < 2; i++) {
    await sleep(1500);
    const c = (await db.from("contacts").select("id").eq("org_id", orgId).eq("external_id", "P1").limit(1)).data as any[];
    if (c?.length) queued = ((await db.from("messages").select("kind,status,body").eq("org_id", orgId).eq("direction", "out")).data as any[]) ?? [];
  }
  ck("processed right after the response: public reply + private reply queued", queued.some((m) => m.kind === "public_reply") && queued.some((m) => m.kind === "text" && m.body.mode === "private_reply"), JSON.stringify(queued.map((m) => m.kind)));
  const ev = (await db.from("webhook_events").select("status").eq("external_event_id", `instagram:comments:${cid}`)).data as any[];
  ck("the event ended as processed", ev?.[0]?.status === "processed", JSON.stringify(ev));

  const again = await post(body, sign(body)); // Meta retries
  ck("a retry is accepted but not processed twice", again.status === 200);
  await sleep(3000);
  const out2 = ((await db.from("messages").select("id").eq("org_id", orgId).eq("direction", "out")).data as any[]).length;
  ck("retry created no extra messages", out2 === queued.length, `${queued.length} -> ${out2}`);

  const noAuth = await fetch(base + "/api/jobs/tick");
  ck("the scheduled job refuses callers without the secret (401)", noAuth.status === 401);
  const withAuth = await fetch(base + "/api/jobs/tick", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  ck("the scheduled job runs with the secret (200)", withAuth.status === 200, String(withAuth.status));
} catch (e) {
  console.error("ERROR", e);
  fails++;
} finally {
  if (orgId) await db.from("orgs").delete().eq("id", orgId);
  await db.from("webhook_events").delete().eq("external_event_id", `instagram:comments:${cid}`);
}
console.log(fails ? `\n${fails} check(s) failed` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
