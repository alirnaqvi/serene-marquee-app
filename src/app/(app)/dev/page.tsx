"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtDMYTime } from "@/lib/dateFormat";
import {
  ROLE_LABELS,
  DEVELOPER_ROLES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  discountLimitLabel,
  isReadOnlyRole,
  type Profile,
  type SupportTicket,
  type TicketComment,
  type TicketStatus,
} from "@/types";

const statusStyles: Record<TicketStatus, string> = {
  open: "bg-rose-light text-rose",
  in_progress: "bg-gold-light text-[#8A6427]",
  resolved: "bg-primary-dim text-gold-deep",
};
const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export default function DeveloperConsolePage() {
  const supabase = createClient();
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [bookingCounts, setBookingCounts] = useState<Record<string, number>>({});
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<"active" | "all" | TicketStatus>("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");

  // Developer can still log an issue of their own
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [relatedProfileId, setRelatedProfileId] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: me }, { data: allStaff }, { data: bookings }, { data: issueRows }, { data: cs }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase.from("profiles").select("*").order("created_at", { ascending: true }),
        supabase.from("bookings").select("created_by"),
        supabase.from("system_issues").select("*").order("created_at", { ascending: false }),
        supabase.from("system_issue_comments").select("*").order("created_at"),
      ]);

    setMyProfile(me);
    setStaff(allStaff || []);
    setTickets((issueRows as SupportTicket[]) || []);
    setComments((cs as TicketComment[]) || []);

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

  const nameOf = (id: string | null) => (id ? staff.find((s) => s.id === id)?.full_name || "—" : "—");

  const visibleTickets = useMemo(() => {
    const list =
      filter === "all"
        ? tickets
        : filter === "active"
        ? tickets.filter((t) => t.status !== "resolved")
        : tickets.filter((t) => t.status === filter);
    return [...list].sort(
      (a, b) =>
        (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) ||
        b.created_at.localeCompare(a.created_at)
    );
  }, [tickets, filter]);

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

  async function setStatus(ticket: SupportTicket, status: TicketStatus) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase
      .from("system_issues")
      .update({
        status,
        resolved_at: status === "resolved" ? new Date().toISOString() : null,
        resolved_by: status === "resolved" ? user?.id : null,
        resolution_note:
          status === "resolved" && resolutionNote.trim() ? resolutionNote.trim() : ticket.resolution_note,
      })
      .eq("id", ticket.id);
    setResolutionNote("");
    load();
  }

  async function setPriority(ticket: SupportTicket, priority: string) {
    await supabase.from("system_issues").update({ priority }).eq("id", ticket.id);
    load();
  }

  async function sendReply(ticketId: string) {
    if (!reply.trim()) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("system_issue_comments").insert({
      issue_id: ticketId,
      body: reply.trim(),
      created_by: user?.id,
    });
    setReply("");
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
          The Developer Console is a separate area for system oversight — it's only available to the Developer
          account. To report a problem, use the Help &amp; Support page instead.
        </div>
      </div>
    );
  }

  const counts = {
    open: tickets.filter((t) => t.status === "open").length,
    in_progress: tickets.filter((t) => t.status === "in_progress").length,
    resolved: tickets.filter((t) => t.status === "resolved").length,
    urgent: tickets.filter((t) => t.status !== "resolved" && t.priority === "urgent").length,
  };

  return (
    <div>
      <div className="text-xl font-bold font-serif text-primary mb-1">Developer Console</div>
      <div className="text-xs text-muted mb-5">
        The support queue every employee files into, plus a staff overview. Bookings and ledger stay out of
        scope here on purpose.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Open</div>
          <div className="text-2xl font-bold font-serif text-rose mt-1.5">{counts.open}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">In Progress</div>
          <div className="text-2xl font-bold font-serif mt-1.5">{counts.in_progress}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Resolved</div>
          <div className="text-2xl font-bold font-serif text-gold-deep mt-1.5">{counts.resolved}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Urgent Waiting</div>
          <div className="text-2xl font-bold font-serif text-rose mt-1.5">{counts.urgent}</div>
        </div>
      </div>

      {/* ---------------------------- TICKET QUEUE ---------------------------- */}
      <div className="card mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-[13px] font-bold text-primary">Support Queue ({visibleTickets.length})</div>
          <select className="text-xs py-1" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
            <option value="active">Open + In Progress</option>
            <option value="open">Open only</option>
            <option value="in_progress">In Progress only</option>
            <option value="resolved">Resolved only</option>
            <option value="all">Everything</option>
          </select>
        </div>

        {visibleTickets.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">Nothing here — all clear.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {visibleTickets.map((ticket) => {
              const thread = comments.filter((c) => c.issue_id === ticket.id);
              const expanded = openId === ticket.id;
              return (
                <div key={ticket.id} className="border border-border rounded-lg p-3.5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-primary flex items-center gap-2 flex-wrap">
                        {ticket.title}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusStyles[ticket.status]}`}>
                          {TICKET_STATUS_LABELS[ticket.status]}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            ticket.priority === "urgent" || ticket.priority === "high"
                              ? "bg-rose-light text-rose"
                              : "bg-bg border border-border text-muted"
                          }`}
                        >
                          {TICKET_PRIORITY_LABELS[ticket.priority]}
                        </span>
                      </div>
                      {ticket.description && (
                        <div className="text-[12.5px] text-muted mt-1 whitespace-pre-wrap">{ticket.description}</div>
                      )}
                      <div className="text-[11px] text-muted mt-1.5">
                        Reported by <b className="text-primary font-semibold">{nameOf(ticket.created_by)}</b>
                        {ticket.category && <> · {ticket.category}</>}
                        {ticket.related_profile_id && <> · about {nameOf(ticket.related_profile_id)}</>}
                        {" · "}
                        {fmtDMYTime(new Date(ticket.created_at))}
                        {thread.length > 0 && <> · {thread.length} repl{thread.length === 1 ? "y" : "ies"}</>}
                      </div>
                      {ticket.resolution_note && (
                        <div className="text-[12px] text-gold-deep bg-primary-dim rounded-md px-2.5 py-1.5 mt-2">
                          <b>Resolution:</b> {ticket.resolution_note}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                      <select
                        className="text-[11px] py-1"
                        value={ticket.priority}
                        onChange={(e) => setPriority(ticket, e.target.value)}
                        title="Priority"
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                      {ticket.status === "open" && (
                        <button
                          onClick={() => setStatus(ticket, "in_progress")}
                          className="text-[11px] font-semibold text-gold-deep border border-gold/40 rounded-lg px-2.5 py-1 hover:bg-gold-light whitespace-nowrap"
                        >
                          Start
                        </button>
                      )}
                      {ticket.status !== "resolved" ? (
                        <button
                          onClick={() => setStatus(ticket, "resolved")}
                          className="text-[11px] font-semibold text-gold-deep border border-gold/40 rounded-lg px-2.5 py-1 hover:bg-gold-light whitespace-nowrap"
                        >
                          Mark Resolved
                        </button>
                      ) : (
                        <button
                          onClick={() => setStatus(ticket, "open")}
                          className="text-[11px] font-semibold text-gold-deep border border-gold/40 rounded-lg px-2.5 py-1 hover:bg-gold-light whitespace-nowrap"
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        onClick={() => setOpenId(expanded ? null : ticket.id)}
                        className="btn-ghost rounded-lg px-2.5 py-1 text-[11px]"
                      >
                        {expanded ? "Hide" : "Reply"}
                      </button>
                      <button
                        onClick={() => deleteIssue(ticket.id)}
                        className="text-[11px] font-semibold text-rose border border-rose/30 rounded-lg px-2.5 py-1 hover:bg-rose-light"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-3 pt-3 border-t border-dashed border-border">
                      {thread.map((c) => (
                        <div key={c.id} className="text-[12.5px] mb-2">
                          <div className="text-muted text-[10.5px]">
                            {nameOf(c.created_by)} · {fmtDMYTime(new Date(c.created_at))}
                          </div>
                          <div className="whitespace-pre-wrap">{c.body}</div>
                        </div>
                      ))}
                      <div className="flex gap-2 mt-2">
                        <input
                          className="flex-1"
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          placeholder="Reply to the reporter…"
                          onKeyDown={(e) => e.key === "Enter" && sendReply(ticket.id)}
                        />
                        <button onClick={() => sendReply(ticket.id)} className="btn-ghost rounded-lg px-3 py-2 text-xs">
                          Send
                        </button>
                      </div>
                      {ticket.status !== "resolved" && (
                        <div className="flex gap-2 mt-2">
                          <input
                            className="flex-1"
                            value={resolutionNote}
                            onChange={(e) => setResolutionNote(e.target.value)}
                            placeholder="Resolution note (shown to the reporter when you close it)…"
                          />
                          <button
                            onClick={() => setStatus(ticket, "resolved")}
                            className="btn-primary rounded-lg px-3 py-2 text-xs whitespace-nowrap"
                          >
                            Close Ticket
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------------------- STAFF OVERVIEW ---------------------------- */}
      <div className="card mb-5">
        <div className="text-[13px] font-bold text-primary mb-3">Staff Overview</div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[680px] text-[13px]">
            <thead>
              <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
                <th className="py-2 px-2">Name</th>
                <th className="py-2 px-2">Role</th>
                <th className="py-2 px-2">Ledger Access</th>
                <th className="py-2 px-2">Discount Limit</th>
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
                  <td className="py-2.5 px-2">
                    {ROLE_LABELS[p.role]}
                    {isReadOnlyRole(p.role) && (
                      <div className="text-[10.5px] text-muted font-normal">monitor only</div>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-[12px]">
                    {["owner", "admin", "manager"].includes(p.role)
                      ? "Automatic"
                      : p.can_view_ledger
                      ? "Enabled"
                      : "—"}
                  </td>
                  <td className="py-2.5 px-2 text-[12px]">{discountLimitLabel(p.role)}</td>
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

      {/* ---------------------------- LOG AN ISSUE ---------------------------- */}
      <div className="card">
        <div className="text-[13px] font-bold text-primary mb-3">Log an Issue Yourself</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-muted uppercase">Title</label>
            <input
              className="w-full mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. PDF button not responding for Ledger page"
            />
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
    </div>
  );
}
