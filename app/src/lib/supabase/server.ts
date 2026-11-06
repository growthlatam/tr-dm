import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client for route handlers and server components. Reads the session from http-only cookies. */
export async function serverClient() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // called from a server component: the middleware refreshes the session instead
        }
      },
    },
  });
}
