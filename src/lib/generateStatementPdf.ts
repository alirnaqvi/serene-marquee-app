import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDMY, fmtDMYTime } from "./dateFormat";
import type { LedgerEntry } from "@/types";

/**
 * ACCOUNT STATEMENT
 *
 * The daily ledger laid out the way a bank statement is, for the owners and
 * the auditors: opening balance brought forward, every transaction in date
 * order with a running balance, closing balance, then totals by category and
 * space to sign.
 *
 *   Debit  = money out (expenses)
 *   Credit = money in  (income)
 *
 * The opening balance is worked out from the ledger's full history, so a
 * statement for any period carries the right figure forward.
 */

const GOLD: [number, number, number] = [138, 106, 30];
const INK: [number, number, number] = [27, 24, 16];
const MUTED: [number, number, number] = [122, 113, 92];
const CREAM: [number, number, number] = [243, 231, 190];
const SHADE: [number, number, number] = [250, 247, 238];
const LINE: [number, number, number] = [214, 205, 178];
const ROSE: [number, number, number] = [140, 59, 50];

const CATEGORY_LABELS: Record<string, string> = {
  booking_advance: "Booking advances",
  booking_payment: "Client payments",
  salary: "Salaries",
  advance: "Staff advances & loans",
  vendor: "Vendor payments",
  refund: "Refunds to clients",
};

function amount(n: number): string {
  const s = Math.round(Math.abs(n)).toLocaleString("en-PK");
  return n < 0 ? `-${s}` : s;
}

function categoryOf(e: LedgerEntry): string {
  if (e.category && CATEGORY_LABELS[e.category]) return CATEGORY_LABELS[e.category];
  return e.type === "income" ? "Other income" : "Other expenses";
}

export type StatementInput = {
  entries: LedgerEntry[];
  from: string; // ISO date, inclusive
  to: string; // ISO date, inclusive
  periodLabel: string; // "September 2026", "Week of 21-09-2026"...
  generatedBy: string; // "Syed Muhammad Saqlain Naqvi (Admin)"
  logoDataUri?: string;
};

export type StatementFigures = {
  opening: number;
  closing: number;
  credits: number;
  debits: number;
  creditCount: number;
  debitCount: number;
  rows: (LedgerEntry & { balance: number })[];
};

/** The numbers, without drawing anything — used for the on-screen preview too. */
export function statementFigures(entries: LedgerEntry[], from: string, to: string): StatementFigures {
  const sorted = [...entries].sort(
    (a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at)
  );
  let balance = 0;
  let opening = 0;
  const rows: StatementFigures["rows"] = [];
  for (const e of sorted) {
    const delta = e.type === "income" ? Number(e.amount) : -Number(e.amount);
    if (e.entry_date < from) {
      balance += delta;
      opening = balance;
      continue;
    }
    if (e.entry_date > to) break;
    balance += delta;
    rows.push({ ...e, balance });
  }
  const credits = rows.filter((r) => r.type === "income").reduce((s, r) => s + Number(r.amount), 0);
  const debits = rows.filter((r) => r.type === "expense").reduce((s, r) => s + Number(r.amount), 0);
  return {
    opening,
    closing: opening + credits - debits,
    credits,
    debits,
    creditCount: rows.filter((r) => r.type === "income").length,
    debitCount: rows.filter((r) => r.type === "expense").length,
    rows,
  };
}

export function generateStatementPdf(input: StatementInput) {
  const { from, to, periodLabel, generatedBy, logoDataUri } = input;
  const f = statementFigures(input.entries, from, to);
  const now = new Date();
  const statementNo = `SM-ST-${from.replace(/-/g, "")}-${to.replace(/-/g, "").slice(2)}`;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  let y = 40;

  // ---- Letterhead ---------------------------------------------------------
  if (logoDataUri) {
    try {
      doc.addImage(logoDataUri, "PNG", margin, y - 8, 34, 34);
    } catch {
      /* carry on without the logo */
    }
  }
  doc.setFont("times", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text("Serene Marquee", margin + 44, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("Datta Hamlet Housing Society, Abbottabad-Mansehra Road, Mansehra", margin + 44, y + 16);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...GOLD);
  doc.text("ACCOUNT STATEMENT", pageW - margin, y + 5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("Daily Ledger (Cash Book)", pageW - margin, y + 16, { align: "right" });

  y += 34;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  y += 14;

  // ---- Statement details --------------------------------------------------
  const half = (pageW - margin * 2) / 2;
  const detail = (label: string, value: string, x: number, yy: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(label, x, yy);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(value, x + 78, yy);
  };
  detail("Account", "Serene Marquee — Daily Ledger", margin, y);
  detail("Statement no.", statementNo, margin + half, y);
  y += 12;
  detail("Period", `${fmtDMY(from)} to ${fmtDMY(to)}`, margin, y);
  detail("Generated on", fmtDMYTime(now), margin + half, y);
  y += 12;
  detail("Covering", periodLabel, margin, y);
  detail("Generated by", generatedBy, margin + half, y);
  y += 12;
  detail("Currency", "Pakistani Rupees (PKR)", margin, y);
  y += 16;

  // ---- Summary box --------------------------------------------------------
  const boxW = (pageW - margin * 2) / 4;
  const cells: [string, string, string, [number, number, number]][] = [
    ["Opening balance", amount(f.opening), `as at ${fmtDMY(from)}`, INK],
    ["Money in (credits)", amount(f.credits), `${f.creditCount} transaction${f.creditCount === 1 ? "" : "s"}`, GOLD],
    ["Money out (debits)", amount(f.debits), `${f.debitCount} transaction${f.debitCount === 1 ? "" : "s"}`, ROSE],
    ["Closing balance", amount(f.closing), `as at ${fmtDMY(to)}`, INK],
  ];
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  cells.forEach(([label, value, sub, color], i) => {
    const x = margin + i * boxW;
    doc.setFillColor(...(i === 3 ? CREAM : SHADE));
    doc.rect(x, y, boxW, 44, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x + 8, y + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...color);
    doc.text(`Rs. ${value}`, x + 8, y + 27);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...MUTED);
    doc.text(sub, x + 8, y + 37);
  });
  y += 58;

  // ---- Transactions -------------------------------------------------------
  const body: any[][] = [
    [
      { content: fmtDMY(from), styles: { fontStyle: "bold" } },
      { content: "Opening balance brought forward", styles: { fontStyle: "bold" } },
      "",
      "",
      "",
      { content: amount(f.opening), styles: { fontStyle: "bold" } },
    ],
  ];
  f.rows.forEach((e) => {
    const extra = [categoryOf(e), e.handed_to ? `to ${e.handed_to}` : "", e.profiles?.full_name ? `by ${e.profiles.full_name}` : ""]
      .filter(Boolean)
      .join(" · ");
    body.push([
      fmtDMY(e.entry_date),
      `${e.description}\n${extra}`,
      e.id.slice(0, 8).toUpperCase(),
      e.type === "expense" ? amount(e.amount) : "",
      e.type === "income" ? amount(e.amount) : "",
      amount(e.balance),
    ]);
  });
  if (f.rows.length === 0) {
    body.push(["", { content: "No transactions in this period.", styles: { textColor: MUTED, fontStyle: "italic" } }, "", "", "", ""]);
  }
  body.push([
    { content: fmtDMY(to), styles: { fontStyle: "bold" } },
    { content: "Closing balance", styles: { fontStyle: "bold" } },
    "",
    { content: amount(f.debits), styles: { fontStyle: "bold" } },
    { content: amount(f.credits), styles: { fontStyle: "bold" } },
    { content: amount(f.closing), styles: { fontStyle: "bold" } },
  ]);

  autoTable(doc, {
    startY: y,
    theme: "plain",
    margin: { left: margin, right: margin, bottom: 44, top: 40 },
    head: [["Date", "Description", "Ref", "Debit (out)", "Credit (in)", "Balance"]],
    body,
    headStyles: { fillColor: CREAM, textColor: INK, fontStyle: "bold", fontSize: 7.5, cellPadding: 4 },
    styles: { fontSize: 7.4, cellPadding: { top: 3.2, bottom: 3.2, left: 4, right: 4 }, textColor: INK, valign: "top" },
    alternateRowStyles: { fillColor: SHADE },
    columnStyles: {
      0: { cellWidth: 54 },
      1: { cellWidth: "auto" },
      2: { cellWidth: 50, textColor: MUTED, fontSize: 6.6 },
      3: { cellWidth: 62, halign: "right", textColor: ROSE },
      4: { cellWidth: 62, halign: "right", textColor: GOLD },
      5: { cellWidth: 66, halign: "right", fontStyle: "bold" },
    },
    didParseCell: (data: any) => {
      // Opening and closing lines stand out from the transactions.
      if (data.section === "body" && (data.row.index === 0 || data.row.index === body.length - 1)) {
        data.cell.styles.fillColor = CREAM;
      }
    },
  });

  // @ts-ignore — attached by the plugin at runtime
  y = doc.lastAutoTable.finalY + 20;

  // ---- Totals by category -------------------------------------------------
  const byCat = new Map<string, { in: number; out: number; n: number }>();
  f.rows.forEach((e) => {
    const k = categoryOf(e);
    const cur = byCat.get(k) || { in: 0, out: 0, n: 0 };
    if (e.type === "income") cur.in += Number(e.amount);
    else cur.out += Number(e.amount);
    cur.n++;
    byCat.set(k, cur);
  });
  const catRows = Array.from(byCat.entries()).sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out));

  if (catRows.length) {
    if (y > pageH - 160) {
      doc.addPage();
      y = 48;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text("Summary by category", margin, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      theme: "grid",
      margin: { left: margin, right: margin, bottom: 44 },
      head: [["Category", "Entries", "Money in", "Money out"]],
      body: [
        ...catRows.map(([k, v]) => [k, String(v.n), v.in ? amount(v.in) : "—", v.out ? amount(v.out) : "—"]),
        [
          { content: "Total", styles: { fontStyle: "bold" } },
          { content: String(f.rows.length), styles: { fontStyle: "bold" } },
          { content: amount(f.credits), styles: { fontStyle: "bold" } },
          { content: amount(f.debits), styles: { fontStyle: "bold" } },
        ],
      ],
      headStyles: { fillColor: CREAM, textColor: INK, fontStyle: "bold", fontSize: 7.5 },
      styles: { fontSize: 7.5, cellPadding: 3.2, textColor: INK, lineColor: LINE, lineWidth: 0.4 },
      columnStyles: { 1: { halign: "right", cellWidth: 50 }, 2: { halign: "right", cellWidth: 80 }, 3: { halign: "right", cellWidth: 80 } },
    });
    // @ts-ignore
    y = doc.lastAutoTable.finalY + 16;
  }

  // ---- Reconciliation + signatures ---------------------------------------
  if (y > pageH - 110) {
    doc.addPage();
    y = 56;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `Opening ${amount(f.opening)}  +  money in ${amount(f.credits)}  -  money out ${amount(f.debits)}  =  closing ${amount(f.closing)}`,
    margin,
    y
  );
  y += 46;
  const sigW = (pageW - margin * 2 - 40) / 3;
  ["Prepared by", "Checked by", "Approved by"].forEach((label, i) => {
    const x = margin + i * (sigW + 20);
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.5);
    doc.line(x, y, x + sigW, y);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label, x, y + 10);
  });

  // ---- Footer on every page ----------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.4);
    doc.line(margin, pageH - 30, pageW - margin, pageH - 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...MUTED);
    doc.text(
      `${statementNo} · ${fmtDMY(from)} to ${fmtDMY(to)} · Computer-generated from the Serene Marquee ledger. Amounts in PKR.`,
      margin,
      pageH - 18
    );
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 18, { align: "right" });
  }

  doc.save(`Serene-Marquee-Statement-${from}-to-${to}.pdf`);
}
