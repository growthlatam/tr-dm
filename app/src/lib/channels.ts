// Connecting Instagram accounts with Meta's Unified Login (Facebook Login for Business + Instagram assets).
// Endpoints follow Meta's published docs (read 2026-11-05). The client_id/secret are the regular Meta app id and secret.
import type { SupabaseClient } from "@supabase/supabase-js";

export const graphBase = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v27.0"}`;
export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
export const redirectUri = () => `${siteUrl()}/api/channels/instagram/callback`;

type F = typeof fetch;

/** What the server needs before it can start a login. Names only, never values. */
export function missingConfig(): string[] {
  return ["META_APP_ID", "META_APP_SECRET", "META_CONFIG_ID", "CHANNEL_TOKEN_KEY", "NEXT_PUBLIC_SITE_URL"].filter((k) => !process.env[k]);
}

/** Step 1: the Facebook login page, with the configuration that carries the Instagram assets and permissions. */
export function authorizeUrl(state: string): string {
  const u = new URL("https://www.facebook.com/dialog/oauth");
  u.searchParams.set("client_id", process.env.META_APP_ID ?? "");
  u.searchParams.set("config_id", process.env.META_CONFIG_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("override_default_response_type", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

export type Granted = { token: string; expiresAt: string | null; accounts: { igId: string; username: string }[] };

/** Steps 2-3: code -> system-user token -> the Instagram professional accounts the person shared. */
export async function exchangeCode(code: string, f: F = fetch): Promise<Granted> {
  const id = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!id || !secret) throw new Error("META_APP_ID / META_APP_SECRET not set");
  const tokenUrl = (withRedirect: boolean) => {
    const u = new URL(`${graphBase()}/oauth/access_token`);
    u.searchParams.set("client_id", id);
    u.searchParams.set("client_secret", secret);
    u.searchParams.set("code", code);
    if (withRedirect) u.searchParams.set("redirect_uri", redirectUri());
    return u;
  };
  // The Unified Login docs show the exchange without redirect_uri; the generic manual flow includes it. Try the documented one first.
  let r = await f(tokenUrl(false));
  let j = await r.json().catch(() => ({}));
  if (!r.ok && /redirect/i.test(String(j?.error?.message ?? ""))) {
    r = await f(tokenUrl(true));
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok || !j?.access_token) throw new Error(`token exchange failed (${r.status}): ${j?.error?.message ?? "no token"}`);
  const token: string = j.access_token;
  // The expiry is chosen when the configuration is created. A system-user token may not expire at all.
  const expiresAt = j.expires_in ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() : null;

  const acc = new URL(`${graphBase()}/me/assigned_instagram_accounts`);
  acc.searchParams.set("fields", "id,username");
  const r2 = await f(acc, { headers: { authorization: `Bearer ${token}` } });
  const j2 = await r2.json().catch(() => ({}));
  if (!r2.ok) throw new Error(`account lookup failed (${r2.status}): ${j2?.error?.message ?? "error"}`);
  let accounts = ((j2?.data ?? []) as { id?: string; username?: string }[]).filter((a) => a.id).map((a) => ({ igId: String(a.id), username: String(a.username ?? "") }));
  let how = `assigned_instagram_accounts returned ${accounts.length}`;
  if (!accounts.length) {
    // Accounts that belong to a business portfolio may not show up under "assigned". The token's own record lists the assets the
    // person granted (granular scopes, target_ids): read the Instagram ones from there.
    const g = await grantedInstagramIds(token, f);
    how += `; ${g.note}`;
    accounts = [];
    for (const id of g.ids) {
      const r3 = await f(`${graphBase()}/${id}?fields=id,username`, { headers: { authorization: `Bearer ${token}` } });
      const j3 = await r3.json().catch(() => ({}));
      accounts.push({ igId: String(j3?.id ?? id), username: String(j3?.username ?? "") });
    }
    if (!accounts.length) {
      const pg = await pageLinkedAccounts(token, f);
      how += `; ${pg.note}`;
      accounts = pg.list;
    }
  }
  if (!accounts.length) throw new Error(`no Instagram professional account was shared in the login (${how})`);
  return { token, expiresAt, accounts };
}

/** Instagram account ids the person granted to this token, from Meta's token inspection (app credentials in a header, never in a URL).
 *  Also returns a short, secret-free note of what Meta answered, for the error message. */
async function grantedInstagramIds(token: string, f: F): Promise<{ ids: string[]; note: string }> {
  const id = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!id || !secret) return { ids: [], note: "no app credentials" };
  const u = new URL(`${graphBase()}/debug_token`);
  u.searchParams.set("input_token", token);
  const r = await f(u, { headers: { authorization: `Bearer ${id}|${secret}` } });
  const j = await r.json().catch(() => ({}));
  const scopes = (j?.data?.granular_scopes ?? []) as { scope?: string; target_ids?: string[] }[];
  const ids = new Set<string>();
  for (const g of scopes) if (/^instagram_/.test(String(g.scope ?? ""))) for (const t of g.target_ids ?? []) ids.add(String(t));
  const note = `debug_token ${r.status} type=${j?.data?.type ?? "?"} scopes=[${scopes.map((g) => `${g.scope}:${(g.target_ids ?? []).length}`).join(",")}]${j?.error ? ` error="${String(j.error.message ?? "").slice(0, 80)}"` : ""}`;
  return { ids: [...ids], note };
}

/** Instagram accounts linked to the Pages the person granted (a portfolio account is often reached through its Page). */
async function pageLinkedAccounts(token: string, f: F): Promise<{ list: { igId: string; username: string }[]; note: string }> {
  const u = new URL(`${graphBase()}/me/accounts`);
  u.searchParams.set("fields", "id,instagram_business_account{id,username}");
  const r = await f(u, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  const pages = (j?.data ?? []) as { id?: string; instagram_business_account?: { id?: string; username?: string } }[];
  const list = pages.filter((p) => p.instagram_business_account?.id).map((p) => ({ igId: String(p.instagram_business_account!.id), username: String(p.instagram_business_account!.username ?? "") }));
  return { list, note: `me/accounts ${r.status} pages=${pages.length} withInstagram=${list.length}${j?.error ? ` error="${String(j.error.message ?? "").slice(0, 80)}"` : ""}` };
}

/** Asks Meta to send this account's events to our webhook. Needed for each account; returns false if Meta refused. */
export async function subscribeWebhooks(igId: string, token: string, f: F = fetch): Promise<boolean> {
  const r = await f(`${graphBase()}/${igId}/subscribed_apps`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ subscribed_fields: "comments,messages,messaging_postbacks" }),
  });
  return r.ok;
}

/** System-user tokens carry the expiry chosen in the configuration, and the docs show no refresh call for them.
 *  When a token passes its expiry the account is marked so the Settings page asks for a reconnect. */
export async function markExpired(db: SupabaseClient, now = new Date()): Promise<number> {
  const { data } = await db.from("channel_accounts").update({ status: "token_expired" }).eq("status", "connected").not("token_expires_at", "is", null).lt("token_expires_at", now.toISOString()).select("id");
  return data?.length ?? 0;
}
