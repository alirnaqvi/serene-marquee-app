"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid,
  CalendarDays,
  BookOpen,
  Wallet,
  UtensilsCrossed,
  KeyRound,
  UserCircle,
  LogOut,
  Wrench,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, type Role } from "@/types";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/bookings", label: "Bookings", icon: BookOpen },
  { href: "/ledger", label: "Ledger", icon: Wallet, ledgerOnly: true },
  { href: "/menus", label: "Menus & Venues", icon: UtensilsCrossed },
  { href: "/admin/staff", label: "Staff & Access", icon: KeyRound, staffPageOnly: true },
  { href: "/dev", label: "Developer Console", icon: Wrench, devOnly: true },
  { href: "/profile", label: "Profile", icon: UserCircle },
];

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export default function Sidebar({
  fullName,
  role,
  canViewLedger,
  canViewStaffPage,
  canEditStaff,
  isDeveloper,
  onNavigate,
}: {
  fullName: string;
  role: Role;
  canViewLedger: boolean;
  canViewStaffPage: boolean;
  canEditStaff: boolean;
  isDeveloper: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="w-64 sm:w-60 h-full shrink-0 flex flex-col p-4 bg-gradient-to-b from-[#18150F] via-[#141210] to-[#0F0D0A] text-[#EAE3CC] border-r border-[#2A2620] overflow-y-auto">
      <div className="flex items-center gap-2.5 pb-4 mb-3 border-b border-gold/20 px-1">
        <img src="/logo.png" alt="Serene Marquee" className="w-10 h-10 rounded-xl shadow-lg ring-1 ring-gold/30" />
        <div>
          <div className="text-[15.5px] font-bold font-serif text-gold-light leading-tight tracking-tight">
            Serene Marquee
          </div>
          <div className="text-[9.5px] text-[#A99A6E] tracking-[0.18em] uppercase mt-0.5">Operations</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.filter(
          (item) =>
            (!item.ledgerOnly || canViewLedger) &&
            (!item.staffPageOnly || canViewStaffPage) &&
            (!item.devOnly || isDeveloper)
        ).map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium ${
                  active
                    ? "bg-gradient-to-br from-[#D3AF52] to-[#9C7A26] text-[#171410] font-bold shadow-[0_6px_18px_-8px_rgba(184,145,46,0.6)]"
                    : "text-[#CFC6A6] hover:bg-white/[0.06] hover:text-gold-light"
                }`}
              >
                <Icon size={16.5} strokeWidth={active ? 2.4 : 1.9} className="shrink-0 opacity-90" />
                <span className="flex-1">{item.label}</span>
                {item.href === "/admin/staff" && !canEditStaff && (
                  <span className="text-[8.5px] font-normal opacity-60 whitespace-nowrap">view only</span>
                )}
              </Link>
            );
          }
        )}
      </nav>

      <div className="mt-auto pt-3.5 border-t border-gold/15">
        <div className="flex items-center gap-2.5 px-1 mb-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D3AF52] to-[#8A6A1E] text-[#171410] text-[11.5px] font-bold flex items-center justify-center shrink-0">
            {initials(fullName) || "?"}
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-[#EAE3CC] truncate">{fullName}</div>
            <div className="text-[10px] text-[#8C7F5C]">{ROLE_LABELS[role]}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 text-[11.5px] text-[#A99A6E] hover:text-gold-light px-1.5 py-1.5 rounded-lg hover:bg-white/[0.05]"
        >
          <LogOut size={13.5} strokeWidth={2} />
          Sign out
        </button>
      </div>
    </div>
  );
}
