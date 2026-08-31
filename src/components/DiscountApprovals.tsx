"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY, fmtDMYTime } from "@/lib/dateFormat";
import { useSession } from "@/components/SessionContext";
import { ROLE_LABELS, discountLimitFor, type DiscountApproval } from "@/types";
import Link from "next/link";

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
function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[9.5px] tracking-[0.1em] uppercase text-[#9A8A5C]">{label}</div>
      <div className="text-[12.5px] font-semibold text-[#4E3C10] leading-snug">{value}</div>
    </div>
  );
}

export default function DiscountApprovals() {
  const supabase = createClient();
  const { readOnly, role } = useSession();
  const myCeiling = discountLimitFor(role);

  const [incoming, setIncoming] = useState<DiscountApproval[]>([]);
  const [mine, setMine] = useState<DiscountApproval[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [grantAmount, setGrantAmount] = useState<number | "">("");
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

  /**
   * Approve the full amount, approve a lower one, or decline.
   * `amount` is only used when approving — pass nothing for the full figure.
   */
  async function decide(
    req: DiscountApproval,
    status: "approved" | "rejected",
    amount?: number
  ) {
    if (readOnly) return;
    const granted = status === "approved" ? amount ?? req.requested_amount : null;

    if (status === "approved") {
      if (!granted || granted <= 0) {
        setError("Enter an amount above zero, or decline the request instead.");
        return;
      }
      if (granted > req.requested_amount) {
        setError(`You can't grant more than the Rs. ${req.requested_amount.toLocaleString("en-PK")} requested.`);
        return;
      }
      if (myCeiling !== Infinity && granted > myCeiling) {
        setError(
          `Rs. ${granted.toLocaleString("en-PK")} is above your own limit of Rs. ${myCeiling.toLocaleString("en-PK")}. Pass this up to the Admin.`
        );
        return;
      }
    }

    setBusyId(req.id);
    setError(null);
    const { error: err } = await supabase
      .from("discount_approvals")
      .update({
        status,
        approved_amount: granted,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        decision_note: note.trim() || null,
      })
      .eq("id", req.id)
      .eq("status", "pending"); // whoever gets there first wins; a second click is a no-op
    if (err) setError(err.message);
    setNote("");
    setGrantAmount("");
    setOpenFor(null);
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
                  <div className="min-w-0 flex-1">
                    {/* The order number is what the discount is being granted
                        against, so it leads. */}
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[15px] font-bold font-serif text-gold-deep">
                        {money(req.requested_amount)} discount
                      </span>
                      {req.booking_number && (
                        <Link
                          href={`/bookings/${req.booking_id}`}
                          className="text-[12px] font-bold text-[#6B5320] underline decoration-gold/50 hover:decoration-gold"
                        >
                          SM-{String(req.booking_number).padStart(6, "0")}
                        </Link>
                      )}
                      <span className="text-[11.5px] font-semibold text-[#8A6427]">
                        Rs. {(req.requested_amount - req.requester_limit).toLocaleString("en-PK")} over their
                        limit of {money(req.requester_limit)}
                      </span>
                    </div>

                    <div className="text-[12.5px] text-[#6B5320] mt-1">
                      Requested by <b>{names[req.requested_by] || "a staff member"}</b> (
                      {ROLE_LABELS[req.requester_role]})
                    </div>

                    {/* Booking details, so a decision can be made from here. */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-2.5 bg-white/50 rounded-lg px-3 py-2.5">
                      <Detail label="Client" value={req.client_name} />
                      <Detail
                        label="Date & sitting"
                        value={
                          req.event_date
                            ? `${fmtDMY(req.event_date)}${req.session ? ` · ${req.session}` : ""}`
                            : null
                        }
                      />
                      <Detail label="Venue" value={req.venue_label} />
                      <Detail label="Function" value={req.function_label} />
                      <Detail label="Guests" value={req.guests ? String(req.guests) : null} />
                      <Detail label="Menu" value={req.menu_label} />
                      <Detail
                        label="Booking total"
                        value={req.booking_total ? money(req.booking_total) : null}
                      />
                      <Detail
                        label="Discount now"
                        value={req.current_discount != null ? money(req.current_discount) : null}
                      />
                      <Detail
                        label="Total if approved"
                        value={
                          req.booking_total != null
                            ? money(
                                Math.max(
                                  0,
                                  req.booking_total + (req.current_discount ?? 0) - req.requested_amount
                                )
                              )
                            : null
                        }
                      />
                    </div>

                    {req.reason && (
                      <div className="text-[12.5px] text-[#6B5320] mt-2 italic">“{req.reason}”</div>
                    )}
                    <div className="text-[10.5px] text-[#8A7A47] mt-1.5">
                      {fmtDMYTime(new Date(req.created_at))}
                    </div>
                  </div>

                  {!readOnly && (
                    <div className="flex gap-2 shrink-0 flex-wrap">
                      <button
                        onClick={() => {
                          const opening = openFor !== req.id;
                          setOpenFor(opening ? req.id : null);
                          setGrantAmount(opening ? req.requested_amount : "");
                          setNote("");
                        }}
                        className="text-[11.5px] font-semibold text-gold-deep border border-gold/50 rounded-lg px-3 py-1.5 hover:bg-white/40"
                      >
                        Approve less
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
                        {busyId === req.id ? "Saving…" : `Approve ${money(req.requested_amount)}`}
                      </button>
                    </div>
                  )}
                </div>

                {/* Counter-offer: grant less than was asked for. */}
                {openFor === req.id && !readOnly && (
                  <div className="mt-3 bg-white rounded-lg border border-gold/40 px-3 py-3">
                    <div className="text-[11.5px] font-bold text-primary mb-0.5">
                      Too much? Approve a smaller discount instead
                    </div>
                    <div className="text-[11px] text-muted mb-2">
                      They asked for {money(req.requested_amount)}. Enter what you're willing to allow — they
                      can apply that figure or less, and nothing above it.
                    </div>
                    <div className="flex gap-2 flex-wrap items-end">
                      <div>
                        <label className="text-[10px] font-bold text-muted uppercase">Amount to approve</label>
                        <input
                          type="number"
                          className="w-40 mt-1 text-[13px]"
                          value={grantAmount}
                          onChange={(e) =>
                            setGrantAmount(e.target.value === "" ? "" : Number(e.target.value))
                          }
                          autoFocus
                        />
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <label className="text-[10px] font-bold text-muted uppercase">
                          Note to the requester
                        </label>
                        <input
                          className="w-full mt-1 text-[13px]"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="e.g. 120k is the most we can do on this menu"
                        />
                      </div>
                      <button
                        onClick={() => decide(req, "approved", Number(grantAmount) || 0)}
                        disabled={busyId === req.id}
                        className="btn-primary rounded-lg px-4 py-2 text-[12px] disabled:opacity-40 whitespace-nowrap"
                      >
                        Approve {money(Number(grantAmount) || 0)}
                      </button>
                    </div>

                    {/* One-tap common counter-offers, capped by the approver's
                        own ceiling so nothing unusable is offered. */}
                    <div className="flex gap-1.5 flex-wrap mt-2">
                      {[0.75, 0.5, 0.25]
                        .map((f) => Math.round((req.requested_amount * f) / 5000) * 5000)
                        .filter(
                          (v, i, arr) =>
                            v > 0 &&
                            arr.indexOf(v) === i &&
                            (myCeiling === Infinity || v <= myCeiling)
                        )
                        .map((v) => (
                          <button
                            key={v}
                            onClick={() => setGrantAmount(v)}
                            className="text-[11px] font-semibold text-gold-deep border border-gold/40 rounded-md px-2.5 py-1 hover:bg-gold-light"
                          >
                            {money(v)}
                          </button>
                        ))}
                      {myCeiling !== Infinity && req.requested_amount > myCeiling && (
                        <button
                          onClick={() => setGrantAmount(myCeiling)}
                          className="text-[11px] font-semibold text-gold-deep border border-gold/40 rounded-md px-2.5 py-1 hover:bg-gold-light"
                        >
                          {money(myCeiling)} (your max)
                        </button>
                      )}
                    </div>
                    <div className="text-[10.5px] text-muted mt-2">
                      Must be between Rs. 1 and the {money(req.requested_amount)} requested
                      {myCeiling !== Infinity && <>, and within your own {money(myCeiling)} limit</>}. The
                      requester will be told the approved figure and can apply that or less.
                    </div>
                  </div>
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
                  {approved
                    ? (req.approved_amount ?? req.requested_amount) < req.requested_amount
                      ? `Your ${money(req.requested_amount)} request was approved at ${money(
                          req.approved_amount ?? 0
                        )}`
                      : `Your ${money(req.requested_amount)} discount request was approved`
                    : `Your ${money(req.requested_amount)} discount request was declined`}
                  {req.booking_number && ` · SM-${String(req.booking_number).padStart(6, "0")}`}
                </div>
                <div className={`text-[12px] mt-0.5 ${approved ? "text-gold-deep/85" : "text-rose/85"}`}>
                  {approved
                    ? `Open the booking, set the discount to ${money(
                        req.approved_amount ?? req.requested_amount
                      )} or less, and save.`
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
