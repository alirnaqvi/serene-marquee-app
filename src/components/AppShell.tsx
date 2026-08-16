"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import LiveClock from "@/components/LiveClock";
import NotificationBell from "@/components/NotificationBell";
import type { Role } from "@/types";

export default function AppShell({
  fullName,
  role,
  canViewLedger,
  canViewStaffPage,
  canEditStaff,
  isDeveloper,
  children,
}: {
  fullName: string;
  role: Role;
  canViewLedger: boolean;
  canViewStaffPage: boolean;
  canEditStaff: boolean;
  isDeveloper: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar: fixed off-canvas drawer on mobile, static column on desktop */}
      <div
        className={`fixed inset-y-0 left-0 z-50 h-dvh transition-transform duration-200 lg:static lg:h-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar
          fullName={fullName}
          role={role}
          canViewLedger={canViewLedger}
          canViewStaffPage={canViewStaffPage}
          canEditStaff={canEditStaff}
          isDeveloper={isDeveloper}
          onNavigate={() => setMobileOpen(false)}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-7 py-3 border-b border-border bg-surface/90 backdrop-blur-sm sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen((o) => !o)}
            className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-bg text-primary shrink-0"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="flex-1" />
          <NotificationBell />
          <div className="w-px h-5 bg-border hidden sm:block" />
          <LiveClock />
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-7 fade-up">{children}</div>
      </div>
    </div>
  );
}
