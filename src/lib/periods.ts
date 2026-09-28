import { fmtDMY } from "./dateFormat";

/** Ready-made statement periods, worked out from today's date. */
export type PeriodId =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "last_year"
  | "this_fy"
  | "last_fy"
  | "custom";

export const PERIOD_OPTIONS: { id: PeriodId; label: string }[] = [
  { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "this_quarter", label: "This quarter" },
  { id: "last_quarter", label: "Last quarter" },
  { id: "this_year", label: "This year (Jan–Dec)" },
  { id: "last_year", label: "Last year (Jan–Dec)" },
  { id: "this_fy", label: "This financial year (Jul–Jun)" },
  { id: "last_fy", label: "Last financial year (Jul–Jun)" },
  { id: "custom", label: "Custom dates…" },
];

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const monthLabel = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** { from, to, label } for a preset. Weeks run Monday to Sunday. */
export function periodRange(id: PeriodId, today = new Date()): { from: string; to: string; label: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (id) {
    case "this_week":
    case "last_week": {
      const monday = new Date(y, m, today.getDate() - ((today.getDay() + 6) % 7) - (id === "last_week" ? 7 : 0));
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      return { from: iso(monday), to: iso(sunday), label: `Week of ${fmtDMY(iso(monday))}` };
    }
    case "this_month":
    case "last_month": {
      const first = new Date(y, m - (id === "last_month" ? 1 : 0), 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
      return { from: iso(first), to: iso(last), label: monthLabel(first) };
    }
    case "this_quarter":
    case "last_quarter": {
      const q = Math.floor(m / 3) - (id === "last_quarter" ? 1 : 0);
      const first = new Date(y, q * 3, 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 3, 0);
      return {
        from: iso(first),
        to: iso(last),
        label: `Q${Math.floor(first.getMonth() / 3) + 1} ${first.getFullYear()} (${first.toLocaleDateString("en-GB", { month: "short" })}–${last.toLocaleDateString("en-GB", { month: "short" })})`,
      };
    }
    case "this_year":
    case "last_year": {
      const yr = y - (id === "last_year" ? 1 : 0);
      return { from: `${yr}-01-01`, to: `${yr}-12-31`, label: `Year ${yr}` };
    }
    case "this_fy":
    case "last_fy": {
      // Pakistan's financial year runs 1 July to 30 June.
      const start = (m >= 6 ? y : y - 1) - (id === "last_fy" ? 1 : 0);
      return { from: `${start}-07-01`, to: `${start + 1}-06-30`, label: `Financial year ${start}–${String(start + 1).slice(2)}` };
    }
    default:
      return { from: iso(new Date(y, m, 1)), to: iso(today), label: "Custom period" };
  }
}
