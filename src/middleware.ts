import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes anyone can reach without signing in. Everything else in the app is
// staff-only and gets bounced to /login.
//
// Exact matches only — a `startsWith` check here would mean a path like
// /login-something, or worse /dashboard prefixed oddly, could slip through.
const PUBLIC_PATHS = new Set(["/", "/login"]);

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Not signed in and asking for a staff page — send them to the login form.
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Already signed in and landing on the login form — skip straight through.
  // The public homepage is deliberately NOT redirected: staff should still be
  // able to open the marquee's own page while signed in.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip Next internals and any static asset, so the venue photos and the
    // logo are served without a round trip through Supabase auth.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|webmanifest)$).*)",
  ],
};
