"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clientName } from "@/types";
import type { Booking, Venue } from "@/types";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

export default function CalendarPage() {
  const router = useRouter();
  const supabase = createClient();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [venueFilter, setVenueFilter] = useState<string>("all");
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  useEffect(() => {
    async function load() {
      const [{ data: v }, { data: b }] = await Promise.all([
        supabase.from("venues").select("*"),
        supabase.from("bookings").select("*").neq("status", "Cancelled"),
      ]);
      setVenues(v || []);
      setBookings(b || []);
    }
    load();

    const channel = supabase
      .channel("bookings-calendar")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const venueName = (id: string) => venues.find((v) => v.id === id)?.name || id;

  const days = useMemo(() => {
    const first = new Date(year, month, 1);
    const startDow = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [year, month]);

  function bookingsFor(day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let dayBookings = bookings.filter((b) => b.event_date === dateStr);
    if (venueFilter !== "all") dayBookings = dayBookings.filter((b) => b.venues.includes(venueFilter));
    return dayBookings;
  }

  function handleDayClick(day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayBookings = bookingsFor(day);
    if (dayBookings.length === 1) {
      router.push(`/bookings/${dayBookings[0].id}`);
    } else if (dayBookings.length > 1) {
      router.push(`/bookings?date=${dateStr}`);
    } else {
      const params = new URLSearchParams({ date: dateStr });
      if (venueFilter !== "all") params.set("venue", venueFilter);
      router.push(`/bookings/new?${params.toString()}`);
    }
  }

  function shiftMonth(dir: number) {
    let m = month + dir;
    let y = year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setMonth(m);
    setYear(y);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Booking Calendar</div>
          <div className="text-xs text-muted mt-0.5">Venue · session · client — tap a date to view or add a booking</div>
        </div>
        <button onClick={() => router.push("/bookings/new")} className="btn-primary rounded-lg px-4 py-2 text-sm whitespace-nowrap">
          + New Booking
        </button>
      </div>

      <div className="flex gap-1.5 flex-wrap my-4">
        <button
          onClick={() => setVenueFilter("all")}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border ${
            venueFilter === "all" ? "bg-primary text-gold-light border-primary" : "bg-white border-border"
          }`}
        >
          All Venues
        </button>
        {venues.map((v) => (
          <button
            key={v.id}
            onClick={() => setVenueFilter(v.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border ${
              venueFilter === v.id ? "bg-primary text-gold-light border-primary" : "bg-white border-border"
            }`}
          >
            {v.name}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3.5">
          <button onClick={() => shiftMonth(-1)} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
            &larr; Prev
          </button>
          <div className="font-serif text-[17px] font-bold">
            {MONTH_NAMES[month]} {year}
          </div>
          <button onClick={() => shiftMonth(1)} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
            Next &rarr;
          </button>
        </div>
        <div className="overflow-x-auto -mx-1">
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 min-w-[640px] px-1">
          {DOW.map((d) => (
            <div key={d} className="text-[11px] font-bold text-muted text-center uppercase pb-1">
              {d}
            </div>
          ))}
          {days.map((day, i) =>
            day === null ? (
              <div key={i} />
            ) : (
              <div
                key={i}
                onClick={() => handleDayClick(day)}
                className="min-h-[86px] sm:min-h-[112px] bg-white border border-border rounded-lg p-2 cursor-pointer hover:border-gold flex flex-col gap-1"
              >
                <div className="text-[12.5px] font-bold">{day}</div>
                {bookingsFor(day).map((b) => (
                  <div
                    key={b.id}
                    title={`${b.venues.map(venueName).join(" + ")} · ${b.session} · ${clientName(b)}`}
                    className={`text-[9.5px] px-1.5 py-0.5 rounded font-bold leading-tight ${
                      b.session === "Lunch" ? "bg-gold-light text-[#8A6427]" : "bg-primary-dim text-gold-deep"
                    }`}
                  >
                    <div className="truncate">
                      {b.venues.map(venueName).join("+")}: {b.session}
                    </div>
                    <div className="truncate font-semibold opacity-90">{clientName(b)}</div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
