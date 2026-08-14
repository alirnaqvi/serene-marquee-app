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
import { bookingRef } from "@/types";
import type { Booking, Venue, Menu, BookingAddon } from "@/types";

export default function BookingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [addons, setAddons] = useState<BookingAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

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
    load();
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => router.back()} className="text-xs font-bold text-gold-deep hover:underline">
          &larr; Back
        </button>
        {!isCancelled && (
          <div className="flex gap-2">
            <Link href={`/bookings/${booking.id}/edit`} className="btn-ghost rounded-lg px-3.5 py-1.5 text-xs">
              Edit / Reschedule
            </Link>
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="text-xs font-semibold text-rose border border-rose/30 rounded-lg px-3.5 py-1.5 hover:bg-rose-light"
            >
              Cancel Booking
            </button>
          </div>
        )}
      </div>

      {isCancelled && (
        <div className="bg-rose-light text-rose rounded-lg px-3.5 py-2.5 text-[12.5px] font-semibold mb-4">
          This booking has been cancelled. The date/venue/session is free for a new booking.
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
          <div className="col-span-2 border-t border-[#8A6A1E]/25 pt-2 mt-1 flex justify-between text-base font-bold text-primary">
            <span>Balance Due</span>
            <span>{money(t.balance)}</span>
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
          message={`This will mark ${booking.client}'s booking as Cancelled and free up ${venueList.map(v=>v.name).join(" + ")} for ${booking.session} on ${fmtDMY(booking.event_date)}. This can't be undone from here.`}
          tone="danger"
          confirmLabel={cancelling ? "Cancelling…" : "Cancel Booking"}
          onConfirm={handleCancel}
          onClose={() => setShowCancelConfirm(false)}
        />
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
