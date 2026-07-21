"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, type Profile } from "@/types";

export default function ProfilePage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveName() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    const { error } = await supabase.from("profiles").update({ full_name: fullName.trim() }).eq("id", profile.id);
    if (error) setError(error.message);
    else setSavedMsg("Saved.");
    setSaving(false);
  }

  async function changePassword() {
    setPwError(null);
    setPwMsg(null);
    if (newPassword.length < 6) return setPwError("Password should be at least 6 characters.");
    if (newPassword !== confirmPassword) return setPwError("Passwords don't match.");
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setPwError(error.message);
    else {
      setPwMsg("Password updated.");
      setNewPassword("");
      setConfirmPassword("");
    }
    setPwSaving(false);
  }

  if (loading) return <div className="text-muted text-sm">Loading…</div>;
  if (!profile) return <div className="text-muted text-sm">Profile not found.</div>;

  return (
    <div className="max-w-lg">
      <div className="text-xl font-bold font-serif text-primary mb-1">Profile</div>
      <div className="text-xs text-muted mb-5">Your account info and login settings</div>

      <div className="card mb-4">
        <div className="text-[13px] font-bold text-primary mb-3">Account Info</div>
        <div className="divide-y divide-dashed divide-border text-[13px]">
          <div className="flex justify-between py-2">
            <span className="text-muted">Role</span>
            <span className="font-semibold">{ROLE_LABELS[profile.role]}</span>
          </div>
          {profile.username && (
            <div className="flex justify-between py-2">
              <span className="text-muted">Username</span>
              <span className="font-semibold">@{profile.username}</span>
            </div>
          )}
          {email && !email.endsWith(".serenemarqueeapp.com") && (
            <div className="flex justify-between py-2">
              <span className="text-muted">Email</span>
              <span className="font-semibold">{email}</span>
            </div>
          )}
          {profile.created_at && (
            <div className="flex justify-between py-2">
              <span className="text-muted">Joined</span>
              <span className="font-semibold">
                {new Date(profile.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="card mb-4">
        <div className="text-[13px] font-bold text-primary mb-3">Display Name</div>
        <input className="w-full" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        {error && <div className="text-rose text-xs font-semibold mt-2">{error}</div>}
        {savedMsg && <div className="text-gold-deep text-xs font-semibold mt-2">{savedMsg}</div>}
        <div className="flex justify-end mt-3">
          <button onClick={saveName} disabled={saving} className="btn-primary rounded-lg px-4 py-2 text-sm">
            {saving ? "Saving…" : "Save Name"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="text-[13px] font-bold text-primary mb-3">Change Password</div>
        <div className="grid gap-3">
          <div>
            <label className="text-xs font-bold text-muted uppercase">New Password</label>
            <input
              type="password"
              className="w-full mt-1"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Confirm New Password</label>
            <input
              type="password"
              className="w-full mt-1"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        {pwError && <div className="text-rose text-xs font-semibold mt-2">{pwError}</div>}
        {pwMsg && <div className="text-gold-deep text-xs font-semibold mt-2">{pwMsg}</div>}
        <div className="flex justify-end mt-3">
          <button onClick={changePassword} disabled={pwSaving} className="btn-primary rounded-lg px-4 py-2 text-sm">
            {pwSaving ? "Updating…" : "Update Password"}
          </button>
        </div>
      </div>
    </div>
  );
}
