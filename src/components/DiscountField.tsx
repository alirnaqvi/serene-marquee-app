"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/SessionContext";
import { ROLE_LABELS, approversFor, type DiscountApproval } from "@/types";

type NumField = number | "";

/** Context snapshotted onto the request so the approver can judge it properly. */
export type DiscountContext = {
  bookingId?: string;
  bookingNumber?: number | null;
  clientName?: string;
  eventDate?: string;
  guests?: number;
  menuLabel?: string;
  venueLabel?: string;
  session?: string;
  functionLabel?: string;
  bookingTotal?: number;
  currentDiscount?: number;
};

/**
 * Discount input with the signed-in role's ceiling built in.
 *
 *   Manager ............ Rs. 100,000 per booking  (currently Zain Syed)
 *   General Manager .... Rs. 200,000 per booking  (currently Ikram Abbasi)
 *   Staff / Owner ...... no discount authority
 *   Admin / Developer .. unlimited
 *
 * Going over the ceiling isn't a dead end: the field sends an approval request
 * up the chain of command, raised against the booking's ORDER NUMBER and
 * carrying its guests, menu, venue and total so the approver can decide
 * without opening anything.
 *
 * The approver may grant less than was asked for. Whatever they grant is the
 * ceiling: Rs. 150,000 approved at Rs. 120,000 lets Rs. 120,000 through and
 * refuses Rs. 121,000.
 *
 * Because the request is tied to a saved booking, this can only be done from
 * an existing booking. On a brand-new booking there is no order number yet, so
 * the field explains to save first.
 */
export default function DiscountField({
  value,
  onChange,
  className = "",
  context,
}: {
  value: NumField;
  onChange: (v: NumField) => void;
  className?: string;
  context?: DiscountContext;
}) {
  const supabase = createClient();
  const { role, discountLimit } = useSession();
  const amount = Number(value) || 0;
  const unlimited = discountLimit === Infinity;
  const noAuthority = discountLimit === 0;
  const overLimit = !unlimited && amount > discountLimit;
  const approvers = approversFor(role);
  const bookingId = context?.bookingId;

  const [requests, setRequests] = useState<DiscountApproval[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const [askAmount, setAskAmount] = useState<NumField>("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("discount_approvals")
      .select("*")
      .eq("requested_by", user.id)
      .is("consumed_booking_id", null)
      .order("created_at", { ascending: false })
      .limit(20);
    setRequests((data as DiscountApproval[]) || []);
  }, [supabase]);

  useEffect(() => {
    if (unlimited) return;
    load();
    const channel = supabase
      .channel(`discount-approvals-${bookingId ?? "new"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "discount_approvals" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [unlimited, bookingId, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // A request belongs to this booking either by its id (saved bookings) or by
  // client name + function date (a booking still being created). This mirrors
  // enforce_discount_limit(), so the field never shows "approved" for a save
  // the database would refuse.
  const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
  const belongsHere = (r: DiscountApproval) => {
    if (r.booking_id) return r.booking_id === bookingId;
    if (r.client_name)
      return (
        norm(r.client_name) === norm(context?.clientName || "") &&
        r.event_date === (context?.eventDate || null)
      );
    return r.event_date === (context?.eventDate || null);
  };
  const mine = requests.filter(belongsHere);

  // Keep the largest approved permit, in case more than one exists.
  const approved = mine
    .filter((r) => r.status === "approved")
    .sort(
      (a, b) =>
        (b.approved_amount ?? b.requested_amount) - (a.approved_amount ?? a.requested_amount)
    )[0];
  const pending = mine.find((r) => r.status === "pending");
  const rejected = mine.find((r) => r.status === "rejected" && !pending && !approved);

  const permitCeiling = approved ? approved.approved_amount ?? approved.requested_amount : 0;

  // The most this person can actually put on this booking right now: their own
  // limit, raised by any approval they're holding.
  const ceiling = unlimited ? Infinity : Math.max(discountLimit, permitCeiling);

  // Everything below keys off the amount TYPED IN, not off what was once
  // requested — asking for 150,000 and then typing 200,000 has to be treated
  // as needing a fresh approval, not as a settled decision.
  const needsApproval = amount > ceiling;
  const usingPermit = !needsApproval && amount > discountLimit;
  const pendingCoversTyped = Boolean(pending && pending.requested_amount >= amount);

  async function sendRequest() {
    const want = Number(askAmount) || amount;
    if (want <= discountLimit) {
      setError(`Rs. ${want.toLocaleString("en-PK")} is within your own limit — no approval needed.`);
      return;
    }
    if (!bookingId && !context?.eventDate) {
      setError("Pick the function date first — the approval is tied to it.");
      return;
    }
    setSending(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Replace any request of ours still waiting on this booking, so an
    // approver never sees two competing figures for the same discount.
    const stale = mine.filter((r) => r.status === "pending").map((r) => r.id);
    if (stale.length) await supabase.from("discount_approvals").delete().in("id", stale);

    const { error: err } = await supabase.from("discount_approvals").insert({
      booking_id: bookingId,
      booking_number: context?.bookingNumber ?? null,
      client_name: context?.clientName?.trim() || null,
      event_date: context?.eventDate || null,
      booking_total: context?.bookingTotal ?? null,
      guests: context?.guests ?? null,
      menu_label: context?.menuLabel || null,
      venue_label: context?.venueLabel || null,
      session: context?.session || null,
      function_label: context?.functionLabel || null,
      current_discount: context?.currentDiscount ?? null,
      requested_amount: want,
      requester_limit: discountLimit,
      reason: reason.trim() || null,
      requested_by: user?.id,
      requester_role: role,
      approver_roles: approvers,
    });
    if (err) {
      setError(err.message);
      setSending(false);
      return;
    }
    setReason("");
    setAskAmount("");
    setShowForm(false);
    setSending(false);
    load();
  }

  async function withdraw(id: string) {
    await supabase.from("discount_approvals").delete().eq("id", id);
    load();
  }

  const ref = context?.bookingNumber ? `SM-${String(context.bookingNumber).padStart(6, "0")}` : null;

  return (
    <div className={className}>
      <label className="text-xs font-bold text-muted uppercase">Discount (Rs.)</label>
      <input
        type="number"
        min={0}
        className={`w-full mt-1 ${needsApproval ? "border-rose" : ""}`}
        value={noAuthority && approvers.length === 0 ? "" : value}
        disabled={noAuthority && approvers.length === 0}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />

      {/* ---- within your own limit ---- */}
      {!needsApproval && !usingPermit && (
        <div className="text-[11px] text-muted mt-1">
          Your limit: {unlimited ? "no limit" : `Rs. ${discountLimit.toLocaleString("en-PK")} per booking`}
        </div>
      )}

      {/* ---- above your limit, but covered by an approval you hold ---- */}
      {usingPermit && (
        <div className="text-[11px] text-gold-deep font-semibold mt-1.5 bg-primary-dim rounded-md px-2.5 py-1.5">
          Approved up to Rs. {permitCeiling.toLocaleString("en-PK")}
          {ref && ` on ${ref}`} — you can save this booking.
          {approved?.decision_note && <div className="font-normal mt-0.5">“{approved.decision_note}”</div>}
        </div>
      )}

      {/* ---- needs an approval for the amount currently typed ---- */}
      {needsApproval && (
        <div className="mt-1.5">
          <div className="text-[11px] text-rose font-semibold">
            Rs. {amount.toLocaleString("en-PK")} is above what you can give
            {permitCeiling > 0
              ? ` (approved up to Rs. ${permitCeiling.toLocaleString("en-PK")})`
              : ` — ${ROLE_LABELS[role]} may approve up to Rs. ${discountLimit.toLocaleString("en-PK")}`}
            .
          </div>

          {/* An approval already in hand, for less than what's typed. Offer to
              drop to it, or to ask for the larger figure. */}
          {permitCeiling > 0 && (
            <div className="text-[11px] mt-1.5 bg-gold-light border border-gold/40 rounded-md px-2.5 py-1.5">
              <div className="font-bold text-gold-deep">
                You're approved for Rs. {permitCeiling.toLocaleString("en-PK")} on this booking.
              </div>
              {approved?.decision_note && (
                <div className="text-[#6B5320] mt-0.5">“{approved.decision_note}”</div>
              )}
              <button
                onClick={() => onChange(permitCeiling)}
                className="btn-primary rounded-md px-3 py-1 text-[11px] mt-1.5"
              >
                Use Rs. {permitCeiling.toLocaleString("en-PK")} instead
              </button>
            </div>
          )}

          {rejected && (
            <div className="text-[11px] text-rose mt-1.5 bg-rose-light rounded-md px-2.5 py-1.5">
              <span className="font-semibold">
                A request for Rs. {rejected.requested_amount.toLocaleString("en-PK")} was declined.
              </span>
              {rejected.decision_note && <div className="mt-0.5">“{rejected.decision_note}”</div>}
            </div>
          )}

          {/* A request already out that would cover this amount. */}
          {pendingCoversTyped && pending && (
            <div className="text-[11px] mt-1.5 bg-gold-light border border-gold/30 rounded-md px-2.5 py-1.5">
              <div className="font-semibold text-gold-deep">
                Waiting on approval for Rs. {pending.requested_amount.toLocaleString("en-PK")}
                {ref && ` on ${ref}`}
              </div>
              <div className="text-muted mt-0.5">
                Sent to {pending.approver_roles.map((r) => ROLE_LABELS[r]).join(" and ")}. They can approve
                that or a lower figure.
              </div>
              <button
                onClick={() => withdraw(pending.id)}
                className="text-rose font-semibold hover:underline mt-1"
              >
                Withdraw request
              </button>
            </div>
          )}

          {/* A request is out, but for LESS than what's now typed. */}
          {pending && !pendingCoversTyped && (
            <div className="text-[11px] text-muted mt-1.5">
              A request for Rs. {pending.requested_amount.toLocaleString("en-PK")} is already pending.
              Requesting Rs. {amount.toLocaleString("en-PK")} will replace it.
            </div>
          )}

          {approvers.length === 0 ? (
            <div className="text-[11px] text-muted mt-1">
              {ROLE_LABELS[role]} accounts can't apply a discount or request one.
            </div>
          ) : !showForm ? (
            <button
              onClick={() => {
                setAskAmount(amount);
                setShowForm(true);
              }}
              className="btn-ghost rounded-lg px-3 py-1.5 text-[11.5px] mt-2"
            >
              Request Rs. {amount.toLocaleString("en-PK")} from{" "}
              {approvers.map((r) => ROLE_LABELS[r]).join(" or ")}
            </button>
          ) : (
            <div className="border border-border rounded-lg p-2.5 mt-2 bg-bg">
              <div className="text-[11px] font-semibold text-primary mb-1.5">
                Request approval for Rs. {(Number(askAmount) || 0).toLocaleString("en-PK")}
                {ref ? ` on ${ref}` : ""}
              </div>
              {!ref && (
                <div className="text-[10.5px] text-muted mb-1.5">
                  This booking has no order number yet, so the approval will be tied to
                  {context?.clientName ? <b> {context.clientName}</b> : " this client"} on{" "}
                  <b>{context?.eventDate || "this date"}</b>. It applies to that booking only.
                </div>
              )}
              <label className="text-[10.5px] font-bold text-muted uppercase">Discount requested</label>
              <input
                type="number"
                className="w-full text-[12.5px] mt-1"
                value={askAmount}
                onChange={(e) => setAskAmount(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <div className="text-[10.5px] text-muted mt-1">
                Rs. {Math.max(0, (Number(askAmount) || 0) - discountLimit).toLocaleString("en-PK")} above your
                Rs. {discountLimit.toLocaleString("en-PK")} limit. The approver can grant this figure or a
                lower one.
              </div>
              <input
                className="w-full text-[12.5px] mt-2"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this discount needed?"
                onKeyDown={(e) => e.key === "Enter" && sendRequest()}
              />
              {error && <div className="text-[11px] text-rose font-semibold mt-1">{error}</div>}
              <div className="flex gap-2 justify-end mt-2">
                <button
                  onClick={() => {
                    setShowForm(false);
                    setError(null);
                  }}
                  className="btn-ghost rounded-md px-2.5 py-1 text-[11px]"
                >
                  Cancel
                </button>
                <button
                  onClick={sendRequest}
                  disabled={sending || (Number(askAmount) || 0) <= 0}
                  className="btn-primary rounded-md px-3 py-1 text-[11px] disabled:opacity-40"
                >
                  {sending ? "Sending…" : "Send request"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
