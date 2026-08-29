"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Check, Minus, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ROLE_LABELS,
  LEDGER_ROLES,
  STAFF_EDIT_ROLES,
  STAFF_VIEW_ROLES,
  DEVELOPER_ROLES,
  discountLimitFor,
  discountLimitLabel,
  isReadOnlyRole,
  type Profile,
} from "@/types";

const MIN_PASSWORD = 8;

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

function fmtJoined(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

export default function ProfilePage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [savedName, setSavedName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email || null);
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(data);
      setFullName(data?.full_name || "");
      setSavedName(data?.full_name || "");
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nameChanged = fullName.trim() !== savedName && fullName.trim().length > 0;

  // Live password checks, so nothing is rejected only after pressing the button.
  const checks = useMemo(
    () => [
      { label: `At least ${MIN_PASSWORD} characters`, ok: newPassword.length >= MIN_PASSWORD },
      { label: "Contains a number", ok: /\d/.test(newPassword) },
      { label: "Both entries match", ok: newPassword.length > 0 && newPassword === confirmPassword },
    ],
    [newPassword, confirmPassword]
  );
  const passwordReady = checks.every((c) => c.ok);

  async function saveName() {
    if (!profile || !nameChanged) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    const trimmed = fullName.trim();
    const { error: err } = await supabase.from("profiles").update({ full_name: trimmed }).eq("id", profile.id);
    if (err) setError(err.message);
    else {
      setSavedName(trimmed);
      setSavedMsg("Name updated.");
      setTimeout(() => setSavedMsg(null), 4000);
    }
    setSaving(false);
  }

  async function changePassword() {
    setPwError(null);
    setPwMsg(null);
    if (!passwordReady) return;
    setPwSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password: newPassword });
    if (err) setPwError(err.message);
    else {
      setPwMsg("Password updated. Use it the next time you sign in.");
      setNewPassword("");
      setConfirmPassword("");
      setShowPassword(false);
    }
    setPwSaving(false);
  }

  if (loading) return <div className="text-muted text-sm">Loading…</div>;
  if (!profile) return <div className="text-muted text-sm">Profile not found.</div>;

  const role = profile.role;
  const readOnly = isReadOnlyRole(role);
  const seesLedger = LEDGER_ROLES.includes(role) || profile.can_view_ledger;
  const joined = fmtJoined(profile.created_at);
  const realEmail = email && !email.endsWith(".serenemarqueeapp.com") ? email : null;

  // Every line below is read from the same rules the rest of the app enforces,
  // so this panel can't drift out of step with what the account can really do.
  const permissions = [
    { label: "Create and edit bookings", ok: !readOnly },
    { label: "Ledger, payroll and vendor accounts", ok: seesLedger },
    { label: "Record ledger entries and payments", ok: seesLedger && !readOnly },
    {
      label:
        discountLimitFor(role) === 0
          ? "Approve discounts"
          : `Approve discounts up to ${discountLimitLabel(role).replace(" per booking", "")}`,
      ok: discountLimitFor(role) > 0,
    },
    { label: "Staff & Access list", ok: STAFF_VIEW_ROLES.includes(role) },
    { label: "Edit staff roles and access", ok: STAFF_EDIT_ROLES.includes(role) },
    { label: "Developer Console", ok: DEVELOPER_ROLES.includes(role) },
  ];

  return (
    <div className="max-w-4xl">
      <div className="text-xl font-bold font-serif text-primary mb-1">Profile</div>
      <div className="text-xs text-muted mb-5">Your account and sign-in settings</div>

      {/* ---- Operations pass: the account at a glance ---- */}
      <div className="relative overflow-hidden rounded-xl2 bg-gradient-to-br from-[#1B1810] via-[#141210] to-[#0D0B08] border border-[#2A2620] shadow-card p-5 sm:p-6 mb-4">
        {/* A single soft gold bloom, echoing the sidebar rather than decorating. */}
        <div
          aria-hidden
          className="absolute -top-24 -right-16 w-64 h-64 rounded-full opacity-[0.14] blur-3xl bg-gold"
        />
        <div className="relative flex items-center gap-4 sm:gap-5">
          <div className="w-16 h-16 sm:w-[72px] sm:h-[72px] shrink-0 rounded-2xl bg-gradient-to-br from-[#D3AF52] to-[#8A6A1E] text-[#17140F] flex items-center justify-center font-serif font-bold text-[22px] sm:text-[26px] shadow-gold ring-1 ring-gold/40">
            {initials(fullName || savedName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9.5px] tracking-[0.2em] uppercase text-[#A99A6E] mb-1.5">
              Operations Pass
            </div>
            <div className="font-serif text-[19px] sm:text-[23px] font-bold text-gold-light leading-tight truncate">
              {savedName || "Unnamed account"}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gold/15 border border-gold/30 text-gold-light text-[11px] font-bold">
                <ShieldCheck size={12} strokeWidth={2.4} />
                {ROLE_LABELS[role]}
              </span>
              {profile.username && (
                <span className="text-[12px] text-[#A99A6E] font-medium">@{profile.username}</span>
              )}
              {readOnly && (
                <span className="text-[10.5px] text-[#A99A6E] border border-[#3A342A] rounded-full px-2 py-0.5">
                  Monitor only
                </span>
              )}
            </div>
          </div>
        </div>

        {(joined || realEmail) && (
          <div className="relative mt-5 pt-4 border-t border-gold/15 flex gap-8 flex-wrap">
            {joined && (
              <div>
                <div className="text-[9.5px] tracking-[0.16em] uppercase text-[#7C7053]">Member since</div>
                <div className="text-[12.5px] text-[#D9D1B4] font-semibold mt-0.5">{joined}</div>
              </div>
            )}
            {realEmail && (
              <div className="min-w-0">
                <div className="text-[9.5px] tracking-[0.16em] uppercase text-[#7C7053]">Email</div>
                <div className="text-[12.5px] text-[#D9D1B4] font-semibold mt-0.5 truncate">{realEmail}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ---- Editable settings ---- */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className="card">
            <div className="text-[13px] font-bold text-primary">Display name</div>
            <div className="text-[11.5px] text-muted mt-0.5 mb-3">
              How your name appears on bookings and ledger entries you record.
            </div>
            <input
              className="w-full"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
            />
            <div className="flex items-center justify-between gap-3 mt-3">
              <div className="text-xs font-semibold">
                {error && <span className="text-rose">{error}</span>}
                {savedMsg && <span className="text-gold-deep">{savedMsg}</span>}
              </div>
              <button
                onClick={saveName}
                disabled={saving || !nameChanged}
                className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save name"}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="text-[13px] font-bold text-primary">Change password</div>
            <div className="text-[11.5px] text-muted mt-0.5 mb-3">
              You'll stay signed in here. Use the new password next time.
            </div>

            <div className="grid gap-3">
              <div>
                <label className="text-xs font-bold text-muted uppercase">New password</label>
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="w-full pr-10"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-muted uppercase">Confirm new password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  className="w-full mt-1"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && changePassword()}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1 mt-3">
              {checks.map((c) => (
                <div
                  key={c.label}
                  className={`flex items-center gap-2 text-[11.5px] ${
                    c.ok ? "text-gold-deep font-semibold" : "text-muted"
                  }`}
                >
                  {c.ok ? <Check size={13} strokeWidth={3} /> : <Minus size={13} strokeWidth={2.5} />}
                  {c.label}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 mt-3">
              <div className="text-xs font-semibold">
                {pwError && <span className="text-rose">{pwError}</span>}
                {pwMsg && <span className="text-gold-deep">{pwMsg}</span>}
              </div>
              <button
                onClick={changePassword}
                disabled={pwSaving || !passwordReady}
                className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-40"
              >
                {pwSaving ? "Updating…" : "Update password"}
              </button>
            </div>
          </div>
        </div>

        {/* ---- What this account can do ---- */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="text-[13px] font-bold text-primary">What your account can do</div>
            <div className="text-[11.5px] text-muted mt-0.5 mb-3">
              Set by your role. Ask an owner or the developer if something you need is missing.
            </div>
            <div className="flex flex-col">
              {permissions.map((p) => (
                <div
                  key={p.label}
                  className="flex items-start gap-2.5 py-2 border-b border-dashed border-border last:border-0"
                >
                  <span
                    className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                      p.ok ? "bg-primary-dim text-gold-deep" : "bg-bg text-muted border border-border"
                    }`}
                  >
                    {p.ok ? <Check size={10} strokeWidth={3.5} /> : <Minus size={10} strokeWidth={3} />}
                  </span>
                  <span className={`text-[12.5px] leading-snug ${p.ok ? "text-ink" : "text-muted"}`}>
                    {p.label}
                  </span>
                </div>
              ))}
            </div>
            {readOnly && (
              <div className="mt-3 bg-gold-light border border-gold/30 text-gold-deep rounded-lg px-3 py-2 text-[11.5px] font-semibold">
                This account monitors the portal. You can open and download everything you have access to, but
                nothing can be changed from here.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
