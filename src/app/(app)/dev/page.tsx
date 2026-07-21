"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, DEVELOPER_ROLES, type Profile } from "@/types";

type IssueRow = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "resolved";
  related_profile_id: string | null;
  created_by: string | null;
  created_at: string;
  resolved_at: string | null;
};

export default function DeveloperConsolePage() {
  const supabase = createClient();
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [bookingCounts, setBookingCounts] = useState<Record<string, number>>({});
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [relatedProfileId, setRelatedProfileId] = useState("");
  const [saving, setSaving] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: me }, { data: allStaff }, { data: bookings }, { data: issueRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("profiles").select("*").order("created_at", { ascending: true }),
      supabase.from("bookings").select("created_by"),
      supabase.from("system_issues").select("*").order("created_at", { ascending: false }),
    ]);

    setMyProfile(me);
    setStaff(allStaff || []);
    setIssues(issueRows || []);

    const counts: Record<string, number> = {};
    (bookings || []).forEach((b: { created_by: string | null }) => {
      if (!b.created_by) return;
      counts[b.created_by] = (counts[b.created_by] || 0) + 1;
    });
    setBookingCounts(counts);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createIssue() {
    if (!title.trim()) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("system_issues").insert({
      title: title.trim(),
      description: description.trim() || null,
      related_profile_id: relatedProfileId || null,
      created_by: user?.id,
    });
    setTitle("");
    setDescription("");
    setRelatedProfileId("");
    setSaving(false);
    load();
  }

  async function toggleResolved(issue: IssueRow) {
    const nextStatus = issue.status === "open" ? "resolved" : "open";
    await supabase
      .from("system_issues")
      .update({ status: nextStatus, resolved_at: nextStatus === "resolved" ? new Date().toISOString() : null })
      .eq("id", issue.id);
    load();
  }

  async function deleteIssue(id: string) {
    await supabase.from("system_issues").delete().eq("id", id);
    load();
  }

  if (loading) return <div className="text-muted text-sm">Loading…</div>;

  const isDeveloper = myProfile ? DEVELOPER_ROLES.includes(myProfile.role) : false;

  if (!isDeveloper) {
    return (
      <div className="card max-w-md">
        <div className="text-[14.5px] font-bold text-primary mb-2">Restricted</div>
        <div className="text-sm text-muted">
          The Developer Console is a separate area for system oversight — it's only available to the
          Developer account.
        </div>
      </div>
    );
  }

  const openIssues = issues.filter((i) => i.status === "open");
  const resolvedIssues = issues.filter((i) => i.status === "resolved");
  const visibleIssues = showResolved ? issues : openIssues;

  return (
    <div>
      <div className="text-xl font-bold font-serif text-primary mb-1">Developer Console</div>
      <div className="text-xs text-muted mb-5">
        Staff performance overview and an issue log — bookings and ledger stay out of scope here on purpose.
      </div>

      <div className="card mb-5">
        <div className="text-[13px] font-bold text-primary mb-3">Staff Overview</div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
                <th className="py-2 px-2">Name</th>
                <th className="py-2 px-2">Role</th>
                <th className="py-2 px-2">Ledger Access</th>
                <th className="py-2 px-2">Bookings Created</th>
                <th className="py-2 px-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="py-2.5 px-2 font-semibold">
                    {p.full_name}
                    {p.username && <div className="text-[11px] text-muted font-normal">@{p.username}</div>}
                  </td>
                  <td className="py-2.5 px-2">{ROLE_LABELS[p.role]}</td>
                  <td className="py-2.5 px-2 text-[12px]">
                    {["owner", "admin", "manager"].includes(p.role)
                      ? "Automatic"
                      : p.can_view_ledger
                      ? "Enabled"
                      : "—"}
                  </td>
                  <td className="py-2.5 px-2">{bookingCounts[p.id] || 0}</td>
                  <td className="py-2.5 px-2 text-muted text-[12px]">
                    {p.created_at
                      ? new Date(p.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-muted mt-3">
          Ledger entry counts aren't shown here since ledger data itself stays restricted to Owner/Admin/Manager
          at the database level — this table only reflects what's safe to see without touching that data.
        </div>
      </div>

      <div className="card mb-5">
        <div className="text-[13px] font-bold text-primary mb-3">Log a New Issue</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-muted uppercase">Title</label>
            <input className="w-full mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PDF button not responding for Ledger page" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-muted uppercase">Description</label>
            <textarea className="w-full mt-1" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Related Staff Member (optional)</label>
            <select className="w-full mt-1" value={relatedProfileId} onChange={(e) => setRelatedProfileId(e.target.value)}>
              <option value="">— None —</option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({ROLE_LABELS[p.role]})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={createIssue} disabled={saving || !title.trim()} className="btn-primary rounded-lg px-4 py-2 text-sm">
            {saving ? "Saving…" : "Log Issue"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-[13px] font-bold text-primary">
            Issues {showResolved ? `(${issues.length})` : `— Open (${openIssues.length})`}
          </div>
          <button onClick={() => setShowResolved((s) => !s)} className="text-xs font-bold text-gold-deep hover:underline">
            {showResolved ? "Show open only" : `Show resolved too (${resolvedIssues.length})`}
          </button>
        </div>
        {visibleIssues.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">Nothing here — all clear.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {visibleIssues.map((issue) => {
              const relatedProfile = staff.find((s) => s.id === issue.related_profile_id);
              return (
                <div key={issue.id} className="border border-border rounded-lg p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-primary flex items-center gap-2">
                        {issue.title}
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            issue.status === "open" ? "bg-rose-light text-rose" : "bg-emerald-light text-emerald"
                          }`}
                        >
                          {issue.status === "open" ? "Open" : "Resolved"}
                        </span>
                      </div>
                      {issue.description && <div className="text-[12.5px] text-muted mt-1">{issue.description}</div>}
                      <div className="text-[11px] text-muted mt-1.5">
                        {relatedProfile && <>Related to {relatedProfile.full_name} · </>}
                        Logged {new Date(issue.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => toggleResolved(issue)}
                        className="text-[11px] font-semibold text-gold-deep border border-gold/40 rounded-lg px-2.5 py-1 hover:bg-gold-light whitespace-nowrap"
                      >
                        {issue.status === "open" ? "Mark Resolved" : "Reopen"}
                      </button>
                      <button
                        onClick={() => deleteIssue(issue.id)}
                        className="text-[11px] font-semibold text-rose border border-rose/30 rounded-lg px-2.5 py-1 hover:bg-rose-light"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
