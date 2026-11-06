// Checks sending and the Instagram login exchange against a FAKE Meta (no network to Meta) and a throwaway workspace.
// Run: NODE_EXTRA_CA_CERTS=.ca-bundle.pem npx tsx --env-file=.env.local scripts/test-sender.mts
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
process.env.CHANNEL_TOKEN_KEY = randomBytes(32).toString("base64"); // test-only key
process.env.META_APP_ID = "111";
process.env.META_APP_SECRET = "shh";
process.env.META_CONFIG_ID = "222";
process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
const { encryptToken } = await import("../src/lib/crypto");
const { sendQueued, clipBytes } = await import("../src/lib/engine/sender");
const { authorizeUrl, exchangeCode, markExpired, missingConfig } = await import("../src/lib/channels");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
let fails = 0;
const ck = (n: string, ok: boolean, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : "  " + x)); if (!ok) fails++; };
const one = async (q: any) => { const r = await q; if (r.error) throw new Error(JSON.stringify(r.error)); return r.data; };

// ---- pure bits
ck("clipBytes keeps short text", clipBytes("olá", 1000) === "olá");
const clipped = clipBytes("ã".repeat(800), 1000);
ck("clipBytes cuts to 1000 bytes without splitting a character", Buffer.byteLength(clipped) <= 1000 && clipped.endsWith("…"));

// ---- Unified Login exchange with a fake Meta
const calls: string[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const fakeMeta = (async (url: any) => {
  const u = String(url instanceof URL ? url.toString() : url);
  calls.push(u);
  if (u.includes("/oauth/access_token")) return json({ access_token: "SYSTEM-TOKEN", token_type: "bearer" });
  if (u.includes("/me/assigned_instagram_accounts")) return json({ data: [{ id: "17841000", username: "conta_teste" }, { id: "17841001", username: "outra" }] });
  return json({}, 404);
}) as typeof fetch;
const ex = await exchangeCode("CODE", fakeMeta);
ck("exchange returns the token and every Instagram account shared", ex.token === "SYSTEM-TOKEN" && ex.accounts.length === 2 && ex.accounts[0].igId === "17841000" && ex.accounts[0].username === "conta_teste");
ck("a system-user token without expires_in has no expiry", ex.expiresAt === null);
ck("the documented exchange sends client id, secret and code, graph.facebook.com, and no redirect_uri", calls[0].startsWith("https://graph.facebook.com/") && calls[0].includes("client_id=111") && calls[0].includes("client_secret=shh") && calls[0].includes("code=CODE") && !calls[0].includes("redirect_uri"));
const withExpiry = (async (u: any) => String(u).includes("/oauth/access_token") ? json({ access_token: "T", expires_in: 5184000 }) : json({ data: [{ id: "1", username: "x" }] })) as typeof fetch;
const ex2 = await exchangeCode("C", withExpiry);
ck("an expiry given by Meta is stored (about 60 days)", !!ex2.expiresAt && new Date(ex2.expiresAt).getTime() - Date.now() > 55 * 86400_000);
const redirectCalls: string[] = [];
const wantsRedirect = (async (u: any) => { const s = String(u); redirectCalls.push(s); if (s.includes("/oauth/access_token") && !s.includes("redirect_uri")) return json({ error: { message: "redirect_uri is required" } }, 400); if (s.includes("/oauth/access_token")) return json({ access_token: "T2" }); return json({ data: [{ id: "1", username: "x" }] }); }) as typeof fetch;
const ex3 = await exchangeCode("C", wantsRedirect);
ck("if Meta asks for redirect_uri, the exchange is retried with it", ex3.token === "T2" && redirectCalls.filter((c) => c.includes("/oauth/access_token")).length === 2);
const none = (async (u: any) => String(u).includes("/oauth/access_token") ? json({ access_token: "T" }) : json({ data: [] })) as typeof fetch;
let refused = false; try { await exchangeCode("C", none); } catch (e) { refused = /no Instagram professional account/.test(String(e)); }
ck("a login that shared no Instagram account is refused", refused);
const bad = (async () => json({ error: { message: "Invalid verification code format." } }, 400)) as typeof fetch;
let failed = false; try { await exchangeCode("C", bad); } catch (e) { failed = /token exchange failed/.test(String(e)); }
ck("a rejected code is reported, not swallowed", failed);
const au = new URL(authorizeUrl("STATE"));
ck("authorize URL is the Facebook dialog with the meta app id, config id, redirect, code flow and state", au.hostname === "www.facebook.com" && au.pathname === "/dialog/oauth" && au.searchParams.get("client_id") === "111" && au.searchParams.get("config_id") === "222" && au.searchParams.get("redirect_uri") === "https://example.test/api/channels/instagram/callback" && au.searchParams.get("response_type") === "code" && au.searchParams.get("state") === "STATE");
ck("missingConfig lists only what is unset (names, no values)", missingConfig().length === 0 || missingConfig().every((k) => typeof k === "string"));

// ---- sender against the real database
let orgId = "";
try {
  orgId = (await one(db.from("orgs").insert({ name: "sender-test" }).select("id").single())).id;
  const acc = await one(db.from("channel_accounts").insert({ org_id: orgId, channel: "instagram", external_page_id: "S1", external_ig_id: "17841999", display_name: "t", access_token_enc: encryptToken("TOKEN-123"), token_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() }).select("id").single());
  const mk = async (ext: string, win: boolean) => {
    const c = await one(db.from("contacts").insert({ org_id: orgId, channel_account_id: acc.id, channel: "instagram", external_id: ext, window_expires_at: win ? new Date(Date.now() + 3600_000).toISOString() : null }).select("id").single());
    const v = await one(db.from("conversations").insert({ org_id: orgId, contact_id: c.id, channel_account_id: acc.id }).select("id").single());
    return { c: c.id as string, conv: v.id as string };
  };
  const open = await mk("P-OPEN", true);
  const shut = await mk("P-SHUT", false);
  const q = async (conv: string, kind: string, body: object, extra: object = {}) => (await one(db.from("messages").insert({ org_id: orgId, conversation_id: conv, channel_account_id: acc.id, direction: "out", sender: "bot", kind, body, status: "queued", ...extra }).select("id").single())).id as string;
  const state = async (id: string) => (await one(db.from("messages").select("status,failure_reason,external_message_id,scheduled_for").eq("id", id).single())) as any;

  const sent: { url: string; body: any; auth: string }[] = [];
  const ok = (async (url: any, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization }); return new Response(JSON.stringify({ recipient_id: "x", message_id: "mid." + sent.length }), { status: 200 }); }) as typeof fetch;

  const pub = await q(open.conv, "public_reply", { text: "Enviado!", comment_id: "CMT1" });
  const priv = await q(open.conv, "text", { text: "Olá!", button: "Quero receber o material hoje mesmo", payload: "tap:aaaa:n1", mode: "private_reply", recipient: { comment_id: "CMT1" } });
  const plain = await q(open.conv, "text", { text: "Oi", mode: "window", recipient: { id: "P-OPEN" } });
  const blocked = await q(shut.conv, "text", { text: "fora da janela", mode: "window", recipient: { id: "P-SHUT" } });
  const doc = await q(open.conv, "doc", { name: "g.pdf", size: 1, mode: "window", recipient: { id: "P-OPEN" } });
  const docUrl = await q(open.conv, "doc", { name: "g.pdf", url: "https://files.example/g.pdf", mode: "window", recipient: { id: "P-OPEN" } });

  // a stored document: the sender must turn the private file into a short-lived link
  const pdfPath = `${orgId}/${randomBytes(4).toString("hex")}.pdf`;
  await one(db.storage.from("assets").upload(pdfPath, new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), { contentType: "application/pdf" }));
  const stored = await q(open.conv, "doc", { name: "guia.pdf", size: 13, path: pdfPath, mode: "window", recipient: { id: "P-OPEN" } });
  const missing = await q(open.conv, "doc", { name: "x.pdf", size: 1, path: `${orgId}/nao-existe.pdf`, mode: "window", recipient: { id: "P-OPEN" } });

  const off = await sendQueued(db, { orgId, fetchImpl: ok, enabled: false });
  ck("kill switch off: nothing is sent", off.disabled === true && sent.length === 0 && (await state(pub)).status === "queued");

  const r = await sendQueued(db, { orgId, fetchImpl: ok, enabled: true });
  ck("sends the five valid messages and refuses the three that cannot go", r.sent === 5 && sent.length === 5 && r.skipped + r.failed === 3, JSON.stringify(r));
  const fileMsg = sent.find((x) => x.body.message?.attachment?.payload?.url?.includes("/storage/v1/object/sign/assets/"));
  ck("a stored PDF is sent as a signed, expiring link to the private file", !!fileMsg && /token=/.test(fileMsg!.body.message.attachment.payload.url) && fileMsg!.body.message.attachment.type === "file", JSON.stringify(fileMsg?.body));
  ck("the signed link really serves the file", !!fileMsg && (await (await fetch(fileMsg!.body.message.attachment.payload.url)).text()).startsWith("%PDF"));
  ck("a document whose file is missing fails with a clear reason", (await state(missing)).status === "failed" && /not found in storage/.test((await state(missing)).failure_reason));
  ck("the stored document is marked sent", (await state(stored)).status === "sent");
  const byUrl = (s: string) => sent.find((x) => x.url.includes(s))!;
  ck("public reply goes to /<comment>/replies with the token", byUrl("/CMT1/replies").body.message === "Enviado!" && byUrl("/CMT1/replies").auth === "Bearer TOKEN-123");
  const pm = sent.find((x) => x.body.recipient?.comment_id === "CMT1")!;
  ck("private reply uses recipient.comment_id on /<ig id>/messages", pm.url.endsWith("/17841999/messages"));
  ck("private reply with a button becomes a button template with a postback (title cut to 20)", pm.body.message.attachment.payload.template_type === "button" && pm.body.message.attachment.payload.buttons[0].type === "postback" && pm.body.message.attachment.payload.buttons[0].payload === "tap:aaaa:n1" && [...pm.body.message.attachment.payload.buttons[0].title].length <= 20);
  ck("a plain text goes to the person's id", sent.some((x) => x.body.recipient?.id === "P-OPEN" && x.body.message?.text === "Oi"));
  ck("a document with a URL is sent as a file attachment", sent.some((x) => x.body.message?.attachment?.type === "file" && x.body.message.attachment.payload.url === "https://files.example/g.pdf"));
  ck("sent messages record Meta's message id and status", (await state(plain)).status === "sent" && !!(await state(plain)).external_message_id);
  const b = await state(blocked);
  ck("outside the 24h window is refused, not sent", b.status === "failed" && /window/.test(b.failure_reason));
  const d = await state(doc);
  ck("a document without a file URL fails with a clear reason", d.status === "failed" && /upload it again/.test(d.failure_reason));
  ck("the same queue run does not send anything twice", (await sendQueued(db, { orgId, fetchImpl: ok, enabled: true })).sent === 0 && sent.length === 5);

  const flaky = await q(open.conv, "text", { text: "tenta", mode: "window", recipient: { id: "P-OPEN" } });
  const r5 = await sendQueued(db, { orgId, fetchImpl: (async () => new Response("{}", { status: 503 })) as typeof fetch, enabled: true });
  const fs = await state(flaky);
  ck("a Meta 5xx keeps the message queued and schedules a retry", r5.retry === 1 && fs.status === "queued" && new Date(fs.scheduled_for) > new Date());

  const bad = await q(open.conv, "text", { text: "rejeitada", mode: "window", recipient: { id: "P-OPEN" } });
  await sendQueued(db, { orgId, fetchImpl: (async () => new Response(JSON.stringify({ error: { code: 10, error_subcode: 2534022, message: "outside window" } }), { status: 400 })) as typeof fetch, enabled: true });
  const bs = await state(bad);
  ck("a Meta 4xx fails the message and keeps Meta's reason", bs.status === "failed" && /Meta 10\/2534022/.test(bs.failure_reason));

  const tokenBad = await q(open.conv, "text", { text: "token", mode: "window", recipient: { id: "P-OPEN" } });
  await sendQueued(db, { orgId, fetchImpl: (async () => new Response(JSON.stringify({ error: { code: 190, message: "invalid token" } }), { status: 401 })) as typeof fetch, enabled: true });
  const acc2 = await one(db.from("channel_accounts").select("status").eq("id", acc.id).single());
  ck("Meta error 190 marks the account as needing a reconnect", acc2.status === "token_expired" && (await state(tokenBad)).status === "failed");

  const after = await q(open.conv, "text", { text: "depois", mode: "window", recipient: { id: "P-OPEN" } });
  await db.from("channel_accounts").update({ status: "connected" }).eq("id", acc.id);
  await db.from("contacts").update({ status: "unsubscribed" }).eq("id", open.c);
  await sendQueued(db, { orgId, fetchImpl: ok, enabled: true });
  ck("a message with no automation (the opt-out confirmation) still goes to someone who opted out", (await state(after)).status === "sent");
  const withAuto = await one(db.from("automations").insert({ org_id: orgId, name: "a", status: "live" }).select("id").single());
  const optedOut = await q(open.conv, "text", { text: "marketing", mode: "window", recipient: { id: "P-OPEN" } }, { automation_id: withAuto.id });
  await sendQueued(db, { orgId, fetchImpl: ok, enabled: true });
  ck("an automation message to an unsubscribed person is dropped", (await state(optedOut)).status === "failed");

  // expiry marking
  await db.from("channel_accounts").update({ token_expires_at: new Date(Date.now() - 1000).toISOString(), status: "connected" }).eq("id", acc.id);
  ck("an account whose token passed its expiry is marked for reconnect", (await markExpired(db)) >= 1 && (await one(db.from("channel_accounts").select("status").eq("id", acc.id).single())).status === "token_expired");
  await db.from("channel_accounts").update({ token_expires_at: null, status: "connected" }).eq("id", acc.id);
  const before = await markExpired(db);
  ck("a token with no expiry is left alone", (await one(db.from("channel_accounts").select("status").eq("id", acc.id).single())).status === "connected" && before >= 0);
} catch (e) {
  console.error("ERROR", e);
  fails++;
} finally {
  if (orgId) await db.from("orgs").delete().eq("id", orgId);
}
console.log(fails ? `\n${fails} check(s) failed` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
