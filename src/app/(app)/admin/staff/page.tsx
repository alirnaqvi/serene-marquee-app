"use client";

import { useEffect, useState } from "react";
import { KeyRound, UserPlus, Copy, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { canResetPasswordOf } from "@/lib/auth";
import AlertModal from "@/components/AlertModal";
import {
  ROLE_LABELS,
  STAFF_EDIT_ROLES,
  STAFF_VIEW_ROLES,
  LEDGER_ROLES,
  discountLimitLabel,
  isReadOnlyRole,
  type Profile,
} from "@/types";

type AccountInfo = { last_sign_in_at: string | null; blocked: boolean; must_change: boolean };
type ResetRequest = {
  id: string;
  user_id: string | null;
  username: string;
  note: string | null;
  requested_at: string;
};

function fmtWhen(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function StaffAdminPage() {
  const supabase = createClient();
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Record<string, AccountInfo>>({});
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  // A temporary password just issued — shown once, then gone.
  const [issued, setIssued] = useState<{ name: string; username?: string | null; password: string; isNew?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState<Profile | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Profile | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newRole, setNewRole] = useState<Profile["role"]>("staff");
  const [adding, setAdding] = useState(false);

  async function loadAccounts() {
    const res = await fetch("/api/staff/accounts");
    const out = await res.json().catch(() => ({}));
    setAccounts(out.accounts || {});
    setAccountsError(out.error || null);
  }

  async function loadRequests() {
    const { data } = await supabase
      .from("password_reset_requests")
      .select("id, user_id, username, note, requested_at")
      .eq("status", "pending")
      .order("requested_at", { ascending: false });
    setRequests((data as ResetRequest[]) || []);
  }

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
    loadAccounts();
    loadRequests();
    const channel = supabase
      .channel("reset-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "password_reset_requests" }, () => loadRequests())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function accountAction(id: string, action: "reset" | "block" | "unblock") {
    setSavingId(id);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/staff/accounts/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const out = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) return setError(out.error || "That didn't work.");
    if (action === "reset") {
      const who = staff.find((p) => p.id === id);
      setCopied(false);
      setIssued({ name: out.name, username: who?.username, password: out.password });
      loadRequests();
    } else {
      setNotice(action === "block" ? "Login switched off." : "Login switched back on.");
    }
    loadAccounts();
  }

  async function removeAccount(p: Profile) {
    setConfirmRemove(null);
    setSavingId(p.id);
    setError(null);
    const res = await fetch(`/api/staff/accounts/${p.id}`, { method: "DELETE" });
    const out = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) return setError(out.error || "Couldn't remove that login.");
    setNotice(out.deleted ? `${p.full_name}'s login was deleted.` : out.message);
    load();
    loadAccounts();
  }

  async function addAccount() {
    setAdding(true);
    setError(null);
    const res = await fetch("/api/staff/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: newName, username: newUsername, role: newRole }),
    });
    const out = await res.json().catch(() => ({}));
    setAdding(false);
    if (!res.ok) return setError(out.error || "Couldn't create the login.");
    setShowAdd(false);
    setCopied(false);
    setIssued({ name: newName.trim(), username: out.username, password: out.password, isNew: true });
    setNewName("");
    setNewUsername("");
    setNewRole("staff");
    load();
    loadAccounts();
  }

  async function dismissRequest(id: string) {
    await supabase
      .from("password_reset_requests")
      .update({ status: "dismissed", resolved_at: new Date().toISOString(), resolved_by: myProfile?.id })
      .eq("id", id);
    loadRequests();
  }

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

      {canEdit && (
        <div className="flex justify-end -mt-3 mb-4">
          <button onClick={() => { setError(null); setShowAdd(true); }} className="btn-primary rounded-lg px-4 py-2 text-sm flex items-center gap-1.5">
            <UserPlus size={15} /> Add staff login
          </button>
        </div>
      )}

      {error && <div className="text-rose text-sm font-semibold mb-3 bg-rose-light rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-gold-deep text-sm font-semibold mb-3 bg-gold-light rounded-lg px-3 py-2">{notice}</div>}
      {accountsError && (
        <div className="text-[12px] text-[#6B5320] bg-gold-light border border-gold/30 rounded-lg px-3 py-2 mb-3">{accountsError}</div>
      )}

      {requests.length > 0 && (
        <div className="card mb-4 border-gold/50">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={16} className="text-gold-deep" />
            <div className="text-[14px] font-bold text-primary">
              Password reset requests ({requests.length})
            </div>
          </div>
          <div className="text-[11.5px] text-muted mb-3">
            Check it really is the person before issuing a password — ideally face to face or on a number you
            already know. The temporary password works for 24 hours and must be changed at the first sign-in.
          </div>
          <ul className="divide-y divide-border">
            {requests.map((r) => {
              const person = staff.find((p) => p.id === r.user_id);
              const allowed = person ? canResetPasswordOf(myRole, person.role) : false;
              return (
                <li key={r.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-[13px] min-w-0">
                    <b>{person?.full_name || r.username}</b>{" "}
                    <span className="text-muted">@{r.username}{person ? ` · ${ROLE_LABELS[person.role]}` : ""}</span>
                    <div className="text-[11.5px] text-muted">
                      Asked {fmtWhen(r.requested_at)}
                      {r.note && <> · “{r.note}”</>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {allowed && person && (
                      <button
                        onClick={() => setConfirmReset(person)}
                        disabled={savingId === person.id}
                        className="btn-primary rounded-lg px-3 py-1.5 text-xs"
                      >
                        Issue temporary password
                      </button>
                    )}
                    {!allowed && person && (
                      <span className="text-[11px] text-muted self-center">Only the Developer can reset this account</span>
                    )}
                    {(myRole === "admin" || myRole === "developer") && (
                      <button onClick={() => dismissRequest(r.id)} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
                        Dismiss
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[860px] text-[13px]">
          <thead>
            <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
              <th className="py-2 px-2">Name</th>
              <th className="py-2 px-2">Role</th>
              <th className="py-2 px-2">Ledger Access</th>
              <th className="py-2 px-2">Discount Limit</th>
              <th className="py-2 px-2">Last Sign-in</th>
              <th className="py-2 px-2"></th>
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
                    {accounts[p.id] ? fmtWhen(accounts[p.id].last_sign_in_at) : "—"}
                    <div className="text-[10.5px]">
                      Added{" "}
                      {p.created_at
                        ? new Date(p.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </div>
                    {accounts[p.id]?.blocked && <div className="text-[10.5px] font-bold text-rose">Switched off</div>}
                    {accounts[p.id]?.must_change && !accounts[p.id]?.blocked && (
                      <div className="text-[10.5px] font-semibold text-gold-deep">On a temporary password</div>
                    )}
                  </td>
                  <td className="py-2.5 px-2">
                    {!isSelf && (
                      <div className="flex gap-1.5 justify-end flex-wrap">
                        {canResetPasswordOf(myRole, p.role) && (
                          <button
                            onClick={() => setConfirmReset(p)}
                            disabled={savingId === p.id}
                            className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap"
                          >
                            Reset password
                          </button>
                        )}
                        {canEdit && (
                          <>
                            <button
                              onClick={() => accountAction(p.id, accounts[p.id]?.blocked ? "unblock" : "block")}
                              disabled={savingId === p.id}
                              className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap"
                            >
                              {accounts[p.id]?.blocked ? "Switch on" : "Switch off"}
                            </button>
                            <button
                              onClick={() => setConfirmRemove(p)}
                              disabled={savingId === p.id}
                              className="text-[11px] font-semibold text-rose border border-rose/30 rounded-md px-2.5 py-1 hover:bg-rose-light whitespace-nowrap"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    )}
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
            <b className="text-primary">Rs. 100,000</b> discount per booking.
          </li>
          <li>
            <b className="text-primary">General Manager</b> — may approve up to{" "}
            <b className="text-primary">Rs. 200,000</b> discount per booking.
          </li>
          <li>
            <b className="text-primary">Owner / CEO</b> — monitor only. Can view every screen they have access
            to, but cannot create, edit or delete anything.
          </li>
          <li>
            <b className="text-primary">Admin / Developer</b> — no discount ceiling.
          </li>
          <li>
            <b className="text-primary">Going above your limit</b> — send an approval request up the chain:
            Admin → General Manager → Manager. A Manager's request reaches both the General Manager and the
            Admin, and whoever acts on it first decides it. Approvals appear on the dashboard and in the
            notification bell, and are good for one booking only.
          </li>
        </ul>
        <div className="text-[11px] text-muted mt-2.5">
          These limits are enforced in the database as well as the screens, so they hold even outside the app —
          including the approval permit, which is spent on the single booking it was granted for.
        </div>
      </div>

      {confirmReset && (
        <AlertModal
          title={`Reset ${confirmReset.full_name}'s password?`}
          message={`Their current password stops working straight away. You'll get a temporary password to give them — it works for 24 hours, and they must choose a new one when they sign in.`}
          confirmLabel="Reset password"
          onConfirm={() => {
            const p = confirmReset;
            setConfirmReset(null);
            accountAction(p.id, "reset");
          }}
          onClose={() => setConfirmReset(null)}
        />
      )}

      {confirmRemove && (
        <AlertModal
          title={`Remove ${confirmRemove.full_name}'s login?`}
          message={`They won't be able to sign in again. If this login has recorded bookings, ledger entries or requests, it is switched off instead of deleted, so that history stays intact.`}
          tone="danger"
          confirmLabel="Remove login"
          onConfirm={() => removeAccount(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <div className="font-bold text-sm text-primary">Add staff login</div>
              <div className="text-xs text-muted mt-0.5">A temporary password is made for you to hand over.</div>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              {error && <div className="text-rose text-[12.5px] font-semibold">{error}</div>}
              <div>
                <label className="text-xs font-bold text-muted uppercase">Full name</label>
                <input className="w-full mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="text-xs font-bold text-muted uppercase">Username</label>
                <input
                  className="w-full mt-1"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
                  placeholder="e.g. ali.hamza"
                  autoCapitalize="none"
                />
                <div className="text-[11px] text-muted mt-1">What they type to sign in. Letters, numbers, dots.</div>
              </div>
              <div>
                <label className="text-xs font-bold text-muted uppercase">Role</label>
                <select className="w-full mt-1" value={newRole} onChange={(e) => setNewRole(e.target.value as Profile["role"])}>
                  <option value="staff">Staff</option>
                  <option value="manager">Manager</option>
                  <option value="general_manager">General Manager</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={addAccount}
                disabled={adding || !newName.trim() || newUsername.length < 3}
                className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-40"
              >
                {adding ? "Creating…" : "Create login"}
              </button>
            </div>
          </div>
        </div>
      )}

      {issued && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-gold-light">
              <div className="font-bold text-sm text-gold-deep">
                {issued.isNew ? `Login created for ${issued.name}` : `Temporary password for ${issued.name}`}
              </div>
            </div>
            <div className="px-5 py-4">
              {issued.username && (
                <div className="text-[12.5px] mb-2">
                  Username: <b className="font-mono">{issued.username}</b>
                </div>
              )}
              <div className="flex items-center gap-2 bg-bg border border-border rounded-lg px-3 py-2.5">
                <span className="font-mono text-[18px] font-bold tracking-wide text-primary flex-1 select-all">{issued.password}</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(issued.password);
                    setCopied(true);
                  }}
                  className="text-muted hover:text-primary p-1"
                  aria-label="Copy password"
                >
                  {copied ? <Check size={16} className="text-gold-deep" /> : <Copy size={16} />}
                </button>
              </div>
              <div className="text-[12px] text-muted mt-3 leading-relaxed">
                Give this to {issued.name} yourself — in person or by calling a number you already have. It is shown
                <b> only this once</b>, works for 24 hours, and they must choose their own password when they sign in.
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-border flex justify-end">
              <button onClick={() => setIssued(null)} className="btn-primary rounded-lg px-4 py-2 text-sm">
                I've handed it over
              </button>
            </div>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="text-[11.5px] text-muted mt-3">
          You can't change your own role here (to avoid accidentally locking yourself out) — ask another
          admin, or use the Supabase dashboard if you're the only one.
        </div>
      )}
    </div>
  );
}
