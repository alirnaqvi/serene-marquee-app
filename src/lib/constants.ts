// Rates confirmed by the owner — change here if policy changes.
export const KPR_RATE = 0.15; // 15% KPR tax on food, per printed 2026 menu

// Hall charge is now a flat Rs. 50,000 for every venue (owner policy, Aug
// 2026). The per-venue figure still lives in the `venues` table and is what
// the calculator actually reads — this constant is the value that table is
// seeded/migrated to, and what the Menus & Venues screen quotes.
export const HALL_CHARGE = 50000; // Rs. per hall, all venues

export const COOLING_CHARGE_PER_HALL = 100000; // Rs. per hall
export const HEATER_CHARGE = 8000; // Rs. per heater
export const TOKEN_MINIMUM = 50000; // Rs. non-refundable token quoted on the rate card

// Minimum advance that actually converts a booking from Tentative to
// Confirmed. Below this the booking stays Tentative however it is saved.
export const CONFIRMATION_MINIMUM = 25000; // Rs.
export const EXTRA_HOUR_CHARGE = 25000; // Rs. per additional hour beyond the 4-hour slot
export const ENTRY_TEST_RATE = 600; // Rs. per head, flat — no menu/offered items involved

export function incomeTaxRate(filer: "Filer" | "Non-Filer"): number {
  return filer === "Filer" ? 0.1 : 0.2;
}

export const SESSION_TIMES: Record<"Lunch" | "Dinner", string> = {
  Lunch: "12:30 PM to 4:30 PM",
  Dinner: "7:00 PM to 11:00 PM",
};
