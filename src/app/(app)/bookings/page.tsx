"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { chargesFromBooking, money, functionLabel } from "@/lib/calculations";
import { fmtDMY } from "@/lib/dateFormat";
import { useSession } from "@/components/SessionContext";
import { bookingRef } from "@/types";
import type { Booking, Venue, Menu } from "@/types";

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
  // Date is a separate field with a real calendar picker, so nobody has to
  // guess whether to type 09-12-2026 or 12-09-2026.
  const [dateFilter, setDateFilter] = useState(searchParams.get("date") || "");

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
      if (dateFilter && b.event_date !== dateFilter) return false;
      if (!q) return true;

      // Client name
      if (b.client.toLowerCase().includes(q)) return true;
      // Order / booking number — matches "SM-000123", "123", or the raw ref
      if (bookingRef(b).toLowerCase().includes(q)) return true;
      if (qDigits && b.booking_number && String(b.booking_number).includes(qDigits)) return true;
      // Phone is a handy extra when someone calls in about their booking
      if (qDigits.length >= 4 && (b.phone || "").replace(/\D/g, "").includes(qDigits)) return true;

      return false;
    });
  }, [bookings, search, dateFilter]);

  const filtering = Boolean(search.trim() || dateFilter);

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

      <div className="my-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div>
          <label className="text-xs font-bold text-muted uppercase">Search</label>
          <input
            className="w-full mt-1"
            placeholder="Client name or order number (e.g. Ahmed Khan, SM-000123, 123)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-bold text-muted uppercase">Function Date</label>
          <input
            type="date"
            className="w-full mt-1"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>
        <button
          onClick={() => {
            setSearch("");
            setDateFilter("");
          }}
          disabled={!filtering}
          className="btn-ghost rounded-lg px-4 py-2 text-sm disabled:opacity-40 h-[38px]"
        >
          Clear
        </button>
      </div>

      {filtering && (
        <div className="text-[11.5px] text-muted mb-3">
          {rows.length} booking{rows.length === 1 ? "" : "s"} found
          {dateFilter && <> on {fmtDMY(dateFilter)}</>}
          {search.trim() && <> matching “{search.trim()}”</>}
        </div>
      )}

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
                    {b.client}
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
