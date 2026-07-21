import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// IMPORTANT: Next.js's App Router caches `fetch()` calls by default (its
// "Data Cache"), and that cache is NOT aware of which user is logged in —
// it's keyed only on the request URL/params. Supabase's client uses fetch
// under the hood, so without this, one user's query result could get
// cached and then served back to a *different* user on a later request,
// and/or every user would see stale data until the cache happened to
// revalidate. Passing `cache: "no-store"` here means every server-side
// Supabase call always hits the database fresh, per request, per user.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // called from a Server Component — safe to ignore when
            // middleware is refreshing the session
          }
        },
        remove(name: string, options: any) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // see note above
          }
        },
      },
      global: {
        fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
      },
    }
  );
}
