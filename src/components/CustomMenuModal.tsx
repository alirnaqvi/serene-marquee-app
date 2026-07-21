"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "@/lib/calculations";
import type { AddonItem } from "@/types";

export type CustomSelection = {
  addon_item_id: string;
  name: string;
  unit_price: number;
  quantity: number;
};

export function resyncGuestQuantities(
  selection: CustomSelection[],
  items: AddonItem[],
  guests: number
): CustomSelection[] {
  return selection.map((s) => {
    const item = items.find((i) => i.id === s.addon_item_id);
    if (item && item.default_qty_mode === "guests" && s.quantity !== guests) {
      return { ...s, quantity: guests || 0 };
    }
    return s;
  });
}

export default function CustomMenuModal({
  items,
  guests,
  initialSelection,
  title = "Customized Menu",
  subtitle = "Pick items from the full 2026 menu — quantities default per guest count where relevant, but you can change any of them.",
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
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    const initial: Record<string, number> = {};
    initialSelection.forEach((s) => {
      initial[s.addon_item_id] = s.quantity;
    });
    setQuantities(initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useMemo(() => {
    const map = new Map<string, AddonItem[]>();
    [...items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((item) => {
        if (!map.has(item.category)) map.set(item.category, []);
        map.get(item.category)!.push(item);
      });
    return Array.from(map.entries());
  }, [items]);

  function toggle(item: AddonItem, checked: boolean) {
    setQuantities((prev) => {
      const next = { ...prev };
      if (checked) next[item.id] = item.default_qty_mode === "guests" ? guests || 0 : 1;
      else delete next[item.id];
      return next;
    });
  }

  // Per-head items must always reflect the CURRENT guest count, not whatever
  // it was when the item was first checked — otherwise the total silently
  // goes stale the moment someone edits the guest count afterward. Only
  // flat/per-unit items (Lamb Roast, Stalls) keep a manually editable qty.
  useEffect(() => {
    setQuantities((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const item = items.find((i) => i.id === id);
        if (item && item.default_qty_mode === "guests" && next[id] !== guests) {
          next[id] = guests || 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [guests, items]);

  function setQty(id: string, qty: number) {
    setQuantities((prev) => ({ ...prev, [id]: qty }));
  }

  const selectedTotal = Object.entries(quantities).reduce((sum, [id, qty]) => {
    const item = items.find((i) => i.id === id);
    return sum + (item ? item.price * qty : 0);
  }, 0);

  function handleConfirm() {
    const selection: CustomSelection[] = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => {
        const item = items.find((i) => i.id === id)!;
        return { addon_item_id: item.id, name: item.name, unit_price: item.price, quantity: qty };
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

        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {categories.map(([category, catItems]) => (
            <div key={category} className="mb-5 last:mb-0">
              <div className="text-xs font-bold text-gold-deep uppercase tracking-wide mb-2">{category}</div>
              <div className="flex flex-col gap-1.5">
                {catItems.map((item) => {
                  const checked = item.id in quantities;
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
                        <span>{item.name}</span>
                        <span className="text-muted text-xs">
                          ({money(item.price)} {item.default_qty_mode === "guests" ? "/ head" : "/ unit"})
                        </span>
                      </label>
                      {checked && (
                        <div className="flex items-center gap-2 shrink-0">
                          {item.default_qty_mode === "guests" ? (
                            <span className="w-24 text-xs text-muted text-right">× {guests || 0} guests</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              className="w-20 py-1 text-sm"
                              value={quantities[item.id] === 0 ? "" : quantities[item.id]}
                              placeholder="0"
                              onChange={(e) => setQty(item.id, e.target.value === "" ? 0 : Number(e.target.value))}
                            />
                          )}
                          <span className="text-xs text-muted w-24 text-right">
                            {money(item.price * (quantities[item.id] || 0))}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <div className="text-sm">
            <span className="text-muted">Selected total: </span>
            <span className="font-bold text-primary text-base">{money(selectedTotal)}</span>
            <span className="text-muted text-xs"> (before discount, KPRA tax, and other charges)</span>
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
  );
}
