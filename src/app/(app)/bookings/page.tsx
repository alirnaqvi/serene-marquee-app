"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { chargesFromBooking, money, functionLabel } from "@/lib/calculations";
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

export default function BookingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [search, setSearch] = useState(searchParams.get("date") || "");

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
    return bookings.filter(
      (b) => !search || b.client.toLowerCase().includes(search.toLowerCase()) || b.event_date.includes(search)
    );
  }, [bookings, search]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Bookings & Agreements</div>
          <div className="text-xs text-muted mt-0.5">All confirmed and tentative functions</div>
        </div>
        <button onClick={() => router.push("/bookings/new")} className="btn-primary rounded-lg px-4 py-2 text-sm">
          + New Booking
        </button>
      </div>

      <div className="my-4">
        <input
          className="w-full"
          placeholder="Search by client name or date (YYYY-MM-DD)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
