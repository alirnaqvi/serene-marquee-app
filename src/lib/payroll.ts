import type { Employee, EmployeeAdvance, EmployeeAdjustment, LedgerEntry } from "@/types";

/**
 * PAYROLL RULES
 *
 *   Advance — the whole amount comes off the salary of the month it was given.
 *   Loan    — a fixed instalment comes off every month, starting from the month
 *             chosen when it was given, until the loan is paid back.
 *
 * Nobody has to press "deduct" any more: for every month the deductions are
 * worked out here, so Net Payable already shows what the employee takes home.
 *
 * A month is FIXED once its salary is paid. At that point the amounts that
 * were actually deducted are saved as 'repayment' rows (see
 * lockedRepaymentsFor), and from then on that month reads those rows instead
 * of re-working anything. Changing a loan's instalment later therefore only
 * affects months that haven't been paid yet — a paid month never moves.
 *
 * Old repayments that were applied by hand before this change are treated the
 * same way: whatever was recorded for a month is what that month deducted.
 *
 * If a month's salary is too small to take the whole amount due (a large
 * advance, say), it takes what it can and the rest simply stays outstanding
 * and comes off the next month.
 */

export type DeductionLine = {
  advance: EmployeeAdvance;
  /** Amount coming off this month's salary. */
  amount: number;
  /** Amount that was due but didn't fit in this month's pay. */
  shortfall: number;
  /** True when this month's figure is fixed (salary paid, or recorded by hand). */
  locked: boolean;
};

export type PayrollMonth = {
  month: string; // 'YYYY-MM'
  base: number;
  bonus: number;
  /** Manual one-off deductions (absence, damage...). */
  deduction: number;
  advanceCut: number;
  loanCut: number;
  lines: DeductionLine[];
  net: number;
  shortfall: number;
  payment: LedgerEntry | null;
  bonuses: EmployeeAdjustment[];
  deductions: EmployeeAdjustment[];
};

export type ItemBalance = {
  advance: EmployeeAdvance;
  recovered: number;
  outstanding: number;
};

export type EmployeePayroll = {
  /** Every month from the first with any activity up to `toMonth`, oldest first. */
  months: PayrollMonth[];
  /** The month asked for. */
  current: PayrollMonth;
  /** Each advance/loan, with what's left AFTER `toMonth`'s deduction. */
  items: ItemBalance[];
  loanOutstanding: number;
  advanceOutstanding: number;
};

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function addMonths(month: string, count: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + count, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** The first salary this advance/loan comes off. */
export function startMonthOf(a: EmployeeAdvance): string {
  return a.deduct_from || monthOf(a.issued_on);
}

/** What one month's instalment is for a loan (0 on a loan = all at once). */
export function instalmentOf(a: EmployeeAdvance, outstanding: number): number {
  if (a.kind === "advance") return outstanding;
  const per = Number(a.monthly_deduction) || 0;
  return per > 0 ? Math.min(per, outstanding) : outstanding;
}

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------
export function computeEmployeePayroll(args: {
  employee: Employee;
  advances: EmployeeAdvance[];
  adjustments: EmployeeAdjustment[];
  salaryEntries: LedgerEntry[];
  toMonth: string;
  /**
   * Work this month out afresh, ignoring any payment or saved repayments for
   * it. Used when a salary is being (re)recorded, to know what to deduct.
   */
  unlockMonth?: string;
}): EmployeePayroll {
  const { employee, toMonth, unlockMonth } = args;
  const advances = args.advances
    .filter((a) => a.employee_id === employee.id)
    .sort(
      (a, b) =>
        startMonthOf(a).localeCompare(startMonthOf(b)) ||
        a.issued_on.localeCompare(b.issued_on) ||
        a.created_at.localeCompare(b.created_at)
    );
  const adjustments = args.adjustments.filter((a) => a.employee_id === employee.id);
  const salaryEntries = args.salaryEntries.filter((e) => e.employee_id === employee.id);

  // Earliest month anything happened in, so balances carry forward correctly.
  const firstMonth = [
    toMonth,
    ...advances.map((a) => monthOf(a.issued_on)),
    ...advances.map(startMonthOf),
    ...adjustments.map((a) => a.month),
    ...salaryEntries.map((e) => e.salary_month || toMonth),
  ].sort()[0];

  const outstanding = new Map<string, number>(advances.map((a) => [a.id, Number(a.amount) || 0]));
  const months: PayrollMonth[] = [];

  for (let m = firstMonth; m <= toMonth; m = addMonths(m, 1)) {
    const unlocked = m === unlockMonth;
    const base = Number(employee.monthly_salary) || 0;
    const bonuses = adjustments.filter((a) => a.month === m && a.kind === "bonus");
    const deductions = adjustments.filter((a) => a.month === m && a.kind === "deduction");
    const bonus = bonuses.reduce((s, a) => s + Number(a.amount), 0);
    const deduction = deductions.reduce((s, a) => s + Number(a.amount), 0);
    const payment = unlocked ? null : salaryEntries.find((e) => e.salary_month === m) || null;

    let room = Math.max(0, base + bonus - deduction);
    const lines: DeductionLine[] = [];

    for (const adv of advances) {
      const left = outstanding.get(adv.id) || 0;
      const saved = unlocked
        ? 0
        : adjustments
            .filter((a) => a.advance_id === adv.id && a.month === m && a.kind === "repayment")
            .reduce((s, a) => s + Number(a.amount), 0);

      if (saved > 0) {
        // Fixed: whatever was actually deducted that month.
        const take = Math.min(saved, left);
        outstanding.set(adv.id, left - take);
        room = Math.max(0, room - take);
        lines.push({ advance: adv, amount: take, shortfall: 0, locked: true });
        continue;
      }

      if (left <= 0) continue;
      if (payment) continue; // salary already paid without this deduction
      if (m < startMonthOf(adv)) continue; // not due yet

      const due = instalmentOf(adv, left);
      const take = Math.min(due, room);
      room -= take;
      outstanding.set(adv.id, left - take);
      if (take > 0 || due > 0) {
        lines.push({ advance: adv, amount: take, shortfall: due - take, locked: false });
      }
    }

    const advanceCut = lines.filter((l) => l.advance.kind === "advance").reduce((s, l) => s + l.amount, 0);
    const loanCut = lines.filter((l) => l.advance.kind === "loan").reduce((s, l) => s + l.amount, 0);

    months.push({
      month: m,
      base,
      bonus,
      deduction,
      advanceCut,
      loanCut,
      lines,
      net: Math.max(0, base + bonus - deduction - advanceCut - loanCut),
      shortfall: lines.reduce((s, l) => s + l.shortfall, 0),
      payment,
      bonuses,
      deductions,
    });
  }

  // Only what had been handed over by the end of the month being looked at.
  const items: ItemBalance[] = advances.filter((a) => a.issued_on <= lastDayOf(toMonth)).map((a) => {
    const left = outstanding.get(a.id) || 0;
    return { advance: a, outstanding: left, recovered: (Number(a.amount) || 0) - left };
  });

  return {
    months,
    current: months[months.length - 1],
    items,
    loanOutstanding: items.filter((i) => i.advance.kind === "loan").reduce((s, i) => s + i.outstanding, 0),
    advanceOutstanding: items.filter((i) => i.advance.kind === "advance").reduce((s, i) => s + i.outstanding, 0),
  };
}

/**
 * The repayment rows to save when a month's salary is paid, so that month is
 * fixed at exactly what was deducted from it.
 */
export function lockedRepaymentsFor(
  args: Omit<Parameters<typeof computeEmployeePayroll>[0], "unlockMonth">,
  month: string
) {
  const fresh = computeEmployeePayroll({ ...args, toMonth: month, unlockMonth: month });
  return fresh.current.lines
    .filter((l) => l.amount > 0)
    .map((l) => ({
      advance_id: l.advance.id,
      amount: l.amount,
      kind: l.advance.kind,
    }));
}

/**
 * When a loan will be paid off at its current instalment, counting from the
 * month after `afterMonth`. Null when nothing is left.
 */
export function payoffMonth(item: ItemBalance, afterMonth: string): string | null {
  if (item.outstanding <= 0) return null;
  const per = item.advance.kind === "loan" ? Number(item.advance.monthly_deduction) || 0 : 0;
  if (per <= 0) return addMonths(afterMonth, 1);
  return addMonths(afterMonth, Math.ceil(item.outstanding / per));
}

/** One line of an employee's advance/loan account, vendor-diary style. */
export type AccountRow = {
  key: string;
  date: string; // ISO date
  description: string;
  given: number; // advance or loan handed over
  recovered: number; // taken back out of salary
  balance: number; // still owed by the employee after this line
  pending: boolean; // worked out for a month not yet paid
};

export function accountRows(payroll: EmployeePayroll, monthLabel: (m: string) => string): AccountRow[] {
  type Raw = Omit<AccountRow, "balance"> & { order: number };
  const raw: Raw[] = [];

  payroll.items.forEach(({ advance }) => {
    raw.push({
      key: `give-${advance.id}`,
      date: advance.issued_on,
      description: `${advance.kind === "loan" ? "Loan" : "Advance"} given${advance.notes ? ` — ${advance.notes}` : ""}`,
      given: Number(advance.amount) || 0,
      recovered: 0,
      pending: false,
      order: 0,
    });
  });

  payroll.months.forEach((pm) => {
    pm.lines
      .filter((l) => l.amount > 0)
      .forEach((l) => {
        raw.push({
          key: `rec-${l.advance.id}-${pm.month}`,
          date: pm.payment?.entry_date || lastDayOf(pm.month),
          description: `${l.advance.kind === "loan" ? "Loan instalment" : "Advance"} deducted from ${monthLabel(
            pm.month
          )} salary`,
          given: 0,
          recovered: l.amount,
          pending: !l.locked && !pm.payment,
          order: 1,
        });
      });
  });

  raw.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let balance = 0;
  return raw.map(({ order, ...r }) => {
    balance += r.given - r.recovered;
    return { ...r, balance };
  });
}
