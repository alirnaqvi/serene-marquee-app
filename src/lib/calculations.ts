import { KPR_RATE, COOLING_CHARGE_PER_HALL, HEATER_CHARGE, ENTRY_TEST_RATE, incomeTaxRate } from "./constants";
import type { Venue, Menu, Booking } from "@/types";

export type ChargeInput = {
  guests: number;
  venues: string[]; // venue ids
  menuId: string | null;
  isCustomMenu?: boolean;
  isEntryTest?: boolean; // Entry Test bookings: flat ENTRY_TEST_RATE/head, no menu involved
  customMenuTotal?: number; // required when isCustomMenu is true — fully replaces the menu rate
  addonsTotal?: number; // optional extra items added ON TOP of a regular menu's food subtotal
  discount: number; // flat Rs. amount (not a percentage)
  filer: "Filer" | "Non-Filer";
  decoration: number;
  heaters: number;
  cooling: boolean;
  advance: number;
};

export type ChargeBreakdown = {
  foodSubtotal: number;
  addonsTotal: number;
  kprTax: number;
  hallCharge: number;
  coolingCharge: number;
  heatingCharge: number;
  decoration: number;
  preTax: number; // foodSubtotal + kprTax + hallCharge + cooling + heating + decoration — before income tax and before discount
  incomeTaxRate: number;
  incomeTax: number;
  totalBeforeDiscount: number; // every due added up (preTax + incomeTax) — discount hasn't been applied yet
  discountAmount: number;
  grandTotal: number; // totalBeforeDiscount - discountAmount
  balance: number; // grandTotal - advance
};

export function calcTotals(
  input: ChargeInput,
  allVenues: Venue[],
  allMenus: Menu[]
): ChargeBreakdown {
  const venueList = input.venues
    .map((id) => allVenues.find((v) => v.id === id))
    .filter((v): v is Venue => Boolean(v));

  const addonsTotal = input.isEntryTest ? 0 : input.addonsTotal || 0;
  let foodSubtotal: number;
  if (input.isEntryTest) {
    // Entry Test bookings: flat per-head rate, no menu/offered items involved.
    foodSubtotal = input.guests * ENTRY_TEST_RATE;
  } else if (input.isCustomMenu) {
    // A fully custom menu replaces the base rate entirely.
    foodSubtotal = input.customMenuTotal || 0;
  } else {
    const menu = allMenus.find((m) => m.id === input.menuId);
    const rate = menu?.rate ?? 0;
    // Optional extra items chosen on top of a regular menu are added to its
    // per-head price, then everyone's plate is charged the combined rate.
    foodSubtotal = input.guests * rate + addonsTotal;
  }

  // KPRA tax and income tax are both calculated on the full, undiscounted
  // dues — the discount is applied only once, at the very end, to the fully
  // totaled amount (Food + KPRA + Hall + Decoration + Cooling/Heating +
  // Income Tax), per owner policy. It is a flat Rs. amount, not a percentage.
  const kprTax = foodSubtotal * KPR_RATE;

  // Hall charge is waived once guest count reaches each selected venue's
  // minimum (currently 200+ across all three venues, per owner policy).
  const hallCharge = venueList.reduce(
    (sum, v) => sum + (input.guests < v.min_waiver ? v.hall_charge : 0),
    0
  );
  const coolingCharge = input.cooling ? COOLING_CHARGE_PER_HALL * venueList.length : 0;
  const heatingCharge = (input.heaters || 0) * HEATER_CHARGE;
  const decoration = input.decoration || 0;

  const preTax = foodSubtotal + kprTax + hallCharge + coolingCharge + heatingCharge + decoration;
  const taxRate = incomeTaxRate(input.filer);
  const incomeTax = preTax * taxRate;

  // Everything is added up first...
  const totalBeforeDiscount = preTax + incomeTax;
  // ...then the discount (flat Rs., capped so it can't exceed the total) is
  // deducted once from that grand total.
  const discountAmount = Math.min(input.discount || 0, totalBeforeDiscount);
  const grandTotal = totalBeforeDiscount - discountAmount;
  const balance = grandTotal - (input.advance || 0);

  return {
    foodSubtotal,
    addonsTotal,
    kprTax,
    hallCharge,
    coolingCharge,
    heatingCharge,
    decoration,
    preTax,
    incomeTaxRate: taxRate,
    incomeTax,
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
    | "menu_id"
    | "is_custom_menu"
    | "custom_menu_total"
    | "addons_total"
    | "function_type"
    | "discount"
    | "filer"
    | "decoration"
    | "heaters"
    | "cooling"
    | "advance"
  >,
  allVenues: Venue[],
  allMenus: Menu[]
) {
  return calcTotals(
    {
      guests: booking.guests,
      venues: booking.venues,
      menuId: booking.menu_id,
      isCustomMenu: booking.is_custom_menu,
      isEntryTest: booking.function_type === "Entry Test",
      customMenuTotal: booking.custom_menu_total,
      addonsTotal: booking.addons_total,
      discount: booking.discount,
      filer: booking.filer,
      decoration: booking.decoration,
      heaters: booking.heaters,
      cooling: booking.cooling,
      advance: booking.advance,
    },
    allVenues,
    allMenus
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
