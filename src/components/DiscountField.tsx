"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/SessionContext";
import { ROLE_LABELS, approversFor, type DiscountApproval } from "@/types";

type NumField = number | "";

/**
 * Discount input with the signed-in role's ceiling built in.
 *
 *   Manager ............ Rs. 100,000 per booking  (currently Zain Syed)
 *   General Manager .... Rs. 200,000 per booking  (currently Ikram Abbasi)
 *   Staff / Owner ...... no discount authority
 *   Admin / Developer .. unlimited
 *
 * Going over the ceiling isn't a dead end: the field offers to send an
 * approval request up the chain of command. Once someone above approves it,
 * the booking saves normally.
 *
 * An approval is a single-use permit tied to ONE booking — matched by booking
 * id when editing, or by client name and function date when creating. It can't
 * be carried over to a different booking, a different date, or a second
 * booking for the same client.
 *
 * The ceilings and the permit are both enforced by enforce_discount_limit()
 * in Postgres, so this component is the courteous path, not the lock.
 */
export default function DiscountField({
  value,
  onChange,
  className = "",
  clientNameValue,
  eventDate,
  bookingId,
  bookingTotal,
}: {
  value: NumField;
  onChange: (v: NumField) => void;
  className?: string;
  /** Context shown to the approver so they can judge the request. */
  clientNameValue?: string;
  eventDate?: string;
  bookingId?: string;
  bookingTotal?: number;
}) {
  const supabase = createClient();
  const { role, discountLimit } = useSession();
  const amount = Number(value) || 0;
  const unlimited = discountLimit === Infinity;
  const notPermitted = discountLimit === 0;
  const overLimit = !unlimited && amount > discountLimit;
  const approvers = approversFor(role);

  const [myRequests, setMyRequests] = useState<DiscountApproval[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
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
      .limit(10);
    setMyRequests((data as DiscountApproval[]) || []);
  }, [supabase]);

  useEffect(() => {
    if (unlimited) return;
    loadRequests();
    // Watch for the decision landing while this form is still open.
    const channel = supabase
      .channel("my-discount-approvals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "discount_approvals" },
        () => loadRequests()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [unlimited, loadRequests]); // eslint-disable-line react-hooks/exhaustive-deps

  // An unspent approval that covers the amount typed in AND belongs to this
  // booking. The same binding is enforced by enforce_discount_limit(), so the
  // field never claims "approved" for a save the database would refuse.
  const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
  const permitCoversThisBooking = (r: DiscountApproval) => {
    if (r.booking_id) return r.booking_id === bookingId;
    if (r.client_name)
      return (
        norm(r.client_name) === norm(clientNameValue || "") && r.event_date === (eventDate || null)
      );
    return r.event_date === (eventDate || null);
  };
  const permit = myRequests.find(
    (r) =>
      r.status === "approved" &&
      (r.approved_amount ?? r.requested_amount) >= amount &&
      permitCoversThisBooking(r)
  );
  const pending = myRequests.find((r) => r.status === "pending" && permitCoversThisBooking(r));
  const rejected = myRequests.find(
    (r) => r.status === "rejected" && permitCoversThisBooking(r) && !pending && !permit
  );

  async function sendRequest() {
    setSending(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: err } = await supabase.from("discount_approvals").insert({
      booking_id: bookingId ?? null,
      client_name: clientNameValue?.trim() || null,
      event_date: eventDate || null,
      booking_total: bookingTotal ?? null,
      requested_amount: amount,
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
    setShowForm(false);
    setSending(false);
    loadRequests();
  }

  async function withdraw(id: string) {
    await supabase.from("discount_approvals").delete().eq("id", id);
    loadRequests();
  }

  return (
    <div className={className}>
      <label className="text-xs font-bold text-muted uppercase">Discount (Rs.)</label>
      <input
        type="number"
        min={0}
        className={`w-full mt-1 ${overLimit && !permit ? "border-rose" : ""}`}
        value={notPermitted && approvers.length === 0 ? "" : value}
        disabled={notPermitted && approvers.length === 0}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />

      {/* --- status line --- */}
      {!overLimit && (
        <div className="text-[11px] text-muted mt-1">
          Your limit: {unlimited ? "no limit" : `Rs. ${discountLimit.toLocaleString("en-PK")} per booking`}
        </div>
      )}

      {overLimit && permit && (
        <div className="text-[11px] text-gold-deep font-semibold mt-1.5 bg-primary-dim rounded-md px-2.5 py-1.5">
          Approved up to Rs. {(permit.approved_amount ?? permit.requested_amount).toLocaleString("en-PK")} for
          this booking — you can save it now. The approval applies to this booking only.
          {permit.decision_note && <div className="font-normal mt-0.5">“{permit.decision_note}”</div>}
        </div>
      )}

      {overLimit && !permit && pending && (
        <div className="text-[11px] mt-1.5 bg-gold-light border border-gold/30 rounded-md px-2.5 py-1.5">
          <div className="font-semibold text-gold-deep">
            Waiting on approval for Rs. {pending.requested_amount.toLocaleString("en-PK")}
          </div>
          <div className="text-muted mt-0.5">
            Sent to {pending.approver_roles.map((r) => ROLE_LABELS[r]).join(" and ")}. You'll be notified as soon
            as it's decided.
          </div>
          <button
            onClick={() => withdraw(pending.id)}
            className="text-rose font-semibold hover:underline mt-1"
          >
            Withdraw request
          </button>
        </div>
      )}

      {overLimit && !permit && !pending && (
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
          ) : !showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="btn-ghost rounded-lg px-3 py-1.5 text-[11.5px] mt-2"
            >
              Request approval from {approvers.map((r) => ROLE_LABELS[r]).join(" or ")}
            </button>
          ) : (
            <div className="border border-border rounded-lg p-2.5 mt-2 bg-bg">
              <div className="text-[11px] font-semibold text-primary mb-1.5">
                Requesting Rs. {amount.toLocaleString("en-PK")} — that's Rs.{" "}
                {(amount - discountLimit).toLocaleString("en-PK")} above your limit.
              </div>
              <input
                className="w-full text-[12.5px]"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this discount needed?"
                onKeyDown={(e) => e.key === "Enter" && sendRequest()}
                autoFocus
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
                  disabled={sending || amount <= 0}
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

/**
 * Blocks saving only when the discount is over the ceiling AND no approval is
 * in hand. `hasPermit` comes from the caller, which knows whether an approved
 * request covers this amount.
 */
export function discountError(
  amount: number,
  limit: number,
  role: string,
  hasPermit = false
): string | null {
  if (limit === Infinity) return null;
  if (amount > limit && !hasPermit) {
    return limit === 0
      ? `${role} accounts are not permitted to apply a discount.`
      : `Discount of Rs. ${amount.toLocaleString("en-PK")} is over your Rs. ${limit.toLocaleString(
          "en-PK"
        )} limit. Request approval before saving.`;
  }
  return null;
}
