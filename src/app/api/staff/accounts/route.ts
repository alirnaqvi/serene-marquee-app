import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createAdminClient, MISSING_KEY_MESSAGE } from "@/lib/supabase/admin";
import { currentStaff, temporaryPassword } from "@/lib/serverAuth";
import { usernameSlug, usernameToEmail, TEMP_PASSWORD_HOURS } from "@/lib/auth";
import { STAFF_EDIT_ROLES, STAFF_VIEW_ROLES, type Role } from "@/types";

const ROLES: Role[] = ["staff", "manager", "general_manager", "admin", "owner", "developer"];

/** Sign-in details Staff & Access shows alongside each profile. */
export async function GET() {
  const me = await currentStaff();
  if (!me || !STAFF_VIEW_ROLES.includes(me.role)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: MISSING_KEY_MESSAGE, accounts: {} });

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const accounts: Record<string, { last_sign_in_at: string | null; blocked: boolean; must_change: boolean }> = {};
  data.users.forEach((u) => {
    accounts[u.id] = {
      last_sign_in_at: u.last_sign_in_at || null,
      blocked: Boolean((u as any).banned_until && new Date((u as any).banned_until) > new Date()),
      must_change: Boolean(u.app_metadata?.must_change_password),
    };
  });
  return NextResponse.json({ accounts });
}

/**
 * Create a login. Developer only, per the Staff & Access policy. The new
 * account gets a temporary password that must be changed at first sign-in.
 */
export async function POST(request: Request) {
  const me = await currentStaff();
  if (!me || !STAFF_EDIT_ROLES.includes(me.role))
    return NextResponse.json({ error: "Only the Developer can create logins." }, { status: 403 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });

  let body: { full_name?: string; username?: string; role?: Role } = {};
  try {
    body = await request.json();
  } catch {}
  const fullName = String(body.full_name || "").trim().slice(0, 80);
  const slug = usernameSlug(String(body.username || "")).slice(0, 40);
  const role = ROLES.includes(body.role as Role) ? (body.role as Role) : "staff";
  if (!fullName) return NextResponse.json({ error: "Enter the person's full name." }, { status: 400 });
  if (slug.length < 3) return NextResponse.json({ error: "Username needs at least 3 letters or numbers." }, { status: 400 });

  // Single-use pass that the database checks before it allows a new login.
  const token = randomBytes(24).toString("hex");
  const { error: inviteErr } = await admin.from("account_invites").insert({ token, created_by: me.id });
  if (inviteErr) return NextResponse.json({ error: "Run database migration 2026-19 first." }, { status: 500 });

  const password = temporaryPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: usernameToEmail(slug),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username: slug, invite_token: token },
    app_metadata: {
      must_change_password: true,
      temp_password_expires_at: new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600_000).toISOString(),
    },
  });
  if (error || !data.user) {
    await admin.from("account_invites").delete().eq("token", token);
    const taken = (error?.message || "").toLowerCase().includes("already");
    return NextResponse.json(
      { error: taken ? `The username “${slug}” is already taken.` : error?.message || "Couldn't create the login." },
      { status: 400 }
    );
  }
  await admin.from("profiles").update({ role }).eq("id", data.user.id);
  return NextResponse.json({ ok: true, username: slug, password });
}
