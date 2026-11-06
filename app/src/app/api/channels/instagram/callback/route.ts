import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exchangeCode, subscribeWebhooks } from "@/lib/channels";
import { encryptToken, readState } from "@/lib/crypto";
import { serverClient } from "@/lib/supabase/server";

const back = (req: NextRequest, q: string) => {
  const res = NextResponse.redirect(new URL(`/settings?${q}`, req.nextUrl.origin));
  res.cookies.delete({ name: "ig_oauth", path: "/api/channels" });
  return res;
};

/** Instagram sends the person back here with a one-time code. We trade it for a token and store it encrypted. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(req, "connect_error=denied");
  const code = q.get("code");
  const state = q.get("state") ?? undefined;
  const cookie = req.cookies.get("ig_oauth")?.value;
  const st = readState<{ u: string; o: string; c: string | null; nm: string | null; exp: number }>(state);
  if (!code || !st || !st.o || !cookie || cookie !== state || st.exp < Date.now()) return back(req, "connect_error=state"); // forged, expired or not ours

  const sb = await serverClient();
  const { data } = await sb.auth.getUser();
  if (!data.user || data.user.id !== st.u) return back(req, "connect_error=state");
  const { data: m } = await sb.from("org_members").select("org_id,role").eq("user_id", data.user.id).eq("org_id", st.o).maybeSingle();
  if (!m || !["owner", "admin", "editor"].includes(m.role as string)) return back(req, "connect_error=forbidden");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const db = createClient(url, key, { auth: { persistSession: false } });
  try {
    const granted = await exchangeCode(code);
    const enc = encryptToken(granted.token);
    // the connection (portfolio) these accounts belong to: an existing one of this workspace, or a new one with the chosen name
    let portfolioId = st.c;
    if (portfolioId) {
      const { data: c } = await db.from("portfolio_connections").select("id").eq("id", portfolioId).eq("org_id", m.org_id).maybeSingle();
      if (!c) return back(req, "connect_error=forbidden");
    } else {
      const nm = (st.nm ?? "").trim().slice(0, 80);
      if (!nm) return back(req, "connect_error=name");
      const found = await db.from("portfolio_connections").select("id").eq("org_id", m.org_id).eq("name", nm).maybeSingle();
      if (found.data) portfolioId = found.data.id as string;
      else {
        const made = await db.from("portfolio_connections").insert({ org_id: m.org_id, name: nm, connected_by: data.user.id }).select("id").single();
        if (made.error) throw new Error(made.error.message);
        portfolioId = made.data.id as string;
      }
    }
    let connected = 0;
    for (const acct of granted.accounts) {
      // webhooks carry the Instagram professional account id as entry.id; Unified Login has no Page, so it fills both id columns
      const { data: existing } = await db.from("channel_accounts").select("id,org_id").eq("channel", "instagram").eq("external_ig_id", acct.igId).maybeSingle();
      if (existing && existing.org_id !== m.org_id) continue; // never take over another workspace's account
      const row = { org_id: m.org_id, channel: "instagram", external_page_id: acct.igId, external_ig_id: acct.igId, display_name: acct.username || acct.igId, portfolio_id: portfolioId, access_token_enc: enc, token_expires_at: granted.expiresAt, status: "connected", connected_by: data.user.id };
      const w = existing ? await db.from("channel_accounts").update(row).eq("id", existing.id) : await db.from("channel_accounts").insert(row);
      if (w.error) throw new Error(w.error.message);
      await db.from("audit_log").insert({ org_id: m.org_id, actor_id: data.user.id, action: "channel.connect", entity: "channel_account", detail: { channel: "instagram", username: acct.username, portfolio: portfolioId } });
      void subscribeWebhooks(acct.igId, granted.token).catch(() => false);
      connected++;
    }
    return back(req, connected ? "connected=instagram" : "connect_error=other_workspace");
  } catch (e) {
    console.error("[instagram connect]", e instanceof Error ? e.message : e);
    return back(req, "connect_error=failed");
  }
}
