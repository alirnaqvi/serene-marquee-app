// Month-end exports for the daily ledger.
//
// Both formats are produced in the browser with no extra dependency:
//   - CSV  : plain comma-separated text with a UTF-8 BOM so Excel opens the
//            Rs. / اردو characters correctly instead of as mojibake.
//   - Excel: an HTML table saved with the .xls extension and Excel's MIME
//            type. Excel and LibreOffice both open this natively and keep the
//            column layout, which is all the office needs for a monthly file.

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number;
};

function escapeCsv(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escapeHtml(value: string | number): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv<T>(
  filename: string,
  columns: ExportColumn<T>[],
  rows: T[],
  titleLines: string[] = []
) {
  const lines: string[] = [];
  titleLines.forEach((line) => lines.push(escapeCsv(line)));
  if (titleLines.length) lines.push("");
  lines.push(columns.map((c) => escapeCsv(c.header)).join(","));
  rows.forEach((row) => lines.push(columns.map((c) => escapeCsv(c.value(row))).join(",")));

  // \uFEFF = UTF-8 byte order mark, so Excel doesn't mangle non-ASCII text.
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export function downloadExcel<T>(
  filename: string,
  columns: ExportColumn<T>[],
  rows: T[],
  titleLines: string[] = []
) {
  const head = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        "<tr>" +
        columns.map((c) => `<td>${escapeHtml(c.value(row))}</td>`).join("") +
        "</tr>"
    )
    .join("");
  const title = titleLines
    .map((line) => `<tr><td colspan="${columns.length}"><b>${escapeHtml(line)}</b></td></tr>`)
    .join("");

  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8" />
<style>
  table { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
  th { background: #F3E8C4; border: 1px solid #C9B57B; padding: 5px 8px; text-align: left; }
  td { border: 1px solid #DDD5BC; padding: 4px 8px; }
</style></head>
<body><table>${title}${title ? `<tr><td colspan="${columns.length}"></td></tr>` : ""}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;

  const blob = new Blob(["\uFEFF" + html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".xls") ? filename : `${filename}.xls`);
}

/** 'YYYY-MM' -> 'August 2026' */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Current month as 'YYYY-MM'. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** The last `count` months, newest first, as 'YYYY-MM' strings. */
export function recentMonths(count = 18): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
