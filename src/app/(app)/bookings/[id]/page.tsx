"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { chargesFromBooking, money, functionLabel, effectiveMenuItems } from "@/lib/calculations";
import { SESSION_TIMES, ENTRY_TEST_RATE } from "@/lib/constants";
import { fmtDMY, fmtDMYTime } from "@/lib/dateFormat";
import { generateDocumentPdf } from "@/lib/generateAgreementPdf";
import AlertModal from "@/components/AlertModal";
import { useSession } from "@/components/SessionContext";
import { bookingRef } from "@/types";
import type { Booking, Venue, Menu, BookingAddon } from "@/types";

export default function BookingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const { readOnly, canViewLedger } = useSession();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [addons, setAddons] = useState<BookingAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Advance refund (only offered once a booking is cancelled)
  const [showRefund, setShowRefund] = useState(false);
  const [refundAmount, setRefundAmount] = useState<number | "">("");
  const [refundDate, setRefundDate] = useState(new Date().toISOString().slice(0, 10));
  const [refundNote, setRefundNote] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  async function load() {
    const [{ data: v }, { data: m }, { data: b }, { data: a }] = await Promise.all([
      supabase.from("venues").select("*"),
      supabase.from("menus").select("*"),
      supabase.from("bookings").select("*").eq("id", params.id).single(),
      supabase.from("booking_addons").select("*").eq("booking_id", params.id),
    ]);
    setVenues(v || []);
    setMenus(m || []);
    setBooking(b);
    setAddons(a || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="text-muted text-sm">Loading…</div>;
  if (!booking) return <div className="text-muted text-sm">Booking not found.</div>;

  const menu = menus.find((m) => m.id === booking.menu_id);
  const venueList = booking.venues.map((id) => venues.find((v) => v.id === id)).filter((v): v is Venue => Boolean(v));
  const t = chargesFromBooking(booking, venues, menus);
  const isCancelled = booking.status === "Cancelled";
  const isEntryTest = booking.function_type === "Entry Test";
  const canRefund = isCancelled && booking.advance > 0 && !booking.advance_refunded && !readOnly;

  async function handleDownloadPdf(docType: "Agreement" | "Invoice" | "Quotation") {
    let logoDataUri: string | undefined;
    try {
      const res = await fetch("/logo.png");
      const blob = await res.blob();
      logoDataUri = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      /* PDF still generates without the logo if this fails */
    }
    generateDocumentPdf(booking!, venues, menus, addons, docType, logoDataUri);
  }

  async function handleCancel() {
    setCancelling(true);
    await supabase.from("bookings").update({ status: "Cancelled" }).eq("id", booking!.id);
    setShowCancelConfirm(false);
    setCancelling(false);
    await load();
    // If money was already taken, prompt for the refund decision right away.
    if (booking!.advance > 0 && !booking!.advance_refunded) openRefund();
  }

  function openRefund() {
    setRefundAmount(booking!.advance);
    setRefundDate(new Date().toISOString().slice(0, 10));
    setRefundNote("");
    setRefundError(null);
    setShowRefund(true);
  }

  async function handleRefund() {
    if (!booking) return;
    const amount = Number(refundAmount) || 0;
    if (amount <= 0) return setRefundError("Enter the amount being returned to the client.");
    if (amount > booking.advance) return setRefundError("The refund can't be more than the advance received.");

    setRefunding(true);
    setRefundError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error: updError } = await supabase
      .from("bookings")
      .update({
        advance_refunded: true,
        refund_amount: amount,
        refunded_at: new Date().toISOString(),
      })
      .eq("id", booking.id);

    if (updError) {
      setRefundError(updError.message);
      setRefunding(false);
      return;
    }

    // Money leaving the till gets its own ledger expense, so the daily
    // balance stays honest. If this account has no ledger access, RLS
    // rejects the insert silently — the refund is still recorded on the
    // booking itself.
    await supabase.from("ledger_entries").insert({
      entry_date: refundDate,
      type: "expense",
      description: `Refund of advance — ${booking.client} (${bookingRef(booking)}, cancelled)${
        refundNote.trim() ? ` — ${refundNote.trim()}` : ""
      }`,
      amount,
      booking_id: booking.id,
      handed_to: booking.client,
      category: "refund",
      created_by: user?.id,
    });

    setShowRefund(false);
    setRefunding(false);
    load();
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <button onClick={() => router.back()} className="text-xs font-bold text-gold-deep hover:underline">
          &larr; Back
        </button>
        <div className="flex gap-2 flex-wrap">
          {!isCancelled && !readOnly && (
            <>
              <Link href={`/bookings/${booking.id}/edit`} className="btn-ghost rounded-lg px-3.5 py-1.5 text-xs">
                Edit / Reschedule
              </Link>
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="text-xs font-semibold text-rose border border-rose/30 rounded-lg px-3.5 py-1.5 hover:bg-rose-light"
              >
                Cancel Booking
              </button>
            </>
          )}
          {canRefund && (
            <button onClick={openRefund} className="btn-primary rounded-lg px-3.5 py-1.5 text-xs">
              Refund Advance ({money(booking.advance)})
            </button>
          )}
        </div>
      </div>

      {isCancelled && (
        <div className="bg-rose-light text-rose rounded-lg px-3.5 py-2.5 text-[12.5px] font-semibold mb-4">
          This booking has been cancelled. The date/venue/session is free for a new booking.
          {booking.advance > 0 && !booking.advance_refunded && (
            <div className="font-normal mt-1">
              An advance of {money(booking.advance)} is still held against this booking.
              {readOnly ? "" : " Use “Refund Advance” above once it's returned to the client."}
            </div>
          )}
        </div>
      )}

      {booking.advance_refunded && (
        <div className="bg-primary-dim text-gold-deep rounded-lg px-3.5 py-2.5 text-[12.5px] font-semibold mb-4">
          Advance of {money(booking.refund_amount)} refunded to the client
          {booking.refunded_at ? ` on ${fmtDMY(booking.refunded_at.slice(0, 10))}` : ""}.
          {canViewLedger && " It has been posted to the ledger as an expense."}
        </div>
      )}

      <div className="card">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="font-serif text-xl font-bold text-primary">Serene Marquee</div>
            <div className="text-xs text-muted mt-0.5">
              Booking Ref — {bookingRef(booking)}
              <br />
              Datta Hamlet Housing Society, Abbottabad-Mansehra Road, Mansehra
            </div>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={() => handleDownloadPdf("Quotation")} className="btn-ghost rounded-lg px-3.5 py-2 text-xs whitespace-nowrap">
              Quotation PDF
            </button>
            <button onClick={() => handleDownloadPdf("Invoice")} className="btn-ghost rounded-lg px-3.5 py-2 text-xs whitespace-nowrap">
              Invoice PDF
            </button>
            <button onClick={() => handleDownloadPdf("Agreement")} className="btn-primary rounded-lg px-4 py-2 text-sm whitespace-nowrap">
              Agreement PDF
            </button>
          </div>
        </div>

        <div className="mt-4 divide-y divide-dashed divide-border text-[13px]">
          <Row k="Host / Organization" v={booking.client} />
          <Row k="CNIC" v={booking.cnic || "—"} />
          <Row k="Contact Number(s)" v={booking.phone2 ? `${booking.phone || "—"}  /  ${booking.phone2}` : booking.phone || "—"} />
          <Row k="Email" v={booking.email || "—"} />
          <Row k="Venue(s)" v={venueList.map((v) => `${v.name} (max ${v.capacity})`).join(" + ")} />
          <Row k="Function Date" v={fmtDMY(booking.event_date)} />
          <Row k="Session / Timing" v={`${booking.session} — ${SESSION_TIMES[booking.session]}`} />
          <Row k="Nature of Function" v={functionLabel(booking)} />
          {isEntryTest && <Row k="Entry Test Type" v={booking.entry_test_type || "—"} />}
          <Row k="Guaranteed No. of Guests" v={String(booking.guests)} />
          <Row
            k={isEntryTest ? "Entry Test Rate" : "Menu"}
            v={
              isEntryTest
                ? `${money(ENTRY_TEST_RATE)} / head — no menu`
                : booking.is_custom_menu
                ? "Customized Menu (see items below)"
                : menu
                ? `${menu.name} — ${effectiveMenuItems(menu.items, booking.removed_menu_items).join(", ")}`
                : "—"
            }
          />
          {!isEntryTest && !booking.is_custom_menu && (booking.removed_menu_items || []).length > 0 && (
            <Row k="Removed From Menu" v={(booking.removed_menu_items || []).join(", ")} />
          )}
          {booking.reference && <Row k="Discount Reference" v={booking.reference} />}
          <Row k="Filer Status" v={booking.filer} />
          <Row k="Status" v={booking.status} />
          <Row k="Booking Recorded On" v={fmtDMYTime(new Date(booking.created_at))} />
        </div>

        {addons.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-bold text-muted uppercase mb-2">
              {booking.is_custom_menu ? "Customized Menu Items" : "Extra Items Added to Menu"}
            </div>
            <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[560px] text-[12.5px]">
              <tbody>
                {addons.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="py-1.5">{a.name}</td>
                    <td className="py-1.5 text-muted text-right">{money(a.unit_price)} × {a.quantity}</td>
                    <td className="py-1.5 text-right font-semibold w-24">{money(a.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}

        <div className="bg-primary-dim rounded-lg p-4 mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
          <div className="col-span-2 text-[10.5px] uppercase tracking-wide font-bold text-gold-deep opacity-70">Charges</div>
          <div className="text-gold-deep opacity-85">
            {isEntryTest
              ? `Entry Test Fee (${booking.guests} × ${money(ENTRY_TEST_RATE)})`
              : booking.is_custom_menu
              ? "Customized Menu Total"
              : `Food Subtotal (${booking.guests} × ${money(menu?.rate || 0)}${t.addonsTotal > 0 ? ", incl. extras" : ""})`}
          </div>
          <div className="text-right font-bold text-gold-deep">{money(t.foodSubtotal)}</div>
          <div className="text-gold-deep opacity-85">KPRA Tax (15%)</div>
          <div className="text-right font-bold text-gold-deep">+ {money(t.kprTax)}</div>
          <div className="text-gold-deep opacity-85">
            Hall Charge{t.hallCharge ? (venueList.length > 1 ? " (both halls)" : "") : " (waived — 200+ guests)"}
          </div>
          <div className="text-right font-bold text-gold-deep">+ {money(t.hallCharge)}</div>
          <div className="text-gold-deep opacity-85">Decoration</div>
          <div className="text-right font-bold text-gold-deep">+ {money(t.decoration)}</div>
          <div className="text-gold-deep opacity-85">Cooling</div>
          <div className="text-right font-bold text-gold-deep">+ {money(t.coolingCharge)}</div>
          <div className="text-gold-deep opacity-85">Heating ({booking.heaters} heater{booking.heaters === 1 ? "" : "s"})</div>
          <div className="text-right font-bold text-gold-deep">+ {money(t.heatingCharge)}</div>
          <div className="text-gold-deep opacity-85">Income Tax ({booking.filer}, {t.incomeTaxRate * 100}%)</div>
          <div className="text-right font-bold text-gold-deep">+ {money(t.incomeTax)}</div>
          <div className="col-span-2 border-t border-[#8A6A1E]/25 pt-1.5 mt-0.5 flex justify-between text-[13px] font-bold text-gold-deep">
            <span>Total (before discount)</span>
            <span>{money(t.totalBeforeDiscount)}</span>
          </div>
          <div className="text-gold-deep opacity-85">Discount</div>
          <div className="text-right font-bold text-gold-deep">- {money(t.discountAmount)}</div>
          <div className="text-gold-deep opacity-85">Advance Paid</div>
          <div className="text-right font-bold text-gold-deep">- {money(booking.advance)}</div>
          {booking.advance_refunded && (
            <>
              <div className="text-gold-deep opacity-85">Advance Refunded</div>
              <div className="text-right font-bold text-gold-deep">+ {money(booking.refund_amount)}</div>
            </>
          )}
          <div className="col-span-2 border-t border-[#8A6A1E]/25 pt-2 mt-1 flex justify-between text-base font-bold text-primary">
            <span>Balance Due</span>
            <span>{money(t.balance + (booking.advance_refunded ? booking.refund_amount : 0))}</span>
          </div>
        </div>

        {booking.notes && (
          <div className="mt-4">
            <div className="text-xs font-bold text-muted uppercase">Special Instructions</div>
            <div className="text-[13px] mt-1">{booking.notes}</div>
          </div>
        )}
      </div>

      {showCancelConfirm && (
        <AlertModal
          title="Cancel this booking?"
          message={`This will mark ${booking.client}'s booking as Cancelled and free up ${venueList.map(v=>v.name).join(" + ")} for ${booking.session} on ${fmtDMY(booking.event_date)}.${
            booking.advance > 0
              ? ` An advance of ${money(booking.advance)} was received — you'll be asked next whether to refund it.`
              : ""
          }`}
          tone="danger"
          confirmLabel={cancelling ? "Cancelling…" : "Cancel Booking"}
          onConfirm={handleCancel}
          onClose={() => setShowCancelConfirm(false)}
        />
      )}

      {showRefund && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-6">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-gold-light">
              <div className="font-bold text-sm text-gold-deep">Refund advance payment</div>
              <div className="text-xs text-muted mt-0.5">
                {booking.client} · {bookingRef(booking)} · advance received {money(booking.advance)}
              </div>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              {refundError && <div className="text-rose text-[12.5px] font-semibold">{refundError}</div>}
              <div>
                <label className="text-xs font-bold text-muted uppercase">Amount Refunded</label>
                <input
                  type="number"
                  className="w-full mt-1"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <div className="text-[11px] text-muted mt-1">
                  Reduce this if part of the advance is being retained (e.g. the non-refundable token).
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-muted uppercase">Refund Date</label>
                <input type="date" className="w-full mt-1" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-bold text-muted uppercase">Note (optional)</label>
                <input
                  className="w-full mt-1"
                  value={refundNote}
                  onChange={(e) => setRefundNote(e.target.value)}
                  placeholder="e.g. token retained, balance returned in cash"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
              <button onClick={() => setShowRefund(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">
                Not Now
              </button>
              <button
                onClick={handleRefund}
                disabled={refunding}
                className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
              >
                {refunding ? "Recording…" : "Record Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <span className="text-muted shrink-0">{k}</span>
      <span className="font-semibold text-right">{v}</span>
    </div>
  );
}
