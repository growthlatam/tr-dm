import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizeUrl, missingConfig } from "@/lib/channels";
import { signState } from "@/lib/crypto";
import { serverClient } from "@/lib/supabase/server";

/** Sends the signed-in person to Instagram to approve access for one of their professional accounts. */
export async function GET(req: NextRequest) {
  if (missingConfig().length) return NextResponse.redirect(new URL("/settings?connect_error=not_configured", req.nextUrl.origin));
  const sb = await serverClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  const { data: m } = await sb.from("org_members").select("role").eq("user_id", data.user.id).maybeSingle();
  if (!m || !["owner", "admin", "editor"].includes(m.role as string)) return NextResponse.redirect(new URL("/settings?connect_error=forbidden", req.nextUrl.origin));
  const state = signState({ u: data.user.id, n: randomBytes(8).toString("hex"), exp: Date.now() + 10 * 60_000 });
  const mode = req.nextUrl.searchParams.get("mode") === "instagram" ? "instagram" : "portfolio";
  const res = NextResponse.redirect(authorizeUrl(state, mode));
  res.cookies.set("ig_oauth", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/channels" });
  return res;
}
