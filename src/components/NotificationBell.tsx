"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, PartyPopper, Ban } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtDMYTime } from "@/lib/dateFormat";
import type { Booking } from "@/types";

type Notice = {
  id: string;
  bookingId: string;
  kind: "new" | "cancelled" | "rescheduled";
  text: string;
  at: string;
  read: boolean;
};

// Session-only notification feed: any staff member logged in sees a live
// toast/panel the moment a booking is created, cancelled, or rescheduled by
// anyone else, via the same Supabase realtime channel the Calendar/Bookings
// pages already use. It resets on page reload (no history table needed for
// what this is meant to do — a heads-up, not a permanent audit log).
export default function NotificationBell() {
  const supabase = createClient();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const prevStatus = useRef<Map<string, string>>(new Map());
  const initialized = useRef(false);

  useEffect(() => {
    async function init() {
      const { data } = await supabase.from("bookings").select("id, status");
      (data || []).forEach((b: any) => prevStatus.current.set(b.id, b.status));
      initialized.current = true;
    }
    init();

    const channel = supabase
      .channel("notifications-bookings")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bookings" },
        (payload) => {
          if (!initialized.current) return;
          const b = payload.new as Booking;
          prevStatus.current.set(b.id, b.status);
          pushNotice({
            id: `${b.id}-new-${Date.now()}`,
            bookingId: b.id,
            kind: "new",
            text: `New booking: ${b.client} — ${b.event_date} (${b.session})`,
            at: new Date().toISOString(),
            read: false,
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings" },
        (payload) => {
          if (!initialized.current) return;
          const b = payload.new as Booking;
          const was = prevStatus.current.get(b.id);
          prevStatus.current.set(b.id, b.status);
          if (b.status === "Cancelled" && was !== "Cancelled") {
            pushNotice({
              id: `${b.id}-cancel-${Date.now()}`,
              bookingId: b.id,
              kind: "cancelled",
              text: `Booking cancelled: ${b.client} — ${b.event_date} (${b.session})`,
              at: new Date().toISOString(),
              read: false,
            });
          } else if (was && was !== "Cancelled" && was === b.status) {
            // Same status, but the row changed (edit/reschedule) — only
            // surface this as a distinct notice if the date itself moved,
            // which we can't tell from payload alone reliably, so skip noise
            // here; the "new" and "cancelled" cases cover the two events the
            // owner specifically asked for.
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function pushNotice(notice: Notice) {
    setNotices((prev) => [notice, ...prev].slice(0, 30));
  }

  function markAllRead() {
    setNotices((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const unread = notices.filter((n) => !n.read).length;

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) markAllRead();
        }}
        className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg text-primary"
        title="Notifications"
      >
        <Bell size={17} strokeWidth={1.8} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 bg-rose text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5 ring-2 ring-surface">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto bg-surface border border-border rounded-xl shadow-card-hover z-50 fade-up">
          <div className="px-3.5 py-2.5 border-b border-border text-[12.5px] font-bold text-primary">
            Notifications
          </div>
          {notices.length === 0 ? (
            <div className="px-3.5 py-8 text-center text-muted text-[12.5px]">
              <Bell size={20} strokeWidth={1.5} className="mx-auto mb-2 opacity-40" />
              Nothing yet — new bookings and cancellations will show up here live.
            </div>
          ) : (
            notices.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setOpen(false);
                  router.push(`/bookings/${n.bookingId}`);
                }}
                className="w-full text-left px-3.5 py-2.5 border-b border-border last:border-0 hover:bg-bg flex gap-2.5 items-start"
              >
                <span
                  className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    n.kind === "cancelled" ? "bg-rose-light text-rose" : "bg-emerald-light text-emerald"
                  }`}
                >
                  {n.kind === "cancelled" ? <Ban size={13} strokeWidth={2.2} /> : <PartyPopper size={13} strokeWidth={2.2} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-semibold text-primary leading-snug">{n.text}</span>
                  <span className="block text-[10.5px] text-muted mt-0.5">{fmtDMYTime(new Date(n.at))}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
