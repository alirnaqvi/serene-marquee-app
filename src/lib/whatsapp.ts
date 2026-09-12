import type { SupabaseClient } from "@supabase/supabase-js";
import { money, chargesFromBooking } from "./calculations";
import { DEFAULT_SETTINGS, type ChargeSettings } from "./settings";
import { fmtDMY } from "./dateFormat";
import { bookingRef, clientName } from "@/types";
import type { Booking, Venue, Menu } from "@/types";

/**
 * SENDING A DOCUMENT TO A CLIENT ON WHATSAPP
 *
 * WhatsApp's click-to-chat link (wa.me) carries text and nothing else. No web
 * page can push a file into it. So there are exactly two honest ways to get
 * the actual PDF onto a client's phone from this app, and it uses whichever
 * one the device supports:
 *
 *   1. THE SHARE SHEET (phones, and any desktop browser that supports it).
 *      The PDF is handed to the operating system as a real file and the staff
 *      member picks WhatsApp — and then the client — from the normal share
 *      sheet. The client receives the PDF as an attachment, exactly as if it
 *      had been attached by hand. This is the good path, and it is the one
 *      staff on phones will always get.
 *
 *   2. A LINK TO THE PDF (older desktop browsers).
 *      The PDF is uploaded to Supabase Storage, a signed link valid for 90
 *      days is created, and WhatsApp Web opens on the client's chat with a
 *      short message and that link. The client taps it and the PDF opens.
 *      Not an attachment, but it is the real document and it needs no
 *      copying, renaming or hunting through a downloads folder.
 *
 * If you want the PDF delivered automatically, with no share sheet and no
 * link — the app sending it straight to the client's number — that needs the
 * WhatsApp Cloud API, which means a Meta Business account, a verified sender
 * number and an approved message template. See the note at the bottom of this
 * file.
 */

const BUCKET = "documents";

/**
 * Turn a number as staff actually type it into the international form WhatsApp
 * needs: digits only, country code in front, no plus sign.
 *
 *   0300 1234567    -> 923001234567
 *   +92 300 1234567 -> 923001234567
 *   300-1234567     -> 923001234567
 *
 * Returns null when there aren't enough digits to be a real number, so the
 * caller can say so rather than opening a broken chat.
 */
export function toWhatsAppNumber(phone: string | null | undefined, countryCode = "92"): string | null {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;

  let n = digits;
  if (n.startsWith("00")) n = n.slice(2);
  if (n.startsWith(countryCode) && n.length >= 11) return n;
  if (n.startsWith("0")) n = n.slice(1);
  if (n.length < 9) return null;
  return countryCode + n;
}

export type WaDocType = "Invoice" | "Quotation" | "Agreement";

/**
 * The short note that travels with the document. The PDF carries every figure,
 * so this stays to a few lines — a covering message, not a second copy of the
 * invoice. The balance is included because it is the one number a client
 * usually wants before opening anything.
 */
export function coveringMessage(
  booking: Booking,
  venues: Venue[],
  menus: Menu[],
  docType: WaDocType = "Invoice",
  settings: ChargeSettings = DEFAULT_SETTINGS
): string {
  const t = chargesFromBooking(booking, venues, menus, settings);
  const balanceLine =
    docType === "Quotation"
      ? `Estimated total: ${money(t.grandTotal)}`
      : `Balance due: ${money(t.balance)}`;

  return [
    `Assalam-o-Alaikum ${clientName(booking)},`,
    ``,
    `Your ${docType.toLowerCase()} for ${fmtDMY(booking.event_date)} (${booking.session}) is attached.`,
    `Reference: ${bookingRef(booking)}`,
    balanceLine,
    ``,
    `Serene Marquee`,
  ].join("\n");
}

export function whatsAppLink(waNumber: string, message: string): string {
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
}

/** True when this device can hand a real file to WhatsApp via the share sheet. */
export function canShareFiles(file: File): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    share?: (data: unknown) => Promise<void>;
    canShare?: (data: unknown) => boolean;
  };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  return nav.canShare({ files: [file] });
}

export type SendResult =
  | { via: "share" }
  | { via: "link"; url: string }
  | { via: "cancelled" }
  | { via: "error"; message: string };

/**
 * Put the PDF in front of the client on WhatsApp, by whichever of the two
 * routes this device supports.
 *
 * `supabase` is only touched on the link route, so a phone never uploads
 * anything — the file goes straight from the browser into the share sheet.
 */
export async function sendPdfOnWhatsApp({
  file,
  waNumber,
  message,
  booking,
  supabase,
}: {
  file: File;
  waNumber: string;
  message: string;
  booking: Booking;
  supabase: SupabaseClient;
}): Promise<SendResult> {
  // ---- Route 1: the share sheet, with the PDF as a real attachment --------
  if (canShareFiles(file)) {
    try {
      await (navigator as Navigator & { share: (d: unknown) => Promise<void> }).share({
        files: [file],
        title: file.name,
        text: message,
      });
      return { via: "share" };
    } catch (err) {
      // The staff member backing out of the share sheet is not a failure and
      // must not fall through to uploading the document somewhere.
      const name = (err as { name?: string })?.name;
      if (name === "AbortError") return { via: "cancelled" };
      // Anything else: fall through and try the link route instead.
    }
  }

  // ---- Route 2: upload, sign, and send the link --------------------------
  const path = `${booking.id}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) {
    return {
      via: "error",
      message: `Could not upload the PDF: ${uploadError.message}. Run migration 2026-17, which creates the documents bucket.`,
    };
  }

  // 90 days: long enough that a client coming back to the link a month before
  // the function still finds it, short enough that it doesn't live forever.
  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 90);

  if (signError || !signed?.signedUrl) {
    return { via: "error", message: signError?.message || "Could not create a link to the PDF." };
  }

  const withLink = `${message}\n\n${signed.signedUrl}`;
  window.open(whatsAppLink(waNumber, withLink), "_blank", "noopener,noreferrer");
  return { via: "link", url: signed.signedUrl };
}

/* ---------------------------------------------------------------------------
 * FULLY AUTOMATED SENDING (not built — what it would take)
 *
 * To have the app send the PDF to the client's number by itself, with nobody
 * touching a share sheet:
 *
 *   1. A Meta Business account with a verified WhatsApp Business number.
 *   2. The PDF at a publicly reachable URL — the signed Storage link above
 *      already works for this.
 *   3. A server route (not the browser — the access token must never reach it)
 *      that POSTs to the Cloud API:
 *
 *        POST https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages
 *        { "messaging_product": "whatsapp",
 *          "to": "<923001234567>",
 *          "type": "document",
 *          "document": { "link": "<signed url>", "filename": "Invoice.pdf" } }
 *
 *   4. An approved message TEMPLATE. A business may only message a client out
 *      of the blue using a pre-approved template; a free-form document like
 *      this one can only be sent inside 24 hours of the client's last message.
 *      In practice that means a short approved template ("Your invoice for
 *      {{1}} is ready") carrying the document.
 *
 * It is a day or two of setup and Meta's approval wait, plus a per-message
 * cost. Worth it if invoices go out in volume; the share sheet is faster to
 * live with if they go out one at a time.
 * ------------------------------------------------------------------------- */
