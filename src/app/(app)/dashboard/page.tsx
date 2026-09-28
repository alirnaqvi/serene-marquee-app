import Link from "next/link";
import { CalendarClock, Wallet, TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import DiscountApprovals from "@/components/DiscountApprovals";
import DiscountHistoryCard from "@/components/DiscountHistoryCard";
import { PrivateFigures, PrivacyToggle, Masked } from "@/components/PrivateFigures";
import { chargesFromBooking, money, functionLabel } from "@/lib/calculations";
import { fetchSettings } from "@/lib/settings";
import { clientName } from "@/types";
import type { Venue, Menu } from "@/types";

// This page must never be cached/statically generated — it shows live
// booking/ledger data that changes constantly and differs per logged-in
// user (ledger visibility depends on role).
export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtDate(d: string) {
  // Parsed as UTC and printed as UTC, so the day never shifts with the server's clock.
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function statusPill(status: string) {
  const styles: Record<string, string> = {
    Confirmed: "bg-primary-dim text-gold-deep",
    Tentative: "bg-gold-light text-[#8A6427]",
    Cancelled: "bg-rose-light text-rose",
    Draft: "bg-bg text-muted border border-dashed border-border",
  };
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold ${styles[status] || ""}`}>
      {status}
    </span>
  );
}

function StatCard({
  href,
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  sensitive = false,
}: {
  href: string;
  label: string;
  value: string | number;
  hint: string;
  icon: any;
  tone?: "primary" | "gold" | "rose";
  /** Money figures are masked until the reader chooses to show them. */
  sensitive?: boolean;
}) {
  const toneClasses = {
    primary: "text-primary bg-primary-dim",
    gold: "text-gold-deep bg-gold-light",
    rose: "text-rose bg-rose-light",
  }[tone];
  return (
    <Link href={href} className="card card-hover flex flex-col justify-between">
      <div className="flex items-start justify-between">
        <div className="text-[11.5px] text-muted uppercase font-semibold tracking-wide">{label}</div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${toneClasses}`}>
          <Icon size={15} strokeWidth={2.2} />
        </div>
      </div>
      <div className="text-[26px] font-bold font-serif text-primary mt-2 leading-none">
        {sensitive ? <Masked>{value}</Masked> : value}
      </div>
      <div className="text-[11.5px] text-muted mt-2 flex items-center gap-1 group">
        {hint}
        <ArrowUpRight size={11} className="opacity-60" />
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  let role: string | null = null;
  let canViewLedgerFlag = false;
  if (user) {
    const { data: me } = await supabase.from("profiles").select("role, can_view_ledger").eq("id", user.id).single();
    role = me?.role ?? null;
    canViewLedgerFlag = me?.can_view_ledger ?? false;
  }
  const isGeneralManager = role === "general_manager";
  const hasLedgerAccess =
    role === "owner" || role === "admin" || role === "manager" || (!!canViewLedgerFlag && !isGeneralManager);

  const settings = await fetchSettings(supabase);

  // Staff waiting on a password reset. Only the people who can act see this.
  let resetRequests = 0;
  if (role === "admin" || role === "developer") {
    const { count } = await supabase
      .from("password_reset_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    resetRequests = count || 0;
  }

  const [{ data: venues }, { data: menus }, { data: bookings }] = await Promise.all([
    supabase.from("venues").select("*"),
    supabase.from("menus").select("*"),
    supabase
      .from("bookings")
      .select(
        "id, booking_number, venues, title, client, phone, event_date, session, guests, status, function_type, function_type_other, is_custom_menu, per_head_rate, extras_total, menu_id, discount, decoration, cooling, heaters, advance, payments_total"
      )
      .order("event_date", { ascending: true }),
  ]);

  const { data: ledger } = hasLedgerAccess
    ? await supabase.from("ledger_entries").select("type, amount")
    : { data: null as { type: string; amount: number }[] | null };

  // The server runs on UTC; the office is in Pakistan. Work out "today" and
  // "this month" on Pakistan time so the list doesn't flip over at 5 a.m.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
  const [yy, mm] = today.split("-").map(Number);
  const monthEnd = `${today.slice(0, 7)}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
  const monthLabel = new Date(yy, mm - 1, 1).toLocaleDateString("en-GB", { month: "long" });
  const monthYearLabel = new Date(yy, mm - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  // Drafts are half-filled forms, not bookings: they hold no date and count
  // towards no figure until they are properly saved.
  const activeBookings = (bookings || []).filter(
    (b: any) => b.status !== "Cancelled" && b.status !== "Draft"
  );
  // Every booking from today to the last day of this month, in date order.
  const upcoming = activeBookings
    .filter((b: any) => b.event_date >= today && b.event_date <= monthEnd)
    .sort(
      (a: any, b: any) =>
        a.event_date.localeCompare(b.event_date) || (a.session === "Lunch" ? -1 : 1) - (b.session === "Lunch" ? -1 : 1)
    );
  const totalDue = activeBookings.reduce(
    (sum: number, b: any) => sum + chargesFromBooking(b, venues as Venue[], menus as Menu[], settings).balance,
    0
  );
  const income = (ledger || []).filter((l: any) => l.type === "income").reduce((s: number, l: any) => s + l.amount, 0);
  const expense = (ledger || []).filter((l: any) => l.type === "expense").reduce((s: number, l: any) => s + l.amount, 0);

  return (
    <PrivateFigures>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Dashboard</div>
          <div className="text-xs text-muted mt-0.5">Overview across all three venues</div>
        </div>
        {hasLedgerAccess && <PrivacyToggle className="mt-1 shrink-0" />}
      </div>

      {/* Renders nothing unless there is a discount request to act on, or a
          decision on one of this person's own requests. */}
      {resetRequests > 0 && (
        <Link
          href="/admin/staff"
          className="mt-5 flex items-center justify-between gap-3 rounded-xl2 border border-gold/40 bg-gold-light px-4 sm:px-5 py-3 hover:brightness-[0.98]"
        >
          <span className="text-[13px] font-bold text-gold-deep">
            {resetRequests} staff member{resetRequests === 1 ? " is" : "s are"} waiting for a password reset
          </span>
          <span className="text-[11.5px] font-bold text-gold-deep flex items-center gap-1 whitespace-nowrap">
            Open Staff & Access <ArrowUpRight size={12} />
          </span>
        </Link>
      )}

      <div className="mt-5">
        <DiscountApprovals />
      </div>

      <div
        className={`grid ${hasLedgerAccess ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 max-w-lg"} gap-3 sm:gap-4 mt-5 mb-5 stagger`}
      >
        <StatCard
          href="/calendar"
          label={`Upcoming in ${monthLabel}`}
          value={upcoming.length}
          hint={`Rest of ${monthLabel} · View calendar`}
          icon={CalendarClock}
          tone="primary"
        />
        {/* Pending / approved / declined discount requests — the whole history
            is one tap away. */}
        <DiscountHistoryCard />
        {hasLedgerAccess && (
          <>
            <StatCard
              href="/bookings"
              label="Pending Dues"
              value={money(totalDue)}
              hint="View bookings"
              icon={Wallet}
              tone="primary"
              sensitive
            />
            <StatCard
              href="/ledger"
              label="Income (Total)"
              value={money(income)}
              hint="View ledger"
              icon={TrendingUp}
              tone="gold"
              sensitive
            />
            <StatCard
              href="/ledger"
              label="Expense (Total)"
              value={money(expense)}
              hint="View ledger"
              icon={TrendingDown}
              tone="rose"
              sensitive
            />
          </>
        )}
      </div>

      <div className="card fade-up">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[14.5px] font-bold text-primary">
              Upcoming bookings for the month of {monthLabel}
            </div>
            <div className="text-[11.5px] text-muted mt-0.5">
              {upcoming.length === 0
                ? `Nothing booked from today to the end of ${monthYearLabel}.`
                : `${upcoming.length} function${upcoming.length === 1 ? "" : "s"} from today to the end of ${monthYearLabel}`}
            </div>
          </div>
          <Link href="/calendar" className="text-xs font-bold text-gold-deep hover:underline flex items-center gap-1">
            Open Calendar <ArrowUpRight size={12} />
          </Link>
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[13px] min-w-[760px]">
            <thead>
              <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
                <th className="py-2 px-2">Date</th>
                <th className="py-2 px-2">Venue</th>
                <th className="py-2 px-2">Time</th>
                <th className="py-2 px-2">Client</th>
                <th className="py-2 px-2">Function</th>
                <th className="py-2 px-2">Guests</th>
                <th className="py-2 px-2">Status</th>
                <th className="py-2 px-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted text-sm">
                    No more bookings this month
                  </td>
                </tr>
              )}
              {upcoming.map((b: any) => {
                const t = chargesFromBooking(b, venues as Venue[], menus as Menu[], settings);
                return (
                  <tr key={b.id} className="border-b border-border last:border-0 hover:bg-[#FBF8ED]">
                    <td className="py-2.5 px-2">
                      <Link href={`/bookings/${b.id}`} className="hover:underline font-medium">
                        {fmtDate(b.event_date)}
                      </Link>
                      {b.event_date === today && (
                        <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-gold-light text-gold-deep">
                          Today
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2">
                      {(b.venues || [])
                        .map((id: string) => (venues as Venue[])?.find((v) => v.id === id)?.name)
                        .filter(Boolean)
                        .join(" + ") || "—"}
                    </td>
                    <td className="py-2.5 px-2 whitespace-nowrap">{b.session}</td>
                    <td className="py-2.5 px-2">{clientName(b)}</td>
                    <td className="py-2.5 px-2">{functionLabel(b)}</td>
                    <td className="py-2.5 px-2">{b.guests}</td>
                    <td className="py-2.5 px-2">{statusPill(b.status)}</td>
                    <td className="py-2.5 px-2 font-semibold">{money(t.balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PrivateFigures>
  );
}
