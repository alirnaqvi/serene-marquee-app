import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import { LEDGER_ROLES, STAFF_EDIT_ROLES, STAFF_VIEW_ROLES, DEVELOPER_ROLES, type Role } from "@/types";

// The whole authenticated app must render per-request/per-user — this
// layout's profile/role lookup and every page beneath it depend on who's
// logged in, so nothing here should ever be statically cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  // Middleware already ran auth.getUser() (a real network round-trip to
  // Supabase's auth server) and redirected unauthenticated visitors before
  // this layout even renders. Calling getUser() again here would be a
  // second identical round-trip on every single page navigation — a huge
  // chunk of the "5-10 second load" the app had. getSession() reads the
  // already-verified session straight from the request cookie, no network
  // call, so we use that here and go straight to the one query we actually
  // need (the profile row for role/permissions).
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");
  const user = session.user;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, can_view_ledger")
    .eq("id", user.id)
    .single();

  const role = (profile?.role as Role) || "staff";
  const fullName = profile?.full_name || user.email || "Staff";
  // General Manager never sees the ledger, even if can_view_ledger was ever
  // set true by mistake — this mirrors the RLS enforcement at the DB level.
  const canViewLedger = Boolean(
    LEDGER_ROLES.includes(role) || (profile?.can_view_ledger && role !== "general_manager")
  );
  const canEditStaff = STAFF_EDIT_ROLES.includes(role);
  const canViewStaffPage = STAFF_VIEW_ROLES.includes(role);
  const isDeveloper = DEVELOPER_ROLES.includes(role);

  return (
    <AppShell
      fullName={fullName}
      role={role}
      canViewLedger={canViewLedger}
      canViewStaffPage={canViewStaffPage}
      canEditStaff={canEditStaff}
      isDeveloper={isDeveloper}
    >
      {children}
    </AppShell>
  );
}
