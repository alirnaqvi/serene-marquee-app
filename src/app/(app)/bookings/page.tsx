"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { chargesFromBooking, money, functionLabel } from "@/lib/calculations";
import { fmtDMY } from "@/lib/dateFormat";
import { useSession } from "@/components/SessionContext";
import { downloadXlsx, monthName, currentMonth, recentMonths, monthBounds, type SheetColumn } from "@/lib/xlsx";
import { bookingRef, clientName } from "@/types";
import type { Booking, Venue, Menu } from "@/types";

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "rose";
}) {
  return (
    <div className="bg-bg border border-border rounded-lg px-3 py-2.5">
      <div className="text-[10.5px] text-muted uppercase font-semibold tracking-wide">{label}</div>
      <div className={`text-[15px] font-bold font-serif mt-1 ${tone === "rose" ? "text-rose" : "text-primary"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

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

// Strip everything except digits so "SM-000123", "sm 123" and "123" all match
// booking number 123.
function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

export default function BookingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { readOnly } = useSession();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [search, setSearch] = useState("");
  // Dates use real calendar pickers, so nobody has to guess whether to type
  // 09-12-2026 or 12-09-2026. A range covers both "one day" (set both to the
  // same date) and "this month" (the month buttons fill both in).
  const [dateFrom, setDateFrom] = useState(searchParams.get("date") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("date") || "");
  const [statusFilter, setStatusFilter] = useState<"all" | "Confirmed" | "Tentative" | "Cancelled">("all");

  useEffect(() => {
    async function load() {
      const [{ data: v }, { data: m }, { data: b }] = await Promise.all([
        supabase.from("venues").select("*"),
        supabase.from("menus").select("*"),
        supabase.from("bookings").select("*").order("event_date"),
      ]);
      setVenues(v || []);
      setMenus(m || []);
      setBookings(b || []);
    }
    load();

    const channel = supabase
      .channel("bookings-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const venueNames = (b: Booking) => b.venues.map((id) => venues.find((v) => v.id === id)?.name).filter(Boolean).join(" + ");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = digitsOnly(q);

    return bookings.filter((b) => {
      if (dateFrom && b.event_date < dateFrom) return false;
      if (dateTo && b.event_date > dateTo) return false;
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (!q) return true;

      // Client name
      if (clientName(b).toLowerCase().includes(q)) return true;
      // Order / booking number — matches "SM-000123", "123", or the raw ref
      if (bookingRef(b).toLowerCase().includes(q)) return true;
      if (qDigits && b.booking_number && String(b.booking_number).includes(qDigits)) return true;
      // Phone is a handy extra when someone calls in about their booking
      if (qDigits.length >= 4 && (b.phone || "").replace(/\D/g, "").includes(qDigits)) return true;

      return false;
    });
  }, [bookings, search, dateFrom, dateTo, statusFilter]);

  const filtering = Boolean(search.trim() || dateFrom || dateTo || statusFilter !== "all");

  // Summary over whatever is currently filtered — so "this month" and "1 Sep
  // to 15 Sep" both produce a total without a separate report screen.
  const summary = useMemo(() => {
    const live = rows.filter((b) => b.status !== "Cancelled");
    const acc = {
      count: rows.length,
      confirmed: rows.filter((b) => b.status === "Confirmed").length,
      tentative: rows.filter((b) => b.status === "Tentative").length,
      cancelled: rows.filter((b) => b.status === "Cancelled").length,
      guests: 0,
      gross: 0,
      discount: 0,
      advance: 0,
      balance: 0,
      refunded: 0,
    };
    live.forEach((b) => {
      const t = chargesFromBooking(b, venues, menus);
      acc.guests += b.guests;
      acc.gross += t.grandTotal;
      acc.discount += t.discountAmount;
      acc.advance += b.advance;
      acc.balance += t.balance;
    });
    rows.filter((b) => b.advance_refunded).forEach((b) => {
      acc.refunded += b.refund_amount;
    });
    return acc;
  }, [rows, venues, menus]);

  function setMonthRange(month: string) {
    const { from, to } = monthBounds(month);
    setDateFrom(from);
    setDateTo(to);
  }

  const rangeLabel = dateFrom && dateTo
    ? dateFrom === dateTo
      ? fmtDMY(dateFrom)
      : `${fmtDMY(dateFrom)} – ${fmtDMY(dateTo)}`
    : dateFrom
    ? `From ${fmtDMY(dateFrom)}`
    : dateTo
    ? `Up to ${fmtDMY(dateTo)}`
    : "All dates";

  const exportColumns: SheetColumn<Booking>[] = [
    { header: "Ref", value: (b) => bookingRef(b) },
    { header: "Function Date", value: (b) => fmtDMY(b.event_date) },
    { header: "Session", value: (b) => b.session },
    { header: "Client", value: (b) => clientName(b), width: 24 },
    { header: "Phone", value: (b) => b.phone || "", width: 16 },
    { header: "Venue(s)", value: (b) => venueNames(b), width: 22 },
    { header: "Function", value: (b) => functionLabel(b), width: 18 },
    { header: "Guests", value: (b) => b.guests },
    { header: "Food Subtotal", value: (b) => Math.round(chargesFromBooking(b, venues, menus).foodSubtotal), money: true },
    { header: "Discount", value: (b) => Math.round(chargesFromBooking(b, venues, menus).discountAmount), money: true },
    { header: "Grand Total", value: (b) => Math.round(chargesFromBooking(b, venues, menus).grandTotal), money: true },
    { header: "Advance", value: (b) => Math.round(b.advance), money: true },
    { header: "Refunded", value: (b) => Math.round(b.advance_refunded ? b.refund_amount : 0), money: true },
    { header: "Balance", value: (b) => Math.round(chargesFromBooking(b, venues, menus).balance), money: true },
    { header: "Status", value: (b) => b.status },
  ];

  function handleExport() {
    const stamp = dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : "all";
    downloadXlsx(`serene-marquee-bookings-${stamp}`, [
      {
        name: "Bookings",
        columns: exportColumns,
        rows,
        titleLines: [
          "Serene Marquee — Bookings Summary",
          `Period: ${rangeLabel}${statusFilter !== "all" ? ` · ${statusFilter} only` : ""}`,
          `${summary.count} bookings (${summary.confirmed} confirmed, ${summary.tentative} tentative, ${summary.cancelled} cancelled) · ${summary.guests} guests`,
          `Gross: Rs. ${Math.round(summary.gross).toLocaleString("en-PK")}   |   Advance: Rs. ${Math.round(
            summary.advance
          ).toLocaleString("en-PK")}   |   Balance Due: Rs. ${Math.round(summary.balance).toLocaleString("en-PK")}`,
        ],
        totalsRow: [
          "TOTAL",
          "",
          "",
          "",
          "",
          "",
          "",
          summary.guests,
          "",
          Math.round(summary.discount),
          Math.round(summary.gross),
          Math.round(summary.advance),
          Math.round(summary.refunded),
          Math.round(summary.balance),
          "",
        ],
      },
    ]);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Bookings & Agreements</div>
          <div className="text-xs text-muted mt-0.5">All confirmed and tentative functions</div>
        </div>
        {!readOnly && (
          <button onClick={() => router.push("/bookings/new")} className="btn-primary rounded-lg px-4 py-2 text-sm">
            + New Booking
          </button>
        )}
      </div>

      <div className="card my-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="text-xs font-bold text-muted uppercase">Search</label>
            <input
              className="w-full mt-1"
              placeholder="Client name or order number (e.g. Ahmed Khan, SM-000123, 123)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Date From</label>
            <input type="date" className="w-full mt-1" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Date To</label>
            <input type="date" className="w-full mt-1" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        <div className="flex items-end gap-2 flex-wrap mt-3">
          <div>
            <label className="text-xs font-bold text-muted uppercase">Quick Month</label>
            <select
              className="mt-1 text-sm"
              value=""
              onChange={(e) => e.target.value && setMonthRange(e.target.value)}
            >
              <option value="">Choose a month…</option>
              {recentMonths(24).map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Status</label>
            <select
              className="mt-1 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="all">All statuses</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Tentative">Tentative</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
          <button
            onClick={() => setMonthRange(currentMonth())}
            className="btn-ghost rounded-lg px-3.5 py-2 text-sm h-[38px]"
          >
            This Month
          </button>
          <button
            onClick={() => {
              setSearch("");
              setDateFrom("");
              setDateTo("");
              setStatusFilter("all");
            }}
            disabled={!filtering}
            className="btn-ghost rounded-lg px-3.5 py-2 text-sm disabled:opacity-40 h-[38px]"
          >
            Clear
          </button>
          <div className="flex-1" />
          <button
            onClick={handleExport}
            disabled={rows.length === 0}
            className="btn-primary rounded-lg px-3.5 py-2 text-sm disabled:opacity-40 h-[38px]"
          >
            ⤓ Download Excel
          </button>
        </div>
      </div>

      {/* Summary of whatever is currently in view */}
      <div className="card mb-4">
        <div className="text-[12.5px] font-bold text-primary mb-3">
          Summary — {rangeLabel}
          {statusFilter !== "all" && <span className="font-normal text-muted"> · {statusFilter} only</span>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Bookings" value={String(summary.count)} sub={`${summary.confirmed} confirmed · ${summary.tentative} tentative`} />
          <Stat label="Cancelled" value={String(summary.cancelled)} sub={summary.refunded > 0 ? `${money(summary.refunded)} refunded` : "none refunded"} />
          <Stat label="Guests" value={summary.guests.toLocaleString("en-PK")} sub="excludes cancelled" />
          <Stat label="Gross Total" value={money(summary.gross)} sub={`after ${money(summary.discount)} discount`} />
          <Stat label="Advance Received" value={money(summary.advance)} />
          <Stat label="Balance Due" value={money(summary.balance)} tone="rose" />
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
              <th className="py-2 px-2">Ref</th>
              <th className="py-2 px-2">Date</th>
              <th className="py-2 px-2">Venue(s)</th>
              <th className="py-2 px-2">Client</th>
              <th className="py-2 px-2">Function</th>
              <th className="py-2 px-2">Guests</th>
              <th className="py-2 px-2">Grand Total</th>
              <th className="py-2 px-2">Balance</th>
              <th className="py-2 px-2">Status</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-muted text-sm">
                  No bookings match your search
                </td>
              </tr>
            )}
            {rows.map((b) => {
              const t = chargesFromBooking(b, venues, menus);
              return (
                <tr key={b.id} className="border-b border-border last:border-0 hover:bg-[#FBF8ED]">
                  <td className="py-2.5 px-2 text-[11.5px] text-muted font-semibold whitespace-nowrap">{bookingRef(b)}</td>
                  <td className="py-2.5 px-2">
                    {fmtDate(b.event_date)}
                    <br />
                    <span className="text-[11px] text-muted">{b.session}</span>
                  </td>
                  <td className="py-2.5 px-2">{venueNames(b)}</td>
                  <td className="py-2.5 px-2">
                    {clientName(b)}
                    <br />
                    <span className="text-[11px] text-muted">{b.phone}</span>
                  </td>
                  <td className="py-2.5 px-2">{functionLabel(b)}</td>
                  <td className="py-2.5 px-2">{b.guests}</td>
                  <td className="py-2.5 px-2">{money(t.grandTotal)}</td>
                  <td className={`py-2.5 px-2 ${t.balance > 0 ? "text-rose" : "text-gold-deep"}`}>
                    {money(t.balance)}
                  </td>
                  <td className="py-2.5 px-2">{statusPill(b.status)}</td>
                  <td className="py-2.5 px-2">
                    <Link href={`/bookings/${b.id}`} className="btn-ghost rounded-md px-2.5 py-1 text-xs inline-block">
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
