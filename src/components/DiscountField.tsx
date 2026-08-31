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
    if (!bookingId) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("discount_approvals")
      .select("*")
      .eq("requested_by", user.id)
      .eq("booking_id", bookingId)
      .is("consumed_booking_id", null)
      .order("created_at", { ascending: false });
    setRequests((data as DiscountApproval[]) || []);
  }, [supabase, bookingId]);

  useEffect(() => {
    if (unlimited || !bookingId) return;
    load();
    const channel = supabase
      .channel(`discount-approvals-${bookingId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "discount_approvals" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [unlimited, bookingId, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const approved = requests.find((r) => r.status === "approved");
  const pending = requests.find((r) => r.status === "pending");
  const rejected = requests.find((r) => r.status === "rejected" && !pending && !approved);
  const permitCeiling = approved ? approved.approved_amount ?? approved.requested_amount : 0;
  const coveredByPermit = Boolean(approved) && amount <= permitCeiling;
  const canSave = !overLimit || coveredByPermit;

  async function sendRequest() {
    const want = Number(askAmount) || amount;
    if (want <= discountLimit) {
      setError(`Rs. ${want.toLocaleString("en-PK")} is within your own limit — no approval needed.`);
      return;
    }
    setSending(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
        className={`w-full mt-1 ${overLimit && !coveredByPermit ? "border-rose" : ""}`}
        value={noAuthority && approvers.length === 0 ? "" : value}
        disabled={noAuthority && approvers.length === 0}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />

      {!overLimit && (
        <div className="text-[11px] text-muted mt-1">
          Your limit: {unlimited ? "no limit" : `Rs. ${discountLimit.toLocaleString("en-PK")} per booking`}
        </div>
      )}

      {/* ---- approved, and the typed amount is within what was granted ---- */}
      {overLimit && coveredByPermit && (
        <div className="text-[11px] text-gold-deep font-semibold mt-1.5 bg-primary-dim rounded-md px-2.5 py-1.5">
          Approved up to Rs. {permitCeiling.toLocaleString("en-PK")}
          {ref && ` on ${ref}`} — you can save this booking.
          {approved?.decision_note && <div className="font-normal mt-0.5">“{approved.decision_note}”</div>}
        </div>
      )}

      {/* ---- approved, but for LESS than what's typed in ---- */}
      {overLimit && approved && !coveredByPermit && (
        <div className="text-[11px] mt-1.5 bg-gold-light border border-gold/40 rounded-md px-2.5 py-1.5">
          <div className="font-bold text-gold-deep">
            Approved for Rs. {permitCeiling.toLocaleString("en-PK")}, not Rs.{" "}
            {approved.requested_amount.toLocaleString("en-PK")}
          </div>
          {approved.decision_note && (
            <div className="text-[#6B5320] mt-0.5">“{approved.decision_note}”</div>
          )}
          <button
            onClick={() => onChange(permitCeiling)}
            className="btn-primary rounded-md px-3 py-1 text-[11px] mt-1.5"
          >
            Set discount to Rs. {permitCeiling.toLocaleString("en-PK")}
          </button>
        </div>
      )}

      {/* ---- waiting ---- */}
      {overLimit && !approved && pending && (
        <div className="text-[11px] mt-1.5 bg-gold-light border border-gold/30 rounded-md px-2.5 py-1.5">
          <div className="font-semibold text-gold-deep">
            Waiting on approval for Rs. {pending.requested_amount.toLocaleString("en-PK")}
            {ref && ` on ${ref}`}
          </div>
          <div className="text-muted mt-0.5">
            Sent to {pending.approver_roles.map((r) => ROLE_LABELS[r]).join(" and ")}. They can approve the full
            amount or a lower one.
          </div>
          <button onClick={() => withdraw(pending.id)} className="text-rose font-semibold hover:underline mt-1">
            Withdraw request
          </button>
        </div>
      )}

      {/* ---- over limit, nothing in hand ---- */}
      {overLimit && !approved && !pending && (
        <div className="mt-1.5">
          <div className="text-[11px] text-rose font-semibold">
            Over your limit — {ROLE_LABELS[role]} may approve up to Rs.{" "}
            {discountLimit.toLocaleString("en-PK")} per booking.
          </div>

          {rejected && (
            <div className="text-[11px] text-rose mt-1 bg-rose-light rounded-md px-2.5 py-1.5">
              <span className="font-semibold">
                Last request for Rs. {rejected.requested_amount.toLocaleString("en-PK")} was declined.
              </span>
              {rejected.decision_note && <div className="mt-0.5">“{rejected.decision_note}”</div>}
            </div>
          )}

          {approvers.length === 0 ? (
            <div className="text-[11px] text-muted mt-1">
              {ROLE_LABELS[role]} accounts can't apply a discount or request one.
            </div>
          ) : !bookingId ? (
            // No order number exists yet on an unsaved booking, and the request
            // has to be raised against one.
            <div className="text-[11px] text-muted mt-1.5 bg-bg border border-dashed border-border rounded-md px-2.5 py-2">
              Approval requests are raised against the booking's order number. Save this booking first with a
              discount of Rs. {discountLimit.toLocaleString("en-PK")} or less, then open it and request the
              rest — the request will carry its order number and details.
            </div>
          ) : !showForm ? (
            <button
              onClick={() => {
                setAskAmount(amount);
                setShowForm(true);
              }}
              className="btn-ghost rounded-lg px-3 py-1.5 text-[11.5px] mt-2"
            >
              Request approval from {approvers.map((r) => ROLE_LABELS[r]).join(" or ")}
            </button>
          ) : (
            <div className="border border-border rounded-lg p-2.5 mt-2 bg-bg">
              <div className="text-[11px] font-semibold text-primary mb-1.5">
                Request approval{ref && ` on ${ref}`}
              </div>
              <label className="text-[10.5px] font-bold text-muted uppercase">Discount requested</label>
              <input
                type="number"
                className="w-full text-[12.5px] mt-1"
                value={askAmount}
                onChange={(e) => setAskAmount(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <div className="text-[10.5px] text-muted mt-1">
                Rs. {Math.max(0, (Number(askAmount) || 0) - discountLimit).toLocaleString("en-PK")} above your
                limit. The approver may grant this or a lower figure.
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
