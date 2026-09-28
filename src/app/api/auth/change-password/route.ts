import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, MISSING_KEY_MESSAGE } from "@/lib/supabase/admin";
import { passwordProblem } from "@/lib/auth";

/**
 * Change your own password — from Profile, or the forced change after signing
 * in with a temporary password.
 *
 * The current password is always checked first, so someone who walks up to a
 * signed-in computer can't lock the owner out of their account. Clearing the
 * "must change" flag happens here, on the server, because the account can't
 * edit that flag itself.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "You're not signed in." }, { status: 401 });

  let body: { current?: string; next?: string } = {};
  try {
    body = await request.json();
  } catch {}
  const current = String(body.current || "");
  const next = String(body.next || "");

  const problem = passwordProblem(next);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (next === current) return NextResponse.json({ error: "Choose a password different from the current one." }, { status: 400 });

  // Check the current password with a throwaway client, so the signed-in
  // session in the browser isn't touched.
  const verifier = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: wrong } = await verifier.auth.signInWithPassword({ email: user.email, password: current });
  if (wrong) return NextResponse.json({ error: "Your current password isn't right." }, { status: 400 });
  await verifier.auth.signOut({ scope: "local" });

  const admin = createAdminClient();
  if (!admin) {
    // Without the service key, still let a normal change through; only the
    // forced-change flag can't be cleared.
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (user.app_metadata?.must_change_password) return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password: next,
    app_metadata: { ...(user.app_metadata || {}), must_change_password: false, temp_password_expires_at: null },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
