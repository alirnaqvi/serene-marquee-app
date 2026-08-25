"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ROLE_LABELS,
  STAFF_EDIT_ROLES,
  STAFF_VIEW_ROLES,
  LEDGER_ROLES,
  discountLimitLabel,
  isReadOnlyRole,
  type Profile,
} from "@/types";

export default function StaffAdminPage() {
  const supabase = createClient();
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: mine }, { data: all }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("profiles").select("*").order("full_name"),
    ]);
    setMyProfile(mine);
    setStaff(all || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function updateRole(id: string, role: Profile["role"]) {
    setSavingId(id);
    setError(null);
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) setError(error.message);
    else setStaff((prev) => prev.map((p) => (p.id === id ? { ...p, role } : p)));
    setSavingId(null);
  }

  async function updateLedgerAccess(id: string, can_view_ledger: boolean) {
    setSavingId(id);
    setError(null);
    const { error } = await supabase.from("profiles").update({ can_view_ledger }).eq("id", id);
    if (error) setError(error.message);
    else setStaff((prev) => prev.map((p) => (p.id === id ? { ...p, can_view_ledger } : p)));
    setSavingId(null);
  }

  if (loading) return <div className="text-muted text-sm">Loading…</div>;

  const myRole = myProfile?.role || "staff";
  const canView = STAFF_VIEW_ROLES.includes(myRole);
  const canEdit = STAFF_EDIT_ROLES.includes(myRole);

  if (!canView) {
    return (
      <div className="card max-w-md">
        <div className="text-[14.5px] font-bold text-primary mb-2">Restricted</div>
        <div className="text-sm text-muted">
          Staff roles and ledger access are managed by the Admin account. If you need a change made
          here, ask your marquee's admin to do it, or to grant you view/edit access.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xl font-bold font-serif text-primary mb-1">Staff & Access</div>
      <div className="text-xs text-muted mb-5">
        {canEdit
          ? "Manage roles and daily-ledger visibility for everyone with a login. Changes take effect immediately."
          : "View-only — roles and ledger access here are edited by the Admin account."}
      </div>

      {error && <div className="text-rose text-sm font-semibold mb-3">{error}</div>}

      <div className="card">
        <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
              <th className="py-2 px-2">Name</th>
              <th className="py-2 px-2">Role</th>
              <th className="py-2 px-2">Ledger Access</th>
              <th className="py-2 px-2">Discount Limit</th>
              <th className="py-2 px-2">Joined</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((p) => {
              const isSelf = p.id === myProfile?.id;
              const ledgerAutoGranted = LEDGER_ROLES.includes(p.role);
              const isGeneralManager = p.role === "general_manager";
              return (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="py-2.5 px-2 font-semibold">
                    {p.full_name}
                    {isSelf && <span className="text-[10px] text-muted font-normal ml-1.5">(you)</span>}
                    {p.username && <div className="text-[11px] text-muted font-normal">@{p.username}</div>}
                  </td>
                  <td className="py-2.5 px-2">
                    {canEdit ? (
                      <select
                        className="text-[12.5px] py-1"
                        value={p.role}
                        disabled={isSelf || savingId === p.id}
                        onChange={(e) => updateRole(p.id, e.target.value as Profile["role"])}
                      >
                        <option value="staff">Staff</option>
                        <option value="general_manager">General Manager</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                        <option value="developer">Developer</option>
                      </select>
                    ) : (
                      <span className="text-[12.5px] font-semibold">{ROLE_LABELS[p.role]}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2">
                    {isGeneralManager ? (
                      <span className="text-[11px] text-muted italic">No access (General Manager policy)</span>
                    ) : ledgerAutoGranted ? (
                      <span className="text-[11px] text-muted italic">Granted automatically ({ROLE_LABELS[p.role]})</span>
                    ) : canEdit ? (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={p.can_view_ledger}
                          disabled={savingId === p.id}
                          onChange={(e) => updateLedgerAccess(p.id, e.target.checked)}
                        />
                        <span className="text-[12.5px]">{p.can_view_ledger ? "Enabled" : "Disabled"}</span>
                      </label>
                    ) : (
                      <span className="text-[12.5px]">{p.can_view_ledger ? "Enabled" : "Disabled"}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-[12px]">
                    {discountLimitLabel(p.role)}
                    {isReadOnlyRole(p.role) && (
                      <div className="text-[10.5px] text-muted">Monitor only — cannot edit anything</div>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-muted text-[12px]">
                    {p.created_at
                      ? new Date(p.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      <div className="card mt-4">
        <div className="text-[13px] font-bold text-primary mb-2">Role Policy</div>
        <ul className="text-[12.5px] text-muted list-disc pl-5 flex flex-col gap-1">
          <li>
            <b className="text-primary">Manager</b> — may approve up to{" "}
            <b className="text-primary">Rs. 50,000</b> discount per booking.
          </li>
          <li>
            <b className="text-primary">General Manager</b> — may approve up to{" "}
            <b className="text-primary">Rs. 100,000</b> discount per booking.
          </li>
          <li>
            <b className="text-primary">Owner / CEO</b> — monitor only. Can view every screen they have access
            to, but cannot create, edit or delete anything.
          </li>
          <li>
            <b className="text-primary">Admin / Developer</b> — no discount ceiling.
          </li>
        </ul>
        <div className="text-[11px] text-muted mt-2.5">
          These limits are enforced in the database as well as the screens, so they hold even outside the app.
        </div>
      </div>

      {canEdit && (
        <div className="text-[11.5px] text-muted mt-3">
          You can't change your own role here (to avoid accidentally locking yourself out) — ask another
          admin, or use the Supabase dashboard if you're the only one.
        </div>
      )}
    </div>
  );
}
