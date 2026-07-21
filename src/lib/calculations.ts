import { KPR_RATE, COOLING_CHARGE_PER_HALL, HEATER_CHARGE, incomeTaxRate } from "./constants";
import type { Venue, Menu, Booking } from "@/types";

export type ChargeInput = {
  guests: number;
  venues: string[]; // venue ids
  menuId: string | null;
  isCustomMenu?: boolean;
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
  discountAmount: number;
  afterDiscount: number;
  kprTax: number;
  hallCharge: number;
  coolingCharge: number;
  heatingCharge: number;
  decoration: number;
  preTax: number;
  incomeTaxRate: number;
  incomeTax: number;
  grandTotal: number;
  balance: number;
};

export function calcTotals(
  input: ChargeInput,
  allVenues: Venue[],
  allMenus: Menu[]
): ChargeBreakdown {
  const venueList = input.venues
    .map((id) => allVenues.find((v) => v.id === id))
    .filter((v): v is Venue => Boolean(v));

  const addonsTotal = input.addonsTotal || 0;
  let foodSubtotal: number;
  if (input.isCustomMenu) {
    // A fully custom menu replaces the base rate entirely.
    foodSubtotal = input.customMenuTotal || 0;
  } else {
    const menu = allMenus.find((m) => m.id === input.menuId);
    const rate = menu?.rate ?? 0;
    // Optional extra items chosen on top of a regular menu are added to its
    // per-head price, then everyone's plate is charged the combined rate.
    foodSubtotal = input.guests * rate + addonsTotal;
  }

  // Discount is a flat Rs. amount now (staff found percentages hard to
  // calculate by hand), capped so it can never exceed the food subtotal.
  const discountAmount = Math.min(input.discount || 0, foodSubtotal);
  const afterDiscount = foodSubtotal - discountAmount;
  const kprTax = afterDiscount * KPR_RATE;

  // Hall charge is waived once guest count reaches each selected venue's
  // minimum (currently 200+ across all three venues, per owner policy).
  const hallCharge = venueList.reduce(
    (sum, v) => sum + (input.guests < v.min_waiver ? v.hall_charge : 0),
    0
  );
  const coolingCharge = input.cooling ? COOLING_CHARGE_PER_HALL * venueList.length : 0;
  const heatingCharge = (input.heaters || 0) * HEATER_CHARGE;
  const decoration = input.decoration || 0;

  const preTax = afterDiscount + kprTax + hallCharge + coolingCharge + heatingCharge + decoration;
  const taxRate = incomeTaxRate(input.filer);
  const incomeTax = preTax * taxRate;
  const grandTotal = preTax + incomeTax;
  const balance = grandTotal - (input.advance || 0);

  return {
    foodSubtotal,
    addonsTotal,
    discountAmount,
    afterDiscount,
    kprTax,
    hallCharge,
    coolingCharge,
    heatingCharge,
    decoration,
    preTax,
    incomeTaxRate: taxRate,
    incomeTax,
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
