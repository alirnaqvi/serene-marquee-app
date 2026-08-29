import Link from "next/link";
import { CalendarClock, Wallet, TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { chargesFromBooking, money, functionLabel } from "@/lib/calculations";
import { clientName } from "@/types";
import type { Venue, Menu } from "@/types";

// This page must never be cached/statically generated — it shows live
// booking/ledger data that changes constantly and differs per logged-in
// user (ledger visibility depends on role).
export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function statusPill(status: string) {
  const styles: Record<string, string> = {
    Confirmed: "bg-primary-dim text-gold-deep",
    Tentative: "bg-gold-light text-[#8A6427]",
    Cancelled: "bg-rose-light text-rose",
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
}: {
  href: string;
  label: string;
  value: string | number;
  hint: string;
  icon: any;
  tone?: "primary" | "gold" | "rose";
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
      <div className="text-[26px] font-bold font-serif text-primary mt-2 leading-none">{value}</div>
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

  const [{ data: venues }, { data: menus }, { data: bookings }] = await Promise.all([
    supabase.from("venues").select("*"),
    supabase.from("menus").select("*"),
    supabase
      .from("bookings")
      .select(
        "id, booking_number, venues, client, event_date, session, guests, status, function_type, function_type_other, is_custom_menu, custom_menu_total, addons_total, menu_id, discount, decoration, cooling, heaters, advance, filer"
      )
      .order("event_date", { ascending: true }),
  ]);

  const { data: ledger } = hasLedgerAccess
    ? await supabase.from("ledger_entries").select("type, amount")
    : { data: null as { type: string; amount: number }[] | null };

  const today = new Date().toISOString().slice(0, 10);
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  const in30DaysStr = in30Days.toISOString().slice(0, 10);

  const activeBookings = (bookings || []).filter((b: any) => b.status !== "Cancelled");
  const upcomingWithin30Days = activeBookings.filter(
    (b: any) => b.event_date >= today && b.event_date <= in30DaysStr
  );
  const upcoming = activeBookings.filter((b: any) => b.event_date >= today).slice(0, 8);
  const totalDue = activeBookings.reduce(
    (sum: number, b: any) => sum + chargesFromBooking(b, venues as Venue[], menus as Menu[]).balance,
    0
  );
  const income = (ledger || []).filter((l: any) => l.type === "income").reduce((s: number, l: any) => s + l.amount, 0);
  const expense = (ledger || []).filter((l: any) => l.type === "expense").reduce((s: number, l: any) => s + l.amount, 0);

  return (
    <div>
      <div className="mb-2">
        <div className="text-xl font-bold font-serif text-primary">Dashboard</div>
        <div className="text-xs text-muted mt-0.5">Overview across all three venues</div>
      </div>

      <div
        className={`grid ${hasLedgerAccess ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 max-w-xs"} gap-3 sm:gap-4 mt-5 mb-5 stagger`}
      >
        <StatCard
          href="/calendar"
          label="Upcoming Functions"
          value={upcomingWithin30Days.length}
          hint="Next 30 days · View calendar"
          icon={CalendarClock}
          tone="primary"
        />
        {hasLedgerAccess && (
          <>
            <StatCard
              href="/bookings"
              label="Pending Dues"
              value={money(totalDue)}
              hint="View bookings"
              icon={Wallet}
              tone="primary"
            />
            <StatCard href="/ledger" label="Income (Total)" value={money(income)} hint="View ledger" icon={TrendingUp} tone="gold" />
            <StatCard href="/ledger" label="Expense (Total)" value={money(expense)} hint="View ledger" icon={TrendingDown} tone="rose" />
          </>
        )}
      </div>

      <div className="card fade-up">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[14.5px] font-bold text-primary">Next Functions</div>
          <Link href="/calendar" className="text-xs font-bold text-gold-deep hover:underline flex items-center gap-1">
            Open Calendar <ArrowUpRight size={12} />
          </Link>
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[13px] min-w-[560px]">
            <thead>
              <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
                <th className="py-2 px-2">Date</th>
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
                  <td colSpan={6} className="text-center py-8 text-muted text-sm">
                    No upcoming functions
                  </td>
                </tr>
              )}
              {upcoming.map((b: any) => {
                const t = chargesFromBooking(b, venues as Venue[], menus as Menu[]);
                return (
                  <tr key={b.id} className="border-b border-border last:border-0 hover:bg-[#FBF8ED]">
                    <td className="py-2.5 px-2">
                      <Link href={`/bookings/${b.id}`} className="hover:underline font-medium">
                        {fmtDate(b.event_date)}
                      </Link>
                      <br />
                      <span className="text-[11px] text-muted">{b.session}</span>
                    </td>
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
    </div>
  );
}
