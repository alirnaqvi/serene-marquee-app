import { chargesFromBooking, money, functionLabel } from "./calculations";
import { SESSION_TIMES } from "./constants";
import { DEFAULT_SETTINGS, type ChargeSettings } from "./settings";
import { fmtDMY } from "./dateFormat";
import { bookingRef, clientName } from "@/types";
import type { Booking, Venue, Menu } from "@/types";

/**
 * Turn a number as staff actually type it into the international form WhatsApp
 * needs: digits only, country code in front, no plus sign.
 *
 *   0300 1234567   -> 923001234567
 *   +92 300 1234567 -> 923001234567
 *   300-1234567     -> 923001234567
 *
 * Returns null when there aren't enough digits to be a real number, so the
 * caller can tell the user rather than opening a broken chat.
 */
export function toWhatsAppNumber(phone: string | null | undefined, countryCode = "92"): string | null {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;

  let n = digits;
  if (n.startsWith("00")) n = n.slice(2);          // 0092...
  if (n.startsWith(countryCode) && n.length >= 11) return n;
  if (n.startsWith("0")) n = n.slice(1);           // local 0300...
  if (n.length < 9) return null;
  return countryCode + n;
}

export type WaDocType = "Invoice" | "Quotation" | "Agreement";

/**
 * The message that goes with the document.
 *
 * WhatsApp's click-to-chat link can carry text but cannot carry a file, so the
 * PDF is downloaded at the same moment and attached by hand in the chat. The
 * message is written to stand on its own even if the client only reads it on
 * their phone and never opens the attachment — the reference, the date, the
 * total and the balance are all in the text.
 */
export function invoiceMessage(
  booking: Booking,
  venues: Venue[],
  menus: Menu[],
  docType: WaDocType = "Invoice",
  settings: ChargeSettings = DEFAULT_SETTINGS
): string {
  const t = chargesFromBooking(booking, venues, menus, settings);
  const venueNames = booking.venues
    .map((id) => venues.find((v) => v.id === id)?.name)
    .filter(Boolean)
    .join(" + ");

  const lines = [
    `*Serene Marquee — ${docType}*`,
    `Ref: ${bookingRef(booking)}`,
    ``,
    `Assalam-o-Alaikum ${clientName(booking)},`,
    ``,
    `Here are the details of your booking:`,
    ``,
    `*Function:* ${functionLabel(booking)}`,
    `*Date:* ${fmtDMY(booking.event_date)}`,
    `*Timing:* ${booking.session} — ${SESSION_TIMES[booking.session]}`,
    `*Venue:* ${venueNames || "—"}`,
    `*Guests:* ${booking.guests}`,
    ``,
    `*Food (${booking.guests} × ${money(booking.per_head_rate)}/head):* ${money(t.foodSubtotal)}`,
  ];

  if (t.extrasTotal > 0) lines.push(`*Extras (charged per piece):* ${money(t.extrasTotal)}`);
  lines.push(
    `*KPRA Tax:* ${money(t.kprTax)}`,
    `*Hall Charge:* ${t.hallCharge > 0 ? money(t.hallCharge) : `Waived (${t.hallWaiverThreshold}+ guests)`}`
  );
  if (t.decoration > 0) lines.push(`*Decoration:* ${money(t.decoration)}`);
  if (t.coolingCharge + t.heatingCharge > 0)
    lines.push(`*Cooling / Heating:* ${money(t.coolingCharge + t.heatingCharge)}`);
  if (t.discountAmount > 0) lines.push(`*Discount:* − ${money(t.discountAmount)}`);

  lines.push(
    ``,
    `*Grand Total:* ${money(t.grandTotal)}`,
    `*Advance Received:* ${money(booking.advance)}`,
    `*Balance Due:* ${money(t.balance)}`,
    ``,
    `The full ${docType.toLowerCase()} is attached. Please let us know if anything needs correcting.`,
    ``,
    `Serene Marquee`,
    `Datta Hamlet Housing Society, Abbottabad-Mansehra Road, Mansehra`
  );

  return lines.join("\n");
}

/** wa.me link for a number and a message. */
export function whatsAppLink(waNumber: string, message: string): string {
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
}
