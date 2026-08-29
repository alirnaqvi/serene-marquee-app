"use client";

import { useSession } from "@/components/SessionContext";
import { ROLE_LABELS } from "@/types";

type NumField = number | "";

/**
 * Discount input with the signed-in role's ceiling built in.
 *
 *   Manager ............ Rs.  50,000 per booking  (currently Zain Syed)
 *   General Manager .... Rs. 100,000 per booking  (currently Ikram Abbasi)
 *   Staff / Owner ...... no discount authority
 *   Admin / Developer .. unlimited
 *
 * The same ceilings are enforced by the enforce_discount_limit() trigger in
 * Postgres, so this component is the courteous warning rather than the lock.
 */
export default function DiscountField({
  value,
  onChange,
  className = "",
}: {
  value: NumField;
  onChange: (v: NumField) => void;
  className?: string;
}) {
  const { role, discountLimit } = useSession();
  const amount = Number(value) || 0;
  const unlimited = discountLimit === Infinity;
  const notPermitted = discountLimit === 0;
  const overLimit = !unlimited && amount > discountLimit;

  return (
    <div className={className}>
      <label className="text-xs font-bold text-muted uppercase">Discount (Rs.)</label>
      <input
        type="number"
        min={0}
        max={unlimited ? undefined : discountLimit}
        className={`w-full mt-1 ${overLimit ? "border-rose" : ""}`}
        value={notPermitted ? "" : value}
       
        disabled={notPermitted}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
      {notPermitted ? (
        <div className="text-[11px] text-muted mt-1">
          {ROLE_LABELS[role]} accounts can't apply a discount. Ask a manager to approve one.
        </div>
      ) : overLimit ? (
        <div className="text-[11px] text-rose font-semibold mt-1">
          Over your limit — {ROLE_LABELS[role]} may approve up to Rs.{" "}
          {discountLimit.toLocaleString("en-PK")} per booking.
        </div>
      ) : (
        <div className="text-[11px] text-muted mt-1">
          Your limit: {unlimited ? "no limit" : `Rs. ${discountLimit.toLocaleString("en-PK")} per booking`}
        </div>
      )}
    </div>
  );
}

/** Returns an error message if the amount exceeds the role's ceiling. */
export function discountError(amount: number, limit: number, role: string): string | null {
  if (limit === Infinity) return null;
  if (amount > limit) {
    return limit === 0
      ? `${role} accounts are not permitted to apply a discount.`
      : `Discount limit exceeded — you may approve a maximum of Rs. ${limit.toLocaleString(
          "en-PK"
        )} per booking.`;
  }
  return null;
}
