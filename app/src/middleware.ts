import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/api/login", "/api/webhooks", "/api/jobs", "/auth", "/privacy", "/data-deletion"];

/** Keeps the session fresh and sends signed-out visitors to /login. Does nothing in demo mode (no keys). */
export async function middleware(req: NextRequest) {
  // One address only. Login and the Meta connection use cookies that belong to one host, and Meta sends people back to the
  // configured address: someone who started on a long deployment address would come back signed out ("link expired").
  const site = (() => {
    try {
      return process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : null;
    } catch {
      return null;
    }
  })();
  const host = req.headers.get("host") ?? "";
  if (site && host && host !== site.host && !/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) && (req.method === "GET" || req.method === "HEAD")) {
    // build from the canonical origin and set only path and query, so a path such as //other.site can never change the destination
    const to = new URL(site.origin);
    to.pathname = req.nextUrl.pathname.replace(/^\/{2,}/, "/");
    to.search = req.nextUrl.search;
    if (to.origin !== site.origin) return new NextResponse(null, { status: 400 });
    return NextResponse.redirect(to, 308);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return NextResponse.next();
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await sb.auth.getUser(); // verifies the token with Supabase, unlike getSession()
  const path = req.nextUrl.pathname;
  const open = PUBLIC.some((p) => path === p || path.startsWith(p + "/"));
  if (!data.user && !open) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (data.user && path === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/|brand/).*)"] };
