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
  /** Payments received after the advance (booking_payments). */
  paymentsTotal?: number;
};

export type ChargeBreakdown = {
  foodSubtotal: number;
  extrasTotal: number; // priced extras (Lamb Roast, etc.), charged by the piece
  kprTax: number;
  hallCharge: number;
  /** Guest count at which the hall charge is waived for the selected venue(s). */
  hallWaiverThreshold: number;
  hallWaived: boolean;
  hallCount: number;
  hallWaivedCount: number;
  hallNextThreshold: number | null;
  coolingCharge: number;
  heatingCharge: number;
  decoration: number;
  totalBeforeDiscount: number; // every due added up (foodSubtotal + kprTax + hallCharge + cooling + heating + decoration) — discount hasn't been applied yet
  discountAmount: number;
  grandTotal: number; // totalBeforeDiscount - discountAmount
  /** advance + every later payment */
  totalReceived: number;
  balance: number; // grandTotal - advance - later payments
};

/**
 * HALL CHARGE WAIVER
 *
 * Every hall is waived once the function has enough guests to fill it — its
 * own minimum, 200 for each hall today. With more than one hall, the guests
 * are counted against the halls one at a time:
 *
 *   2 halls, 150 guests  -> both charged
 *   2 halls, 250 guests  -> one waived, one charged      (200 covers one hall)
 *   2 halls, 400 guests  -> both waived
 *   3 halls, 450 guests  -> two waived, one charged      (400 covers two)
 *   3 halls, 600 guests  -> all three waived
 *
 * The halls with the smallest minimum are waived first; where minimums are
 * equal the dearer hall is waived first, which is the client's favour. The
 * minimums come from the venues table, so the Admin changing one on Menus &
 * Venues moves this rule with it.
 */
export type HallCharge = {
  charge: number;
  /** Guests needed for EVERY selected hall to be waived. */
  threshold: number;
  /** True when every selected hall is waived. */
  waived: boolean;
  hallCount: number;
  waivedCount: number;
  /** Guests at which the next hall would be waived, or null if all are. */
  nextThreshold: number | null;
};

export function hallChargeFor(guests: number, venueList: Venue[]): HallCharge {
  const ordered = [...venueList].sort(
    (a, b) => a.min_waiver - b.min_waiver || b.hall_charge - a.hall_charge
  );
  let covered = 0;
  let charge = 0;
  let waivedCount = 0;
  let nextThreshold: number | null = null;
  for (const v of ordered) {
    covered += v.min_waiver;
    if (guests >= covered) waivedCount++;
    else {
      charge += v.hall_charge;
      if (nextThreshold === null) nextThreshold = covered;
    }
  }
  return {
    charge,
    threshold: covered,
    waived: ordered.length > 0 && waivedCount === ordered.length,
    hallCount: ordered.length,
    waivedCount,
    nextThreshold,
  };
}

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five"];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

/**
 * One short line explaining the hall charge, used by the booking form, the
 * booking page and the PDFs so they all say the same thing.
 */
export function hallChargeNote(t: {
  hallCount: number;
  hallWaivedCount: number;
  hallWaiverThreshold: number;
  hallNextThreshold: number | null;
}): string {
  const { hallCount, hallWaivedCount, hallWaiverThreshold, hallNextThreshold } = t;
  if (hallCount === 0) return "";
  if (hallCount === 1) {
    return hallWaivedCount ? `Waived (${hallWaiverThreshold}+ guests)` : `Waived at ${hallWaiverThreshold}+ guests`;
  }
  const all = hallCount === 2 ? "both" : `all ${countWord(hallCount)}`;
  if (hallWaivedCount === hallCount) return `${all[0].toUpperCase()}${all.slice(1)} halls waived (${hallWaiverThreshold}+ guests)`;
  if (hallWaivedCount === 0) return `One hall waived at ${hallNextThreshold}+ guests, ${all} at ${hallWaiverThreshold}+`;
  const done = `${countWord(hallWaivedCount)[0].toUpperCase()}${countWord(hallWaivedCount).slice(1)} of ${hallCount} halls waived`;
  return hallNextThreshold === hallWaiverThreshold
    ? `${done} · ${all} at ${hallWaiverThreshold}+`
    : `${done} · next at ${hallNextThreshold}+, ${all} at ${hallWaiverThreshold}+`;
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
  const totalReceived = (input.advance || 0) + (input.paymentsTotal || 0);
  const balance = grandTotal - totalReceived;

  return {
    foodSubtotal,
    extrasTotal,
    kprTax,
    hallCharge,
    hallWaiverThreshold: hall.threshold,
    hallWaived: hall.waived,
    hallCount: hall.hallCount,
    hallWaivedCount: hall.waivedCount,
    hallNextThreshold: hall.nextThreshold,
    coolingCharge,
    heatingCharge,
    decoration,
    totalBeforeDiscount,
    discountAmount,
    grandTotal,
    totalReceived,
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
  > & { payments_total?: number | null },
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
      paymentsTotal: Number(booking.payments_total) || 0,
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
