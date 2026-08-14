import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { chargesFromBooking, money, functionLabel, effectiveMenuItems } from "./calculations";
import { SESSION_TIMES, ENTRY_TEST_RATE } from "./constants";
import { fmtDMY, fmtDMYTime } from "./dateFormat";
import { bookingRef } from "@/types";
import type { Booking, Venue, Menu, BookingAddon } from "@/types";

const GOLD: [number, number, number] = [138, 106, 30];
const INK: [number, number, number] = [27, 24, 16];
const MUTED: [number, number, number] = [122, 113, 92];
const DARK: [number, number, number] = [20, 18, 16];
const CREAM: [number, number, number] = [243, 231, 190];

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
  logoDataUri?: string
) {
  const cfg = DOC_CONFIG[docType];
  const menu = menus.find((m) => m.id === booking.menu_id);
  const venueList = booking.venues.map((id) => venues.find((v) => v.id === id)).filter((v): v is Venue => Boolean(v));
  const t = chargesFromBooking(booking, venues, menus);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 42;
  let y = 46;

  if (logoDataUri) {
    try {
      doc.addImage(logoDataUri, "PNG", margin, y - 14, 46, 46);
    } catch {
      /* ignore image failures, keep generating the rest of the PDF */
    }
  }
  doc.setFont("times", "bold");
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  doc.text("Serene Marquee", margin + 58, y + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text("Datta Hamlet Housing Society, Abbottabad-Mansehra Road, Mansehra", margin + 58, y + 17);
  doc.text(`Ref ${bookingRef(booking)}`, margin + 58, y + 29);

  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`PDF generated: ${fmtDMYTime(new Date())}`, pageW - margin, y, { align: "right" });

  y += 48;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.1);
  doc.line(margin, y, pageW - margin, y);
  y += 26;

  // The document type (Agreement / Invoice / Quotation) is the single most
  // important thing on the page for the reader to identify at a glance, so
  // it gets its own large, bold, centered heading — not buried in small
  // print next to the reference number.
  doc.setFont("times", "bold");
  doc.setFontSize(23);
  doc.setTextColor(...GOLD);
  doc.text(cfg.heading.toUpperCase(), pageW / 2, y, { align: "center" });
  y += 9;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.9);
  doc.line(pageW / 2 - 64, y, pageW / 2 + 64, y);
  y += 18;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const subLines = doc.splitTextToSize(cfg.subheading, pageW - margin * 2);
  doc.text(subLines, margin, y);
  y += subLines.length * 10 + 8;

  const contactLine = booking.phone2 ? `${booking.phone || "-"}  /  ${booking.phone2}` : booking.phone || "-";
  const isEntryTest = booking.function_type === "Entry Test";
  const menuLine = isEntryTest
    ? `${money(ENTRY_TEST_RATE)} / head — no menu (Entry Test)`
    : booking.is_custom_menu
    ? "Customized Menu — see itemized list below"
    : menu
    ? `${menu.name} — ${effectiveMenuItems(menu.items, booking.removed_menu_items).join(", ")}`
    : "-";

  const details: [string, string][] = [
    ["Booking Reference", bookingRef(booking)],
    ["Host / Organization", booking.client],
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
  details.push(["Filer Status", booking.filer]);
  if (docType !== "Quotation") details.push(["Status", booking.status]);
  if (docType === "Agreement") details.push(["Booking Recorded On", fmtDMYTime(new Date(booking.created_at))]);

  autoTable(doc, {
    startY: y,
    theme: "plain",
    margin: { left: margin, right: margin },
    styles: { fontSize: 9.5, cellPadding: { top: 3.5, bottom: 3.5, left: 0, right: 6 }, textColor: INK },
    columnStyles: { 0: { fontStyle: "bold", textColor: GOLD, cellWidth: 150 }, 1: { halign: "left" } },
    body: details,
  });

  // @ts-ignore - lastAutoTable is attached by the plugin at runtime
  y = doc.lastAutoTable.finalY + 18;

  // Itemized add-ons / customized menu list, if any were selected — shown on
  // every document type so the exact menu makeup is always visible on paper.
  if (isEntryTest) {
    // No menu to itemize — Entry Test bookings are a flat per-head fee.
  } else if (addons.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...DARK);
    doc.text(booking.is_custom_menu ? "Customized Menu Items" : "Extra Items Added to Menu", margin, y);
    y += 8;

    autoTable(doc, {
      startY: y,
      theme: "grid",
      margin: { left: margin, right: margin },
      headStyles: { fillColor: DARK, textColor: CREAM, fontStyle: "bold", fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 4.5, textColor: INK, lineColor: [231, 224, 201], lineWidth: 0.5 },
      head: [["Item", "Unit Price", "Qty", "Line Total"]],
      body: addons.map((a) => [a.name, money(a.unit_price), String(a.quantity), money(a.line_total)]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    });
    // @ts-ignore
    y = doc.lastAutoTable.finalY + 18;
  } else if (!booking.is_custom_menu && menu) {
    // No add-ons selected — still print the fixed menu's included items
    // (minus anything removed from this booking) so every document shows
    // exactly what's being served, not just the menu's name.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text("Menu Items Included", margin, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(60, 55, 45);
    const menuItemLines = doc.splitTextToSize(effectiveMenuItems(menu.items, booking.removed_menu_items).join(", "), pageW - margin * 2);
    doc.text(menuItemLines, margin, y);
    y += menuItemLines.length * 10 + 14;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text("Charges", margin, y);
  y += 8;

  const foodLabel = isEntryTest
    ? `Entry Test Fee (${booking.guests} x ${money(ENTRY_TEST_RATE)})`
    : booking.is_custom_menu
    ? "Customized Menu Total"
    : t.addonsTotal > 0
    ? `Food Subtotal (${booking.guests} x ${money((menu?.rate || 0))}, incl. extra items)`
    : `Food Subtotal (${booking.guests} x ${money(menu?.rate || 0)})`;

  const charges: [string, string, string][] = [
    [foodLabel, "", money(t.foodSubtotal)],
    ["KPRA Tax", "15%", "+ " + money(t.kprTax)],
    ["Hall Charge", t.hallCharge ? (venueList.length > 1 ? "Both halls" : "Applied") : "Waived (200+ guests)", "+ " + money(t.hallCharge)],
    ["Decoration", "", "+ " + money(t.decoration)],
    ["Cooling", booking.cooling ? "Yes" : "No", "+ " + money(t.coolingCharge)],
    ["Heating", `${booking.heaters} heater(s)`, "+ " + money(t.heatingCharge)],
    ["Income Tax", `${booking.filer}, ${t.incomeTaxRate * 100}%`, "+ " + money(t.incomeTax)],
    ["Total (before discount)", "", money(t.totalBeforeDiscount)],
    ["Discount", "", "- " + money(t.discountAmount)],
  ];
  if (docType !== "Quotation") {
    charges.push(["Advance Paid", "", "- " + money(booking.advance)]);
  }

  autoTable(doc, {
    startY: y,
    theme: "grid",
    margin: { left: margin, right: margin },
    headStyles: { fillColor: DARK, textColor: CREAM, fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 5, textColor: INK, lineColor: [231, 224, 201], lineWidth: 0.5 },
    head: [["Item", "Detail", "Amount"]],
    body: charges,
    columnStyles: { 1: { halign: "left" }, 2: { halign: "right" } },
  });

  // @ts-ignore
  y = doc.lastAutoTable.finalY + 12;

  doc.setFillColor(...DARK);
  doc.rect(margin, y, pageW - margin * 2, 32, "F");
  doc.setTextColor(...CREAM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.text(docType === "Quotation" ? "Estimated Total" : "Balance Due", margin + 12, y + 21);
  doc.text(money(docType === "Quotation" ? t.grandTotal : t.balance), pageW - margin - 12, y + 21, { align: "right" });
  y += 50;

  if (booking.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text("Special Instructions", margin, y);
    y += 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60, 55, 45);
    const split = doc.splitTextToSize(booking.notes, pageW - margin * 2);
    doc.text(split, margin, y);
    y += split.length * 11 + 12;
  }

  if (cfg.showTerms) {
    if (y > pageH - 220) {
      doc.addPage();
      y = 50;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text("Terms & Conditions", margin, y);
    y += 13;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    TERMS.forEach((term, i) => {
      const lines = doc.splitTextToSize(`${i + 1}. ${term}`, pageW - margin * 2);
      if (y + lines.length * 9.5 > pageH - 70) {
        doc.addPage();
        y = 50;
      }
      doc.text(lines, margin, y);
      y += lines.length * 9.5 + 4;
    });
  }

  if (cfg.showSignatures) {
    y += 34;
    if (y > pageH - 60) {
      doc.addPage();
      y = 70;
    }
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.7);
    doc.line(margin, y, margin + 160, y);
    doc.line(pageW - margin - 160, y, pageW - margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Host / Representative Signature", margin + 6, y + 12);
    doc.text("Reservation Officer Signature", pageW - margin - 154, y + 12);
  }

  const fileName = `Serene-Marquee-${docType}-${bookingRef(booking)}-${booking.client.replace(/[^a-z0-9]+/gi, "-")}-${booking.event_date}.pdf`;
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
