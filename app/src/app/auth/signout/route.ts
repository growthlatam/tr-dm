import { NextResponse, type NextRequest } from "next/server";
import { serverClient } from "@/lib/supabase/server";

/** Signs out on every device, then back to the sign-in page. POST only, so a link cannot trigger it. */
export async function POST(req: NextRequest) {
  const sb = await serverClient();
  await sb.auth.signOut({ scope: "global" });
  return NextResponse.redirect(new URL("/login", req.nextUrl.origin), 303);
}
