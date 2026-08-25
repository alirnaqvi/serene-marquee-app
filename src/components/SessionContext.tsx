"use client";

import { createContext, useContext } from "react";
import { discountLimitFor, isReadOnlyRole, type Role } from "@/types";

export type SessionValue = {
  fullName: string;
  role: Role;
  canViewLedger: boolean;
  canViewStaffPage: boolean;
  canEditStaff: boolean;
  isDeveloper: boolean;
  /** Owner / CEO accounts can look at everything but change nothing. */
  readOnly: boolean;
  /** Flat Rs. ceiling this role may discount on one booking (Infinity = no cap). */
  discountLimit: number;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  value,
  children,
}: {
  value: Omit<SessionValue, "readOnly" | "discountLimit">;
  children: React.ReactNode;
}) {
  const full: SessionValue = {
    ...value,
    readOnly: isReadOnlyRole(value.role),
    discountLimit: discountLimitFor(value.role),
  };
  return <SessionContext.Provider value={full}>{children}</SessionContext.Provider>;
}

/**
 * Read the signed-in user's role and permissions anywhere below AppShell.
 * The values come from the server layout, so no extra Supabase round-trip is
 * needed just to decide whether to show an Edit button.
 */
export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    // Safe fallback if a component is ever rendered outside the provider:
    // assume the most restrictive sensible defaults rather than crashing.
    return {
      fullName: "",
      role: "staff",
      canViewLedger: false,
      canViewStaffPage: false,
      canEditStaff: false,
      isDeveloper: false,
      readOnly: false,
      discountLimit: 0,
    };
  }
  return ctx;
}

/** Small banner shown at the top of a page when the account is monitor-only. */
export function ReadOnlyNotice({ what = "this page" }: { what?: string }) {
  return (
    <div className="bg-gold-light border border-gold/30 text-gold-deep rounded-lg px-3.5 py-2.5 text-[12.5px] font-semibold mb-4">
      View-only access — your account can monitor {what} but cannot add or change entries.
    </div>
  );
}
