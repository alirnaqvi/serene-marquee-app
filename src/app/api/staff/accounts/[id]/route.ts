import { NextResponse } from "next/server";
import { createAdminClient, MISSING_KEY_MESSAGE } from "@/lib/supabase/admin";
import { currentStaff, temporaryPassword, canResetPasswordOf } from "@/lib/serverAuth";
import { TEMP_PASSWORD_HOURS } from "@/lib/auth";
import { STAFF_EDIT_ROLES, type Role } from "@/types";

/**
 * Account actions from Staff & Access:
 *   reset   — issue a temporary password (Admin or Developer)
 *   block   — stop the login signing in, keeping its history (Developer)
 *   unblock — let it sign in again (Developer)
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ error: "You're not signed in." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });

  let body: { action?: string } = {};
  try {
    body = await request.json();
  } catch {}
  if (params.id === me.id) return NextResponse.json({ error: "Use Profile to change your own account." }, { status: 400 });

  const { data: target } = await admin.from("profiles").select("role, full_name").eq("id", params.id).single();
  const { data: authUser } = await admin.auth.admin.getUserById(params.id);
  if (!target || !authUser?.user) return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });

  if (body.action === "reset") {
    if (!canResetPasswordOf(me.role, target.role as Role))
      return NextResponse.json({ error: "You can't reset the password of an account at your level or above." }, { status: 403 });
    const password = temporaryPassword();
    const { error } = await admin.auth.admin.updateUserById(params.id, {
      password,
      app_metadata: {
        ...(authUser.user.app_metadata || {}),
        must_change_password: true,
        temp_password_expires_at: new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600_000).toISOString(),
      },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await admin
      .from("password_reset_requests")
      .update({ status: "done", resolved_by: me.id, resolved_at: new Date().toISOString() })
      .eq("user_id", params.id)
      .eq("status", "pending");
    return NextResponse.json({ ok: true, password, name: target.full_name });
  }

  if (body.action === "block" || body.action === "unblock") {
    if (!STAFF_EDIT_ROLES.includes(me.role))
      return NextResponse.json({ error: "Only the Developer can block logins." }, { status: 403 });
    const { error } = await admin.auth.admin.updateUserById(params.id, {
      ban_duration: body.action === "block" ? "876000h" : "none",
    } as any);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

/**
 * Delete a login outright — meant for the random accounts. One with history
 * (bookings, ledger entries, requests) can't be deleted without breaking that
 * history, so it is blocked instead and the reply says so.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const me = await currentStaff();
  if (!me || !STAFF_EDIT_ROLES.includes(me.role))
    return NextResponse.json({ error: "Only the Developer can remove logins." }, { status: 403 });
  if (params.id === me.id) return NextResponse.json({ error: "You can't remove your own login." }, { status: 400 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });

  const { error } = await admin.auth.admin.deleteUser(params.id);
  if (!error) return NextResponse.json({ ok: true, deleted: true });

  const { error: banErr } = await admin.auth.admin.updateUserById(params.id, { ban_duration: "876000h" } as any);
  if (banErr) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    ok: true,
    deleted: false,
    message: "This login has records attached to it, so it was blocked from signing in instead of deleted.",
  });
}
