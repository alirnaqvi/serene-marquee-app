import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { chargesFromBooking, money, functionLabel, effectiveMenuItems } from "./calculations";
import { SESSION_TIMES } from "./constants";
import { DEFAULT_SETTINGS, type ChargeSettings } from "./settings";
import { fmtDMY, fmtDMYTime } from "./dateFormat";
import { bookingRef, clientName } from "@/types";
import type { Booking, Venue, Menu, BookingAddon } from "@/types";

const GOLD: [number, number, number] = [138, 106, 30];
const INK: [number, number, number] = [27, 24, 16];
const MUTED: [number, number, number] = [122, 113, 92];
const DARK: [number, number, number] = [20, 18, 16];
const CREAM: [number, number, number] = [243, 231, 190];
const LINE: [number, number, number] = [214, 205, 178];

/**
 * PRINT SIZING
 *
 * These documents are read on paper far more often than on a screen, and the
 * first version was set at screen sizes: a 23pt title, 9.5pt body, thick solid
 * fills. Printed on A4 that came out oversized and ink-heavy, and pushed a
 * one-event agreement onto a second page.
 *
 * Everything below is set in points at the size it will actually print. The
 * body sits at 8pt — the size a printed invoice or contract is normally set in
 * — with headings kept only just large enough to separate the sections. The
 * solid dark blocks are gone in favour of a light fill with a rule, which
 * reads better on paper and uses a fraction of the toner.
 */
const TYPE = {
  brand: 15,
  address: 7.5,
  meta: 7,
  docTitle: 15,
  subheading: 7.5,
  sectionHeading: 9,
  body: 8,
  table: 7.8,
  terms: 6.8,
  total: 10.5,
  signature: 7,
};

const TERMS = [
  "Booking date is only confirmed after receipt of Rs. 50,000 token money. This amount is non-refundable.",
  "100% of the amount is expected to be paid in advance, two weeks before the event date. Failure to comply may result in a change of booking date or a change in previously finalized rates.",
  "A copy of the host's CNIC, along with contact number and email, is required at the time of reservation.",
  "Food and decoration services are not permitted from outside vendors — only registered vendors are allowed.",
  "The total number of guests will be counted on the day of the event. Any extra guests will be charged.",
  "Heating and cooling services are charged separately.",
  "Each event is given 4 hours (Lunch: 12:30 PM-4:30 PM, Dinner: 7:00 PM-11:00 PM). Additional hours are charged at Rs. 25,000/hour.",
  "Fireworks and the display of arms and ammunition are strictly prohibited inside and outside the premises.",
  "All prevailing government charges and taxes apply.",
];

export type DocType = "Agreement" | "Invoice" | "Quotation";

const DOC_CONFIG: Record<DocType, { heading: string; subheading: string; showTerms: boolean; showSignatures: boolean }> = {
  Agreement: {
    heading: "Booking Agreement",
    subheading: "Signed agreement between Serene Marquee and the host, confirming all terms of the function.",
    showTerms: true,
    showSignatures: true,
  },
  Invoice: {
    heading: "Invoice",
    subheading: "Itemized bill for a confirmed booking, including balance due.",
    showTerms: true,
    showSignatures: false,
  },
  Quotation: {
    heading: "Quotation",
    subheading: "Estimated charges for a proposed function. Not a confirmed booking until a token is paid.",
    showTerms: true,
    showSignatures: false,
  },
};

export function generateDocumentPdf(
  booking: Booking,
  venues: Venue[],
  menus: Menu[],
  addons: BookingAddon[] = [],
  docType: DocType = "Agreement",
  logoDataUri?: string,
  // KPRA and the entry-test rate are set by the Admin on Menus & Venues; the
  // code constants are the fallback if they haven't loaded.
  settings: ChargeSettings = DEFAULT_SETTINGS
) {
  const cfg = DOC_CONFIG[docType];
  const menu = menus.find((m) => m.id === booking.menu_id);
  const venueList = booking.venues.map((id) => venues.find((v) => v.id === id)).filter((v): v is Venue => Boolean(v));
  const t = chargesFromBooking(booking, venues, menus, settings);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 38;
  let y = 44;

  if (logoDataUri) {
    try {
      doc.addImage(logoDataUri, "PNG", margin, y - 12, 38, 38);
    } catch {
      /* ignore image failures, keep generating the rest of the PDF */
    }
  }
  doc.setFont("times", "bold");
  doc.setFontSize(TYPE.brand);
  doc.setTextColor(...INK);
  doc.text("Serene Marquee", margin + 48, y + 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(TYPE.address);
  doc.setTextColor(...MUTED);
  doc.text("Datta Hamlet Housing Society, Abbottabad-Mansehra Road, Mansehra", margin + 48, y + 13);
  doc.text(`Ref ${bookingRef(booking)}`, margin + 48, y + 23);

  doc.setFontSize(TYPE.meta);
  doc.setTextColor(...MUTED);
  doc.text(`PDF generated: ${fmtDMYTime(new Date())}`, pageW - margin, y, { align: "right" });

  y += 38;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

  // The document type (Agreement / Invoice / Quotation) is the single most
  // important thing on the page for the reader to identify at a glance, so
  // it gets its own large, bold, centered heading — not buried in small
  // print next to the reference number.
  doc.setFont("times", "bold");
  doc.setFontSize(TYPE.docTitle);
  doc.setTextColor(...GOLD);
  doc.text(cfg.heading.toUpperCase(), pageW / 2, y, { align: "center" });
  y += 7;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(pageW / 2 - 46, y, pageW / 2 + 46, y);
  y += 14;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(TYPE.subheading);
  doc.setTextColor(...MUTED);
  const subLines = doc.splitTextToSize(cfg.subheading, pageW - margin * 2);
  doc.text(subLines, margin, y);
  y += subLines.length * 8.5 + 6;

  const contactLine = booking.phone2 ? `${booking.phone || "-"}  /  ${booking.phone2}` : booking.phone || "-";
  const isEntryTest = booking.function_type === "Entry Test";
  const menuLine = isEntryTest
    ? `${money(settings.entryTestRate)} / head — no menu (Entry Test)`
    : booking.is_custom_menu
    ? "Customized Menu — see itemized list below"
    : menu
    ? `${menu.name} — ${effectiveMenuItems(menu.items, booking.removed_menu_items).join(", ")}`
    : "-";

  const details: [string, string][] = [
    ["Booking Reference", bookingRef(booking)],
    ["Host / Organization", clientName(booking)],
    ["CNIC", booking.cnic || "-"],
    ["Contact Number(s)", contactLine],
    ["Email", booking.email || "-"],
    ["Venue(s)", venueList.map((v) => `${v.name} (max ${v.capacity})`).join(" + ")],
    ["Function Date", `${fmtDMY(booking.event_date)}`],
    ["Session / Timing", `${booking.session} — ${SESSION_TIMES[booking.session]}`],
    ["Nature of Function", functionLabel(booking)],
  ];
  if (isEntryTest) details.push(["Entry Test Type", booking.entry_test_type || "-"]);
  details.push(
    ["Guaranteed No. of Guests", String(booking.guests)],
    [isEntryTest ? "Rate" : "Menu", menuLine]
  );
  if (booking.reference) details.push(["Discount Reference", booking.reference]);
  if (docType !== "Quotation") details.push(["Status", booking.status]);
  if (docType === "Agreement") details.push(["Booking Recorded On", fmtDMYTime(new Date(booking.created_at))]);

  autoTable(doc, {
    startY: y,
    theme: "plain",
    margin: { left: margin, right: margin },
    styles: { fontSize: TYPE.body, cellPadding: { top: 2.2, bottom: 2.2, left: 0, right: 6 }, textColor: INK },
    columnStyles: { 0: { fontStyle: "bold", textColor: GOLD, cellWidth: 128 }, 1: { halign: "left" } },
    body: details,
  });

  // @ts-ignore - lastAutoTable is attached by the plugin at runtime
  y = doc.lastAutoTable.finalY + 14;

  // Itemized add-ons / customized menu list, if any were selected — shown on
  // every document type so the exact menu makeup is always visible on paper.
  if (isEntryTest) {
    // No menu to itemize — Entry Test bookings are a flat per-head fee.
  } else if (addons.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(TYPE.sectionHeading);
    doc.setTextColor(...DARK);
    doc.text(booking.is_custom_menu ? "Customized Menu Items" : "Extra Items Added to Menu", margin, y);
    y += 6;

    // Ordinary items are covered by the agreed per-head rate and so carry no
    // figure. A priced item (Lamb Roast) shows its rate and what it came to,
    // because that amount is charged on top.
    const anyPriced = addons.some((a) => (a.line_total || 0) > 0);

    autoTable(doc, {
      startY: y,
      theme: "grid",
      margin: { left: margin, right: margin },
      headStyles: { fillColor: CREAM, textColor: INK, fontStyle: "bold", fontSize: TYPE.table },
      styles: { fontSize: TYPE.table, cellPadding: 2.8, textColor: INK, lineColor: LINE, lineWidth: 0.4 },
      head: anyPriced ? [["Item", "Qty", "Rate", "Amount"]] : [["Item", "Qty"]],
      body: addons.map((a) =>
        anyPriced
          ? [
              a.name,
              `${a.quantity}${a.unit_label ? ` ${a.unit_label}${a.quantity === 1 ? "" : "s"}` : ""}`,
              a.unit_price > 0 ? money(a.unit_price) : "—",
              a.line_total > 0 ? money(a.line_total) : "Included in per-head rate",
            ]
          : [a.name, String(a.quantity)]
      ),
      columnStyles: anyPriced
        ? { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } }
        : { 1: { halign: "right" } },
    });
    // @ts-ignore
    y = doc.lastAutoTable.finalY + 14;
  } else if (!booking.is_custom_menu && menu) {
    // No add-ons selected — still print the fixed menu's included items
    // (minus anything removed from this booking) so every document shows
    // exactly what's being served, not just the menu's name.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(TYPE.sectionHeading);
    doc.setTextColor(...DARK);
    doc.text("Menu Items Included", margin, y);
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE.body);
    doc.setTextColor(60, 55, 45);
    const menuItemLines = doc.splitTextToSize(effectiveMenuItems(menu.items, booking.removed_menu_items).join(", "), pageW - margin * 2);
    doc.text(menuItemLines, margin, y);
    y += menuItemLines.length * 8.5 + 12;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE.sectionHeading);
  doc.setTextColor(...DARK);
  doc.text("Charges", margin, y);
  y += 6;

  const foodLabel = isEntryTest
    ? `Entry Test Fee (${booking.guests} x ${money(settings.entryTestRate)})`
    : booking.is_custom_menu
    ? "Customized Menu Total"
    : `Food Subtotal (${booking.guests} x ${money(booking.per_head_rate)}/head)`;

  const charges: [string, string, string][] = [[foodLabel, "", money(t.foodSubtotal)]];
  if (t.extrasTotal > 0) {
    charges.push(["Priced Extras", "Charged per piece — see list above", "+ " + money(t.extrasTotal)]);
  }
  charges.push(
    ["KPRA Tax", `${+(settings.kpraRate * 100).toFixed(2)}%`, "+ " + money(t.kprTax)],
    [
      "Hall Charge",
      t.hallCharge
        ? venueList.length > 1
          ? `Both halls — waived at ${t.hallWaiverThreshold}+ guests`
          : `Waived at ${t.hallWaiverThreshold}+ guests`
        : `Waived (${t.hallWaiverThreshold}+ guests)`,
      "+ " + money(t.hallCharge),
    ],
    ["Decoration", "", "+ " + money(t.decoration)],
    ["Cooling", booking.cooling ? "Yes" : "No", "+ " + money(t.coolingCharge)],
    ["Heating", `${booking.heaters} heater(s)`, "+ " + money(t.heatingCharge)],
    ["Total (before discount)", "", money(t.totalBeforeDiscount)],
    ["Discount", "", "- " + money(t.discountAmount)]
  );
  if (docType !== "Quotation") {
    charges.push(["Advance Paid", "", "- " + money(booking.advance)]);
  }

  autoTable(doc, {
    startY: y,
    theme: "grid",
    margin: { left: margin, right: margin },
    headStyles: { fillColor: CREAM, textColor: INK, fontStyle: "bold", fontSize: TYPE.table },
    styles: { fontSize: TYPE.table, cellPadding: 3, textColor: INK, lineColor: LINE, lineWidth: 0.4 },
    head: [["Item", "Detail", "Amount"]],
    body: charges,
    columnStyles: { 1: { halign: "left" }, 2: { halign: "right" } },
  });

  // @ts-ignore
  y = doc.lastAutoTable.finalY + 10;

  // A light panel with a rule rather than a solid black block: the same
  // emphasis on paper, without soaking a strip of the page in toner.
  doc.setFillColor(...CREAM);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.7);
  doc.rect(margin, y, pageW - margin * 2, 22, "FD");
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE.total);
  doc.text(docType === "Quotation" ? "Estimated Total" : "Balance Due", margin + 10, y + 14.5);
  doc.text(money(docType === "Quotation" ? t.grandTotal : t.balance), pageW - margin - 10, y + 14.5, { align: "right" });
  y += 36;

  if (booking.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(TYPE.sectionHeading);
    doc.setTextColor(...DARK);
    doc.text("Special Instructions", margin, y);
    y += 11;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE.body);
    doc.setTextColor(60, 55, 45);
    const split = doc.splitTextToSize(booking.notes, pageW - margin * 2);
    doc.text(split, margin, y);
    y += split.length * 9 + 10;
  }

  if (cfg.showTerms) {
    if (y > pageH - 190) {
      doc.addPage();
      y = 46;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(TYPE.sectionHeading);
    doc.setTextColor(...DARK);
    doc.text("Terms & Conditions", margin, y);
    y += 11;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE.terms);
    doc.setTextColor(...MUTED);
    TERMS.forEach((term, i) => {
      const lines = doc.splitTextToSize(`${i + 1}. ${term}`, pageW - margin * 2);
      if (y + lines.length * 8 > pageH - 60) {
        doc.addPage();
        y = 46;
      }
      doc.text(lines, margin, y);
      y += lines.length * 8 + 2.5;
    });
  }

  if (cfg.showSignatures) {
    y += 28;
    if (y > pageH - 54) {
      doc.addPage();
      y = 64;
    }
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.5);
    doc.line(margin, y, margin + 145, y);
    doc.line(pageW - margin - 145, y, pageW - margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE.signature);
    doc.setTextColor(...MUTED);
    doc.text("Host / Representative Signature", margin + 4, y + 10);
    doc.text("Reservation Officer Signature", pageW - margin - 141, y + 10);
  }

  const fileName = `Serene-Marquee-${docType}-${bookingRef(booking)}-${clientName(booking).replace(/[^a-z0-9]+/gi, "-")}-${booking.event_date}.pdf`;
  doc.save(fileName);
}

// Back-compat alias — existing call sites can keep using this name.
export function generateAgreementPdf(
  booking: Booking,
  venues: Venue[],
  menus: Menu[],
  addons: BookingAddon[] = [],
  logoDataUri?: string
) {
  generateDocumentPdf(booking, venues, menus, addons, "Agreement", logoDataUri);
}
