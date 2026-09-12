import { DEFAULT_SETTINGS, type ChargeSettings } from "./settings";
import type { Venue, Menu, Booking } from "@/types";

export type ChargeInput = {
  guests: number;
  venues: string[]; // venue ids
  isEntryTest?: boolean; // Entry Test bookings: flat per-head rate, no menu involved
  perHeadRate?: number; // final per-head rate entered manually, covers menu + any extra items
  // Priced extras (Lamb Roast, etc.) — items that carry a real rate of their
  // own and are NOT covered by the agreed per-head rate. Charged by the piece,
  // not by the guest count.
  extrasTotal?: number;
  discount: number; // flat Rs. amount (not a percentage)
  decoration: number;
  heaters: number;
  cooling: boolean;
  advance: number;
};

export type ChargeBreakdown = {
  foodSubtotal: number;
  extrasTotal: number; // priced extras (Lamb Roast, etc.), charged by the piece
  kprTax: number;
  hallCharge: number;
  /** Guest count at which the hall charge is waived for the selected venue(s). */
  hallWaiverThreshold: number;
  hallWaived: boolean;
  coolingCharge: number;
  heatingCharge: number;
  decoration: number;
  totalBeforeDiscount: number; // every due added up (foodSubtotal + kprTax + hallCharge + cooling + heating + decoration) — discount hasn't been applied yet
  discountAmount: number;
  grandTotal: number; // totalBeforeDiscount - discountAmount
  balance: number; // grandTotal - advance
};

/**
 * HALL CHARGE WAIVER
 *
 * Each venue carries its own waiver minimum (Serene Diamond and Serene Gold are
 * both 200). One hall is waived at that hall's own minimum. When two halls are
 * taken the function has to be big enough to fill both before the charge goes,
 * so the minimums ADD UP — 200 + 200 = 400 guests for Diamond + Gold together.
 *
 * The waiver is all-or-nothing across the selected halls: below the combined
 * minimum every hall is charged, at or above it every hall is free. The figures
 * come from the venues table, so the Admin changing a minimum on Menus & Venues
 * moves this rule with it.
 */
export function hallChargeFor(
  guests: number,
  venueList: Venue[]
): { charge: number; threshold: number; waived: boolean } {
  if (venueList.length === 0) return { charge: 0, threshold: 0, waived: false };
  const threshold = venueList.reduce((sum, v) => sum + v.min_waiver, 0);
  const full = venueList.reduce((sum, v) => sum + v.hall_charge, 0);
  const waived = guests >= threshold;
  return { charge: waived ? 0 : full, threshold, waived };
}

export function calcTotals(
  input: ChargeInput,
  allVenues: Venue[],
  allMenus: Menu[],
  // KPRA tax, cooling, heating and the entry-test rate are set by the Admin on
  // the Menus & Venues screen. Falling back to the code constants keeps every
  // total correct if the settings haven't loaded yet.
  settings: ChargeSettings = DEFAULT_SETTINGS
): ChargeBreakdown {
  const venueList = input.venues
    .map((id) => allVenues.find((v) => v.id === id))
    .filter((v): v is Venue => Boolean(v));

  let foodSubtotal: number;
  if (input.isEntryTest) {
    // Entry Test bookings: flat per-head rate, no menu/offered items involved.
    foodSubtotal = input.guests * settings.entryTestRate;
  } else {
    // Every other booking is priced off a single manually-entered final
    // per-head rate that already covers the menu and any extra items.
    foodSubtotal = input.guests * (input.perHeadRate || 0);
  }

  // KPRA tax is calculated on the full, undiscounted dues — the discount is
  // applied only once, at the very end, to the fully totaled amount
  // (Food + KPRA + Hall + Decoration + Cooling/Heating), per owner policy.
  // It is a flat Rs. amount, not a percentage.
  const extrasTotal = input.isEntryTest ? 0 : input.extrasTotal || 0;
  const kprTax = (foodSubtotal + extrasTotal) * settings.kpraRate;

  const hall = hallChargeFor(input.guests, venueList);
  const hallCharge = hall.charge;
  const coolingCharge = input.cooling ? settings.coolingCharge * venueList.length : 0;
  const heatingCharge = (input.heaters || 0) * settings.heaterCharge;
  const decoration = input.decoration || 0;

  const totalBeforeDiscount =
    foodSubtotal + extrasTotal + kprTax + hallCharge + coolingCharge + heatingCharge + decoration;
  // The discount (flat Rs., capped so it can't exceed the total) is deducted
  // once from that grand total.
  const discountAmount = Math.min(input.discount || 0, totalBeforeDiscount);
  const grandTotal = totalBeforeDiscount - discountAmount;
  const balance = grandTotal - (input.advance || 0);

  return {
    foodSubtotal,
    extrasTotal,
    kprTax,
    hallCharge,
    hallWaiverThreshold: hall.threshold,
    hallWaived: hall.waived,
    coolingCharge,
    heatingCharge,
    decoration,
    totalBeforeDiscount,
    discountAmount,
    grandTotal,
    balance,
  };
}

export function chargesFromBooking(
  booking: Pick<
    Booking,
    | "guests"
    | "venues"
    | "per_head_rate"
    | "extras_total"
    | "function_type"
    | "discount"
    | "decoration"
    | "heaters"
    | "cooling"
    | "advance"
  >,
  allVenues: Venue[],
  allMenus: Menu[],
  settings: ChargeSettings = DEFAULT_SETTINGS
) {
  return calcTotals(
    {
      guests: booking.guests,
      venues: booking.venues,
      isEntryTest: booking.function_type === "Entry Test",
      perHeadRate: booking.per_head_rate,
      extrasTotal: booking.extras_total,
      discount: booking.discount,
      decoration: booking.decoration,
      heaters: booking.heaters,
      cooling: booking.cooling,
      advance: booking.advance,
    },
    allVenues,
    allMenus,
    settings
  );
}

export function money(n: number): string {
  return "Rs. " + Math.round(n || 0).toLocaleString("en-PK");
}

export function functionLabel(b: Pick<Booking, "function_type" | "function_type_other">): string {
  return b.function_type === "Other" ? b.function_type_other || "Other" : b.function_type;
}

// Offered menus store their included items as one comma-separated string
// (e.g. "Yakhni Pulao, Chicken Qorma, Kheer, ..."). These helpers let a
// booking drop individual items from that fixed list — e.g. the host
// doesn't want the salad — without switching to a full Customized Menu.
export function parseMenuItems(items: string): string[] {
  return items
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function effectiveMenuItems(items: string, removedItems: string[] | null | undefined): string[] {
  const removed = new Set(removedItems || []);
  return parseMenuItems(items).filter((item) => !removed.has(item));
}
