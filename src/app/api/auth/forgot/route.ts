import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameSlug, usernameToEmail } from "@/lib/auth";

/**
 * "Forgot password" from the login page.
 *
 * Records a request for the Admin/Developer to act on. The reply is the same
 * whether or not the username exists, so this can't be used to find out which
 * usernames are real. Repeat requests are capped per username and per network
 * address so the queue can't be flooded.
 */
const SAME_REPLY = {
  ok: true,
  message:
    "Your request has been sent. The Admin will give you a temporary password — ask them directly. It works for 24 hours and you'll choose a new password when you sign in.",
};

export async function POST(request: Request) {
  const admin = createAdminClient();
  if (!admin) return NextResponse.json(SAME_REPLY);

  let body: { username?: string; note?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Enter your username." }, { status: 400 });
  }
  const slug = usernameSlug(String(body.username || "")).slice(0, 60);
  const note = String(body.note || "").trim().slice(0, 300) || null;
  if (!slug) return NextResponse.json({ ok: false, message: "Enter your username." }, { status: 400 });

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64) || null;
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();

  // Throttle: 5 requests an hour from one network address.
  if (ip) {
    const { count } = await admin
      .from("password_reset_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("requested_at", hourAgo);
    if ((count || 0) >= 5) return NextResponse.json(SAME_REPLY);
  }

  const { data: userId } = await admin.rpc("user_id_for_login", { p_email: usernameToEmail(slug) });
  if (!userId) return NextResponse.json(SAME_REPLY);

  // One open request per person is enough; a repeat just refreshes the note.
  const { data: open } = await admin
    .from("password_reset_requests")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(1);
  if (open && open.length) {
    await admin
      .from("password_reset_requests")
      .update({ note, requested_at: new Date().toISOString(), ip })
      .eq("id", open[0].id);
  } else {
    await admin.from("password_reset_requests").insert({ user_id: userId, username: slug, note, ip });
  }
  return NextResponse.json(SAME_REPLY);
}
