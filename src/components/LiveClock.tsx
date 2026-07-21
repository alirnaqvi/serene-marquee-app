"use client";

import { useEffect, useState } from "react";

export default function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return <div className="live-clock-placeholder" />;

  const full = now.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const short = now.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="text-[11px] sm:text-xs font-bold text-gold-deep bg-gold-light border border-gold rounded-lg px-2.5 sm:px-3.5 py-1.5 sm:py-2 whitespace-nowrap">
      <span className="hidden sm:inline">{full}</span>
      <span className="sm:hidden">{short}</span>
    </div>
  );
}
