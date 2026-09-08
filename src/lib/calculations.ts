import { DEFAULT_SETTINGS, type ChargeSettings } from "./settings";
import type { Venue, Menu, Booking } from "@/types";

export type ChargeInput = {
  guests: number;
  venues: string[]; // venue ids
  isEntryTest?: boolean; // Entry Test bookings: flat per-head rate, no menu involved
  perHeadRate?: number; // final per-head rate entered manually, covers menu + any extra items
  discount: number; // flat Rs. amount (not a percentage)
  decoration: number;
  heaters: number;
  cooling: boolean;
  advance: number;
};

export type ChargeBreakdown = {
  foodSubtotal: number;
  kprTax: number;
  hallCharge: number;
  coolingCharge: number;
  heatingCharge: number;
  decoration: number;
  totalBeforeDiscount: number; // every due added up (foodSubtotal + kprTax + hallCharge + cooling + heating + decoration) — discount hasn't been applied yet
  discountAmount: number;
  grandTotal: number; // totalBeforeDiscount - discountAmount
  balance: number; // grandTotal - advance
};

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
  const kprTax = foodSubtotal * settings.kpraRate;

  // Hall charge is waived once guest count reaches each selected venue's
  // minimum (currently 200+ across all three venues, per owner policy).
  const hallCharge = venueList.reduce(
    (sum, v) => sum + (input.guests < v.min_waiver ? v.hall_charge : 0),
    0
  );
  const coolingCharge = input.cooling ? settings.coolingCharge * venueList.length : 0;
  const heatingCharge = (input.heaters || 0) * settings.heaterCharge;
  const decoration = input.decoration || 0;

  const totalBeforeDiscount = foodSubtotal + kprTax + hallCharge + coolingCharge + heatingCharge + decoration;
  // The discount (flat Rs., capped so it can't exceed the total) is deducted
  // once from that grand total.
  const discountAmount = Math.min(input.discount || 0, totalBeforeDiscount);
  const grandTotal = totalBeforeDiscount - discountAmount;
  const balance = grandTotal - (input.advance || 0);

  return {
    foodSubtotal,
    kprTax,
    hallCharge,
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
