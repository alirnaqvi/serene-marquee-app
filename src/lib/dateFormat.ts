// Centralized date formatting — DD-MM-YYYY everywhere a date is displayed,
// so it's never ambiguous with the US-style MM-DD-YYYY the browser's native
// date picker may show depending on the user's OS/browser locale settings.

export function fmtDMY(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

export function fmtDMYTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${day}-${month}-${year}, ${time}`;
}

export function monthYearLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
