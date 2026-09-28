"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY, fmtDMYTime } from "@/lib/dateFormat";
import AlertModal from "@/components/AlertModal";
import { PAYMENT_METHODS, recorderLabel, type Booking, type BookingPayment } from "@/types";

type NumField = number | "";

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The client's account on one booking, kept like the vendor diary: every
 * rupee received in date order with a running balance, and a blank row at the
 * bottom to record the next payment.
 *
 * The first line is always the advance taken on the booking form. Every line
 * after it is a payment recorded here, and each one goes into the daily ledger
 * as income automatically (the database does that, so it works for staff
 * without ledger access too). Deleting a payment takes it back out of the
 * ledger as well.
 */
export default function BookingPayments({
  booking,
  grandTotal,
  payments,
  canRecord,
  onChanged,
}: {
  booking: Booking;
  grandTotal: number;
  payments: BookingPayment[];
  /** False for cancelled bookings and monitor-only accounts. */
  canRecord: boolean;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const received = (booking.advance || 0) + payments.reduce((s, p) => s + Number(p.amount), 0);
  const balance = grandTotal - received;

  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState<NumField>("");
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BookingPayment | null>(null);

  // Rows in date order with the balance still owed after each one.
  type Row = {
    key: string;
    date: string;
    what: string;
    amount: number;
    by: string;
    at: string;
    payment?: BookingPayment;
  };
  const rows: Row[] = [];
  if (booking.advance > 0) {
    rows.push({
      key: "advance",
      date: (() => {
        const d = new Date(booking.created_at);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })(),
      what: "Advance — taken on the booking form",
      amount: booking.advance,
      by: recorderLabel(booking.recorder),
      at: booking.created_at,
    });
  }
  [...payments]
    .sort((a, b) => a.paid_on.localeCompare(b.paid_on) || a.created_at.localeCompare(b.created_at))
    .forEach((p) =>
      rows.push({
        key: p.id,
        date: p.paid_on,
        what: [p.method, p.note].filter(Boolean).join(" — ") || "Payment",
        amount: Number(p.amount),
        by: recorderLabel(p.profiles),
        at: p.created_at,
        payment: p,
      })
    );
  let owed = grandTotal;
  const withBalance = rows.map((r) => {
    owed -= r.amount;
    return { ...r, owed };
  });

  async function record() {
    const value = Number(amount) || 0;
    if (value <= 0) return setError("Enter the amount received.");
    if (!date) return setError("Pick the date the money was received.");
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from("booking_payments").insert({
      booking_id: booking.id,
      paid_on: date,
      amount: value,
      method: method || null,
      note: note.trim() || null,
    });
    setSaving(false);
    if (err) {
      setError(
        err.message.includes("booking_payments")
          ? "Payments can't be recorded yet — run database migration 2026-18 first."
          : err.message
      );
      return;
    }
    setAmount("");
    setNote("");
    setDate(todayIso());
    onChanged();
  }

  async function remove() {
    if (!deleting) return;
    const { error: err } = await supabase.from("booking_payments").delete().eq("id", deleting.id);
    setDeleting(null);
    if (err) setError(err.message);
    onChanged();
  }

  const cellCls = "py-2 px-2 align-top";

  return (
    <div className="card mt-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[14.5px] font-bold text-primary">Payments</div>
          <div className="text-xs text-muted mt-0.5">
            Every payment from the client after the advance. Each one is added to the daily ledger as income.
          </div>
        </div>
        {balance <= 0 && received > 0 && (
          <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-light text-emerald">
            Paid in full
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <div className="bg-bg border border-border rounded-lg px-3 py-2">
          <div className="text-[10.5px] text-muted uppercase font-semibold">Total bill</div>
          <div className="text-[15px] font-bold font-serif mt-0.5">{money(grandTotal)}</div>
        </div>
        <div className="bg-bg border border-border rounded-lg px-3 py-2">
          <div className="text-[10.5px] text-muted uppercase font-semibold">Received</div>
          <div className="text-[15px] font-bold font-serif text-gold-deep mt-0.5">{money(received)}</div>
        </div>
        <div className="bg-bg border border-border rounded-lg px-3 py-2">
          <div className="text-[10.5px] text-muted uppercase font-semibold">
            {balance < 0 ? "Paid over" : "Balance due"}
          </div>
          <div className={`text-[15px] font-bold font-serif mt-0.5 ${balance > 0 ? "text-rose" : "text-emerald"}`}>
            {money(Math.abs(balance))}
          </div>
        </div>
      </div>

      {error && <div className="text-rose text-[12px] font-semibold mt-3">{error}</div>}

      <div className="overflow-x-auto -mx-1 mt-4">
        <table className="w-full min-w-[620px] text-[12.5px] border border-border">
          <thead>
            <tr className="text-left text-muted text-[11px] uppercase tracking-wide bg-gold-light/60">
              <th className="py-2 px-2 w-[110px]">Date</th>
              <th className="py-2 px-2">Details</th>
              <th className="py-2 px-2 text-right w-[120px]">Received</th>
              <th className="py-2 px-2 text-right w-[120px]">Balance</th>
              <th className="py-2 px-2 w-[170px]">Recorded By</th>
              {canRecord && <th className="py-2 px-1 w-[34px]"></th>}
            </tr>
          </thead>
          <tbody>
            {withBalance.length === 0 && (
              <tr>
                <td colSpan={canRecord ? 6 : 5} className="text-center py-5 text-muted">
                  Nothing received yet.
                </td>
              </tr>
            )}
            {withBalance.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className={cellCls}>{fmtDMY(r.date)}</td>
                <td className={cellCls}>{r.what}</td>
                <td className={`${cellCls} text-right font-semibold text-gold-deep`}>{money(r.amount)}</td>
                <td className={`${cellCls} text-right font-bold ${r.owed > 0 ? "" : "text-emerald"}`}>
                  {money(r.owed)}
                </td>
                <td className={`${cellCls} text-muted text-[11px] leading-snug`}>
                  {r.by}
                  <br />
                  <span className="text-[10px]">{fmtDMYTime(new Date(r.at))}</span>
                </td>
                {canRecord && (
                  <td className="py-2 px-1 text-center align-top">
                    {r.payment && (
                      <button
                        onClick={() => setDeleting(r.payment!)}
                        className="text-rose hover:bg-rose-light rounded w-5 h-5 leading-none"
                        title="Delete this payment"
                        aria-label="Delete this payment"
                      >
                        ×
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}

            {canRecord && (
              <tr className="border-t-2 border-gold/40 bg-gold-light/25">
                <td className="py-1.5 px-1.5 align-top">
                  <input
                    type="date"
                    className="w-full text-[12px] px-2 py-1.5"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    aria-label="Date received"
                  />
                </td>
                <td className="py-1.5 px-1.5 align-top">
                  <div className="flex gap-1.5">
                    <select
                      className="text-[12px] px-2 py-1.5 w-[130px] shrink-0"
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      aria-label="Payment method"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      className="flex-1 min-w-0 text-[12px] px-2 py-1.5"
                      placeholder="Note (optional) — e.g. 2nd instalment"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && record()}
                    />
                  </div>
                </td>
                <td className="py-1.5 px-1.5 align-top">
                  <input
                    type="number"
                    min={0}
                    className="w-full text-[12px] px-2 py-1.5 text-right"
                    placeholder={balance > 0 ? String(Math.round(balance)) : "Amount"}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    onKeyDown={(e) => e.key === "Enter" && record()}
                    aria-label="Amount received"
                  />
                  {balance > 0 && amount === "" && (
                    <button
                      onClick={() => setAmount(Math.round(balance))}
                      className="text-[10.5px] font-semibold text-gold-deep hover:underline mt-1"
                    >
                      Full balance
                    </button>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right align-top text-muted text-[12px] pt-3">
                  {amount !== "" ? money(balance - (Number(amount) || 0)) : ""}
                </td>
                <td colSpan={2} className="py-1.5 px-1.5 align-top">
                  <button
                    onClick={record}
                    disabled={saving || amount === ""}
                    className="btn-primary rounded-lg px-3 py-1.5 text-[12px] w-full disabled:opacity-40"
                  >
                    {saving ? "Recording…" : "Record payment"}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deleting && (
        <AlertModal
          title="Delete this payment?"
          message={`${money(deleting.amount)} received on ${fmtDMY(
            deleting.paid_on
          )} will be removed from this booking and from the daily ledger. The balance due goes back up by the same amount.`}
          tone="danger"
          confirmLabel="Delete Payment"
          onConfirm={remove}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
