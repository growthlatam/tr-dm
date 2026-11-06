import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizeUrl, missingConfig } from "@/lib/channels";
import { signState } from "@/lib/crypto";
import { serverClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const go = (req: NextRequest, q: string) => NextResponse.redirect(new URL(`/settings?${q}`, req.nextUrl.origin));

/** Sends the signed-in person to Meta to share the Instagram accounts of one business portfolio.
 *  ?org=<workspace>&name=<new connection name>   starts a new connection
 *  ?org=<workspace>&connection=<id>               adds or refreshes the accounts of an existing connection */
export async function GET(req: NextRequest) {
  if (missingConfig().length) return go(req, "connect_error=not_configured");
  const sb = await serverClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));

  const org = req.nextUrl.searchParams.get("org") ?? "";
  const connection = req.nextUrl.searchParams.get("connection") ?? "";
  const name = (req.nextUrl.searchParams.get("name") ?? "").trim().slice(0, 80);
  if (!UUID.test(org) || (connection ? !UUID.test(connection) : !name)) return go(req, "connect_error=name");

  const { data: m } = await sb.from("org_members").select("role").eq("user_id", data.user.id).eq("org_id", org).maybeSingle();
  if (!m || !["owner", "admin", "editor"].includes(m.role as string)) return go(req, "connect_error=forbidden");
  if (connection) {
    const { data: c } = await sb.from("portfolio_connections").select("id").eq("id", connection).eq("org_id", org).maybeSingle(); // RLS plus the workspace check
    if (!c) return go(req, "connect_error=forbidden");
  }

  const state = signState({ u: data.user.id, o: org, c: connection || null, nm: connection ? null : name, n: randomBytes(8).toString("hex"), exp: Date.now() + 10 * 60_000 });
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set("ig_oauth", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/channels" });
  return res;
}
