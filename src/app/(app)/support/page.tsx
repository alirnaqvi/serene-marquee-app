"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtDMYTime } from "@/lib/dateFormat";
import { useSession } from "@/components/SessionContext";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type SupportTicket,
  type TicketComment,
  type TicketPriority,
} from "@/types";

const statusStyles: Record<string, string> = {
  open: "bg-rose-light text-rose",
  in_progress: "bg-gold-light text-[#8A6427]",
  resolved: "bg-primary-dim text-gold-deep",
};

/**
 * Help & Support — every employee can raise a ticket here and follow it
 * through to resolution. The Developer works the queue from the Developer
 * Console; this page is the reporting side of the same system.
 */
export default function SupportPage() {
  const supabase = createClient();
  const { fullName, isDeveloper } = useSession();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(TICKET_CATEGORIES[0]);
  const [priority, setPriority] = useState<TicketPriority>("normal");

  async function load() {
    // RLS returns only this user's own tickets (or everything, for the
    // Developer) — no client-side filtering needed.
    const [{ data: rows }, { data: cs }] = await Promise.all([
      supabase.from("system_issues").select("*").order("created_at", { ascending: false }),
      supabase.from("system_issue_comments").select("*").order("created_at"),
    ]);
    setTickets((rows as SupportTicket[]) || []);
    setComments((cs as TicketComment[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!title.trim()) return setError("Please give the issue a short title.");
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("system_issues").insert({
      title: title.trim(),
      description: description.trim() || null,
      category,
      priority,
      created_by: user?.id,
    });
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    setTitle("");
    setDescription("");
    setCategory(TICKET_CATEGORIES[0]);
    setPriority("normal");
    setSaving(false);
    setShowForm(false);
    setSent(true);
    setTimeout(() => setSent(false), 5000);
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

  if (loading) return <div className="text-muted text-sm">Loading…</div>;

  const openCount = tickets.filter((t) => t.status !== "resolved").length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Help & Support</div>
          <div className="text-xs text-muted mt-0.5">
            Something not working? Report it here and the developer will pick it up.
          </div>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className="btn-primary rounded-lg px-4 py-2 text-sm">
          {showForm ? "Close" : "+ Report an Issue"}
        </button>
      </div>

      {sent && (
        <div className="bg-primary-dim text-gold-deep rounded-lg px-3.5 py-2.5 text-[12.5px] font-semibold my-4">
          Thanks {fullName.split(" ")[0]} — your issue has been sent to the developer. You'll see updates on this
          page.
        </div>
      )}

      {showForm && (
        <div className="card my-4">
          {error && <div className="text-rose text-sm font-semibold mb-3">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-muted uppercase">What's the problem?</label>
              <input
                className="w-full mt-1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Agreement PDF button does nothing"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-muted uppercase">Details</label>
              <textarea
                className="w-full mt-1"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What were you doing when it happened? Which booking or screen? Any error message?"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted uppercase">Type</label>
              <select className="w-full mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-muted uppercase">How urgent?</label>
              <select
                className="w-full mt-1"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
              >
                <option value="low">Low — can wait</option>
                <option value="normal">Normal</option>
                <option value="high">High — slowing down work</option>
                <option value="urgent">Urgent — can't work at all</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={submit} disabled={saving || !title.trim()} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50">
              {saving ? "Sending…" : "Send to Developer"}
            </button>
          </div>
        </div>
      )}

      <div className="card mt-4">
        <div className="text-[13px] font-bold text-primary mb-3">
          {isDeveloper ? "All Tickets" : "My Tickets"} — {openCount} open of {tickets.length}
        </div>

        {tickets.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm">
            You haven't reported anything yet. If something looks wrong, tell us — it's never a bother.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {tickets.map((ticket) => {
              const thread = comments.filter((c) => c.issue_id === ticket.id);
              const expanded = openId === ticket.id;
              return (
                <div key={ticket.id} className="border border-border rounded-lg p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-primary flex items-center gap-2 flex-wrap">
                        {ticket.title}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusStyles[ticket.status]}`}>
                          {TICKET_STATUS_LABELS[ticket.status]}
                        </span>
                        {ticket.priority !== "normal" && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-bg border border-border text-muted">
                            {TICKET_PRIORITY_LABELS[ticket.priority]}
                          </span>
                        )}
                      </div>
                      {ticket.description && (
                        <div className="text-[12.5px] text-muted mt-1 whitespace-pre-wrap">{ticket.description}</div>
                      )}
                      <div className="text-[11px] text-muted mt-1.5">
                        {ticket.category && <>{ticket.category} · </>}
                        Reported {fmtDMYTime(new Date(ticket.created_at))}
                        {thread.length > 0 && <> · {thread.length} repl{thread.length === 1 ? "y" : "ies"}</>}
                      </div>
                      {ticket.resolution_note && (
                        <div className="text-[12px] text-gold-deep bg-primary-dim rounded-md px-2.5 py-1.5 mt-2">
                          <b>Developer:</b> {ticket.resolution_note}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setOpenId(expanded ? null : ticket.id)}
                      className="btn-ghost rounded-md px-2.5 py-1 text-[11px] shrink-0"
                    >
                      {expanded ? "Hide" : "Discuss"}
                    </button>
                  </div>

                  {expanded && (
                    <div className="mt-3 pt-3 border-t border-dashed border-border">
                      {thread.length === 0 && (
                        <div className="text-[11.5px] text-muted mb-2">No replies yet.</div>
                      )}
                      {thread.map((c) => (
                        <div key={c.id} className="text-[12.5px] mb-2">
                          <div className="text-muted text-[10.5px]">{fmtDMYTime(new Date(c.created_at))}</div>
                          <div className="whitespace-pre-wrap">{c.body}</div>
                        </div>
                      ))}
                      <div className="flex gap-2 mt-2">
                        <input
                          className="flex-1"
                          value={reply}
                          onChange={(e) => setReply(e.target.value)}
                          placeholder="Add more detail or answer a question…"
                          onKeyDown={(e) => e.key === "Enter" && sendReply(ticket.id)}
                        />
                        <button onClick={() => sendReply(ticket.id)} className="btn-ghost rounded-lg px-3 py-2 text-xs">
                          Send
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
