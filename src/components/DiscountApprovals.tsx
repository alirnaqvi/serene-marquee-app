"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY, fmtDMYTime } from "@/lib/dateFormat";
import { useSession } from "@/components/SessionContext";
import { ROLE_LABELS, type DiscountApproval } from "@/types";

/**
 * Discount approval inbox, shown at the top of the dashboard.
 *
 * Renders nothing at all unless there is something for this person to act on
 * or hear about, so it never becomes furniture people learn to scroll past.
 *
 * Requests are addressed to every role above the requester, and the first of
 * those people to act on it decides it — so a Manager's request appears for
 * both the General Manager and the Admin. RLS decides who sees what; this
 * component only has to render what comes back.
 */
export default function DiscountApprovals() {
  const supabase = createClient();
  const { readOnly } = useSession();

  const [incoming, setIncoming] = useState<DiscountApproval[]>([]);
  const [mine, setMine] = useState<DiscountApproval[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    // RLS returns own requests plus any addressed to this role, so a single
    // query covers both sides and they're split apart here.
    const { data, error: err } = await supabase
      .from("discount_approvals")
      .select("*")
      .order("created_at", { ascending: false });
    if (err) return;

    const rows = (data as DiscountApproval[]) || [];
    setIncoming(rows.filter((r) => r.status === "pending" && r.requested_by !== user.id));
    setMine(
      rows.filter(
        (r) => r.requested_by === user.id && r.status !== "pending" && !r.consumed_booking_id
      )
    );

    const ids = Array.from(new Set(rows.map((r) => r.requested_by)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => (map[p.id] = p.full_name));
      setNames(map);
    }
  }, [supabase]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("dashboard-discount-approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "discount_approvals" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(req: DiscountApproval, status: "approved" | "rejected") {
    if (readOnly) return;
    setBusyId(req.id);
    setError(null);
    const { error: err } = await supabase
      .from("discount_approvals")
      .update({
        status,
        approved_amount: status === "approved" ? req.requested_amount : null,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        decision_note: note.trim() || null,
      })
      .eq("id", req.id)
      .eq("status", "pending"); // whoever gets there first wins; a second click is a no-op
    if (err) setError(err.message);
    setNote("");
    setNoteFor(null);
    setBusyId(null);
    load();
  }

  async function dismissMine(id: string) {
    await supabase.from("discount_approvals").delete().eq("id", id);
    load();
  }

  if (incoming.length === 0 && mine.length === 0) return null;

  return (
    <div className="mb-5 flex flex-col gap-3">
      {/* ---- Requests waiting on me ---- */}
      {incoming.length > 0 && (
        <div className="rounded-xl2 border-2 border-gold bg-gold-light shadow-card overflow-hidden">
          <div className="px-4 sm:px-5 py-3 bg-gradient-to-r from-[#D3AF52] to-[#B8912E] flex items-center gap-2.5">
            <ShieldAlert size={17} strokeWidth={2.4} className="text-[#17140F] shrink-0" />
            <div className="text-[13.5px] font-bold text-[#17140F]">
              {incoming.length} discount {incoming.length === 1 ? "request needs" : "requests need"} your
              decision
            </div>
          </div>

          <div className="divide-y divide-gold/25">
            {incoming.map((req) => (
              <div key={req.id} className="px-4 sm:px-5 py-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[15px] font-bold font-serif text-gold-deep">
                      {money(req.requested_amount)} discount
                      <span className="text-[12px] font-sans font-semibold text-[#8A6427] ml-2">
                        Rs. {(req.requested_amount - req.requester_limit).toLocaleString("en-PK")} over their
                        limit
                      </span>
                    </div>
                    <div className="text-[12.5px] text-[#6B5320] mt-1">
                      Requested by <b>{names[req.requested_by] || "a staff member"}</b> (
                      {ROLE_LABELS[req.requester_role]})
                      {req.client_name && (
                        <>
                          {" "}
                          for <b>{req.client_name}</b>
                        </>
                      )}
                      {req.event_date && <> · {fmtDMY(req.event_date)}</>}
                    </div>
                    {req.reason && (
                      <div className="text-[12.5px] text-[#6B5320] mt-1.5 italic">“{req.reason}”</div>
                    )}
                    <div className="text-[10.5px] text-[#8A7A47] mt-1.5">
                      {fmtDMYTime(new Date(req.created_at))} · their limit is{" "}
                      {money(req.requester_limit)}
                    </div>
                  </div>

                  {!readOnly && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setNoteFor(noteFor === req.id ? null : req.id)}
                        className="text-[11.5px] font-semibold text-gold-deep border border-gold/50 rounded-lg px-3 py-1.5 hover:bg-white/40"
                      >
                        Add note
                      </button>
                      <button
                        onClick={() => decide(req, "rejected")}
                        disabled={busyId === req.id}
                        className="text-[11.5px] font-semibold text-rose bg-white border border-rose/40 rounded-lg px-3 py-1.5 hover:bg-rose-light disabled:opacity-40"
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => decide(req, "approved")}
                        disabled={busyId === req.id}
                        className="text-[11.5px] font-bold text-[#17140F] bg-white border border-gold rounded-lg px-3 py-1.5 hover:brightness-95 disabled:opacity-40"
                      >
                        {busyId === req.id ? "Saving…" : "Approve"}
                      </button>
                    </div>
                  )}
                </div>

                {noteFor === req.id && (
                  <input
                    className="w-full mt-2.5 text-[12.5px]"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional note the requester will see with your decision…"
                    autoFocus
                  />
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className="px-5 py-2 text-[11.5px] font-semibold text-rose bg-white">{error}</div>
          )}
          {readOnly && (
            <div className="px-5 py-2.5 text-[11.5px] text-[#6B5320] bg-white/50">
              Shown for your visibility — decisions are made by the Admin or General Manager.
            </div>
          )}
        </div>
      )}

      {/* ---- Decisions on my own requests ---- */}
      {mine.map((req) => {
        const approved = req.status === "approved";
        return (
          <div
            key={req.id}
            className={`rounded-xl2 border px-4 sm:px-5 py-3.5 flex items-start justify-between gap-3 flex-wrap ${
              approved ? "border-gold/40 bg-primary-dim" : "border-rose/30 bg-rose-light"
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <BadgeCheck
                size={17}
                strokeWidth={2.3}
                className={`mt-0.5 shrink-0 ${approved ? "text-gold-deep" : "text-rose"}`}
              />
              <div className="min-w-0">
                <div className={`text-[13px] font-bold ${approved ? "text-gold-deep" : "text-rose"}`}>
                  Your {money(req.requested_amount)} discount request was{" "}
                  {approved ? "approved" : "declined"}
                </div>
                <div className={`text-[12px] mt-0.5 ${approved ? "text-gold-deep/85" : "text-rose/85"}`}>
                  {approved
                    ? "Open the booking, enter the discount and save — it will go through."
                    : "The discount can't be applied at that amount."}
                  {req.client_name && <> · {req.client_name}</>}
                </div>
                {req.decision_note && (
                  <div className={`text-[12px] italic mt-1 ${approved ? "text-gold-deep/85" : "text-rose/85"}`}>
                    “{req.decision_note}”
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => dismissMine(req.id)}
              className="text-[11px] font-semibold text-muted hover:text-primary shrink-0"
            >
              Dismiss
            </button>
          </div>
        );
      })}
    </div>
  );
}
