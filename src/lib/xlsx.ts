// Real .xlsx generation in the browser.
//
// An .xlsx file is a zip of XML parts, so this builds those parts directly and
// zips them with fflate (~8KB) rather than pulling in a full spreadsheet
// library. The output opens natively in Excel, LibreOffice and Google Sheets,
// with real numeric cells — so totals, sorting and filtering all work, which
// is the whole point of asking for xlsx over csv.

import { zipSync, strToU8 } from "fflate";

export type CellValue = string | number | null | undefined;

export type SheetColumn<T> = {
  header: string;
  value: (row: T) => CellValue;
  /** Column width in characters. Defaults to something sensible per header. */
  width?: number;
  /** Render as a Rs. amount with thousands separators. */
  money?: boolean;
};

export type SheetSpec<T> = {
  name: string;
  columns: SheetColumn<T>[];
  rows: T[];
  /** Bold lines printed above the header row (title, period, totals…). */
  titleLines?: string[];
  /** Bold summary line appended under the table. */
  totalsRow?: CellValue[];
};

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Excel rejects most control characters outright.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/** 0 -> A, 25 -> Z, 26 -> AA */
function colLetter(index: number): string {
  let s = "";
  let i = index;
  while (i >= 0) {
    s = String.fromCharCode((i % 26) + 65) + s;
    i = Math.floor(i / 26) - 1;
  }
  return s;
}

function isNumeric(v: CellValue): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Style indices defined in styles.xml below.
const STYLE_DEFAULT = 0;
const STYLE_TITLE = 1;
const STYLE_HEADER = 2;
const STYLE_MONEY = 3;
const STYLE_TOTAL = 4;
const STYLE_TOTAL_MONEY = 5;

function cellXml(ref: string, value: CellValue, style: number): string {
  if (value === null || value === undefined || value === "") {
    return style ? `<c r="${ref}" s="${style}"/>` : "";
  }
  const s = style ? ` s="${style}"` : "";
  if (isNumeric(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

function buildSheet<T>(spec: SheetSpec<T>): string {
  const { columns, rows, titleLines = [], totalsRow } = spec;
  const lines: string[] = [];
  let r = 0;

  // Title block
  titleLines.forEach((line) => {
    r++;
    lines.push(`<row r="${r}">${cellXml(`A${r}`, line, STYLE_TITLE)}</row>`);
  });
  if (titleLines.length) r++; // blank spacer row

  // Header
  r++;
  const headerRow = r;
  lines.push(
    `<row r="${r}">` +
      columns.map((c, i) => cellXml(`${colLetter(i)}${r}`, c.header, STYLE_HEADER)).join("") +
      `</row>`
  );

  // Body
  rows.forEach((row) => {
    r++;
    lines.push(
      `<row r="${r}">` +
        columns
          .map((c, i) => {
            const v = c.value(row);
            const style = c.money && isNumeric(v) ? STYLE_MONEY : STYLE_DEFAULT;
            return cellXml(`${colLetter(i)}${r}`, v, style);
          })
          .join("") +
        `</row>`
    );
  });

  // Totals
  if (totalsRow) {
    r++;
    lines.push(
      `<row r="${r}">` +
        totalsRow
          .map((v, i) =>
            cellXml(
              `${colLetter(i)}${r}`,
              v,
              isNumeric(v) && columns[i]?.money ? STYLE_TOTAL_MONEY : STYLE_TOTAL
            )
          )
          .join("") +
        `</row>`
    );
  }

  const cols = columns
    .map(
      (c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${
          c.width ?? Math.min(42, Math.max(11, c.header.length + 4))
        }" customWidth="1"/>`
    )
    .join("");

  const lastCol = colLetter(Math.max(0, columns.length - 1));
  const autoFilter = rows.length
    ? `<autoFilter ref="A${headerRow}:${lastCol}${headerRow + rows.length}"/>`
    : "";
  const freeze =
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${
      headerRow + 1
    }" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<cols>${cols}</cols><sheetData>${lines.join(
    ""
  )}</sheetData>${autoFilter}</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><color rgb="FF6B4E12"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3E8C4"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFC9B57B"/></left><right style="thin"><color rgb="FFC9B57B"/></right><top style="thin"><color rgb="FFC9B57B"/></top><bottom style="thin"><color rgb="FFC9B57B"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
<tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars. */
function safeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[:\\\/\?\*\[\]]/g, "-").slice(0, 31).trim();
  return cleaned || `Sheet${index + 1}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Build and download a real .xlsx workbook. Pass one sheet spec or several
 * (e.g. a vendor summary sheet plus a sheet per vendor).
 */
export function downloadXlsx(filename: string, sheets: SheetSpec<any>[]) {
  const names = sheets.map((s, i) => safeSheetName(s.name, i));

  const files: Record<string, Uint8Array> = {};

  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )
  .join("")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
  );

  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
  );

  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names
      .map((nm, i) => `<sheet name="${esc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets>
</workbook>`
  );

  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
        i + 1
      }.xml"/>`
  )
  .join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  );

  files["xl/styles.xml"] = strToU8(STYLES_XML);

  sheets.forEach((spec, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(buildSheet(spec));
  });

  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer so the Blob is safe across bundler targets.
  const bytes = new Uint8Array(zipped);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

// ---------------------------------------------------------------------------
// Shared date/month helpers used by the export screens
// ---------------------------------------------------------------------------

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

/** First and last day of a 'YYYY-MM' month, as ISO date strings. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
