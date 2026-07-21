// Rates confirmed by the owner — change here if policy changes.
export const KPR_RATE = 0.15; // 15% KPR tax on food, per printed 2026 menu
export const COOLING_CHARGE_PER_HALL = 100000; // Rs. per hall
export const HEATER_CHARGE = 8000; // Rs. per heater
export const TOKEN_MINIMUM = 50000; // Rs. non-refundable token to confirm a booking
export const EXTRA_HOUR_CHARGE = 25000; // Rs. per additional hour beyond the 4-hour slot

export function incomeTaxRate(filer: "Filer" | "Non-Filer"): number {
  return filer === "Filer" ? 0.1 : 0.2;
}

export const SESSION_TIMES: Record<"Lunch" | "Dinner", string> = {
  Lunch: "12:30 PM to 4:30 PM",
  Dinner: "7:00 PM to 11:00 PM",
};
