import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SERVER ONLY. A Supabase client holding the secret service key, which can
 * create logins, reset passwords and read past row-level security.
 *
 * Never import this from a "use client" file — the key must never reach a
 * browser. It is read from SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix,
 * so Next.js keeps it on the server).
 */
export function createAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const MISSING_KEY_MESSAGE =
  "The server isn't set up for account management yet: add SUPABASE_SERVICE_ROLE_KEY to the app's environment variables (Vercel → Settings → Environment Variables) and redeploy.";
