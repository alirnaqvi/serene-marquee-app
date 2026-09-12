"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { money } from "@/lib/calculations";
import type { AddonItem } from "@/types";

export type CustomSelection = {
  addon_item_id: string;
  name: string;
  quantity: number;
  /** Rs. per unit. Zero for ordinary items, which the per-head rate covers. */
  unit_price: number;
  line_total: number;
  unit_label?: string | null;
};

function isPriced(item: AddonItem): boolean {
  return Boolean(item.priced) && Number(item.price) > 0;
}

/**
 * Ordinary items are per head, so their quantity is simply the guest count.
 * A priced item (Lamb Roast) is counted in lambs or leg pieces and is left
 * alone — changing the guest count must not change how many roasts were
 * ordered.
 */
export function resyncGuestQuantities(
  selection: CustomSelection[],
  items: AddonItem[],
  guests: number
): CustomSelection[] {
  return selection.map((s) => {
    const item = items.find((i) => i.id === s.addon_item_id);
    if (item && isPriced(item)) return s;
    return s.quantity === guests ? s : { ...s, quantity: guests || 0 };
  });
}

/** What the priced lines on a selection add up to. */
export function extrasTotalOf(selection: CustomSelection[]): number {
  return selection.reduce((sum, s) => sum + (s.line_total || 0), 0);
}

export default function CustomMenuModal({
  items,
  guests,
  initialSelection,
  title = "Customized Menu",
  subtitle = "Pick items from the full 2026 menu.",
  confirmLabel = "Add to Booking",
  onClose,
  onConfirm,
}: {
  items: AddonItem[];
  guests: number;
  initialSelection: CustomSelection[];
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (selection: CustomSelection[]) => void;
}) {
  // id -> quantity. For ordinary items this tracks the guest count; for a
  // priced item it is the number of pieces, typed in by hand.
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);

  useEffect(() => {
    const initial: Record<string, number> = {};
    initialSelection.forEach((s) => {
      initial[s.addon_item_id] = s.quantity;
    });
    setQuantities(initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The full menu runs to well over a hundred items across a dozen headings,
  // which is a long way to scroll when you already know you want Seekh Kebab.
  // Typing filters on the item name and on the heading it sits under, so
  // "lamb" finds the whole Lamb Roast section.
  const categories = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, AddonItem[]>();
    [...items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((item) => {
        if (onlySelected && !(item.id in quantities)) return false;
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
        );
      })
      .forEach((item) => {
        if (!map.has(item.category)) map.set(item.category, []);
        map.get(item.category)!.push(item);
      });
    return Array.from(map.entries());
  }, [items, search, onlySelected, quantities]);

  const matchCount = categories.reduce((n, [, list]) => n + list.length, 0);

  function toggle(item: AddonItem, checked: boolean) {
    setQuantities((prev) => {
      const next = { ...prev };
      if (checked) next[item.id] = isPriced(item) ? 1 : guests || 0;
      else delete next[item.id];
      return next;
    });
  }

  function setPieceCount(item: AddonItem, qty: number) {
    setQuantities((prev) => ({ ...prev, [item.id]: Math.max(0, qty) }));
  }

  // Ordinary items are per head, so every checked one must always reflect the
  // CURRENT guest count — otherwise the total silently goes stale the moment
  // someone edits the guest count afterward. Priced items are left alone.
  useEffect(() => {
    setQuantities((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const item = items.find((i) => i.id === id);
        if (item && isPriced(item)) continue;
        if (next[id] !== guests) {
          next[id] = guests || 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [guests, items]);

  const selectedIds = Object.keys(quantities);
  const selectedCount = selectedIds.length;

  const pricedLines = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is AddonItem => Boolean(i) && isPriced(i as AddonItem))
    .map((item) => ({
      item,
      qty: quantities[item.id] || 0,
      total: (quantities[item.id] || 0) * Number(item.price),
    }));
  const extrasTotal = pricedLines.reduce((s, l) => s + l.total, 0);

  function handleConfirm() {
    const selection: CustomSelection[] = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => {
        const item = items.find((i) => i.id === id)!;
        const priced = isPriced(item);
        const unitPrice = priced ? Number(item.price) : 0;
        return {
          addon_item_id: item.id,
          name: item.name,
          quantity: qty,
          unit_price: unitPrice,
          line_total: unitPrice * qty,
          unit_label: priced ? item.unit_label ?? null : null,
        };
      });
    onConfirm(selection);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <div className="font-serif text-lg font-bold text-primary">{title}</div>
            <div className="text-xs text-muted mt-0.5">{subtitle}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-primary text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="relative">
            <Search
              size={15}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              autoFocus
              className="w-full text-sm pl-9 pr-9"
              placeholder="Search items — e.g. lamb, kebab, salad, dessert…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary p-1"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 mt-2">
            <label className="flex items-center gap-1.5 text-[11.5px] text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={onlySelected}
                onChange={(e) => setOnlySelected(e.target.checked)}
              />
              Show only what I&apos;ve picked
            </label>
            {search && (
              <div className="text-[11.5px] text-muted">
                {matchCount} match{matchCount === 1 ? "" : "es"}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 max-h-[52vh] overflow-y-auto">
          {categories.length === 0 && (
            <div className="text-center text-muted text-sm py-10">Nothing matches that search.</div>
          )}
          {categories.map(([category, catItems]) => (
            <div key={category} className="mb-5 last:mb-0">
              <div className="text-xs font-bold text-gold-deep uppercase tracking-wide mb-2">{category}</div>
              <div className="flex flex-col gap-1.5">
                {catItems.map((item) => {
                  const checked = item.id in quantities;
                  const priced = isPriced(item);
                  const qty = quantities[item.id] || 0;
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${
                        checked ? "border-gold bg-gold-light/40" : "border-border"
                      }`}
                    >
                      <label className="flex items-center gap-2.5 flex-1 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggle(item, e.target.checked)}
                        />
                        <span>
                          {item.name}
                          {priced && (
                            <span className="block text-[11px] text-gold-deep font-semibold">
                              {money(item.price)} per {item.unit_label || "piece"} — charged on top of the
                              per-head rate
                            </span>
                          )}
                        </span>
                      </label>
                      {checked && (
                        <div className="flex items-center gap-2 shrink-0">
                          {priced ? (
                            <>
                              <input
                                type="number"
                                min={0}
                                className="w-16 text-[12.5px] text-right"
                                value={qty}
                                onChange={(e) => setPieceCount(item, Number(e.target.value))}
                              />
                              <span className="text-[11px] text-muted w-20">
                                {item.unit_label || "piece"}
                                {qty === 1 ? "" : "s"}
                              </span>
                              <span className="w-24 text-[12px] font-bold text-gold-deep text-right">
                                {money(qty * Number(item.price))}
                              </span>
                            </>
                          ) : (
                            <span className="w-24 text-xs text-muted text-right">× {guests || 0} guests</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border">
          {pricedLines.length > 0 && (
            <div className="bg-gold-light border border-gold/30 rounded-lg px-3 py-2.5 mb-3 text-[12px]">
              <div className="font-bold text-gold-deep mb-1">Charged separately, by the piece</div>
              {pricedLines.map((l) => (
                <div key={l.item.id} className="flex justify-between text-[#6B5320]">
                  <span>
                    {l.item.name} × {l.qty}
                  </span>
                  <span className="font-semibold">{money(l.total)}</span>
                </div>
              ))}
              <div className="flex justify-between font-bold text-gold-deep border-t border-gold/30 mt-1 pt-1">
                <span>Added to the booking total</span>
                <span>{money(extrasTotal)}</span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-muted">Selected: </span>
              <span className="font-bold text-primary text-base">{selectedCount}</span>
              <span className="text-muted text-xs"> item{selectedCount === 1 ? "" : "s"}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button onClick={handleConfirm} className="btn-primary rounded-lg px-4 py-2 text-sm">
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
