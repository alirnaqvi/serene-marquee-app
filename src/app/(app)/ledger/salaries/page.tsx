"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY } from "@/lib/dateFormat";
import { monthName, currentMonth, recentMonths, downloadXlsx, type SheetColumn } from "@/lib/xlsx";
import {
  computeEmployeePayroll,
  lockedRepaymentsFor,
  accountRows,
  payoffMonth,
  addMonths,
  monthOf,
  startMonthOf,
  type EmployeePayroll,
} from "@/lib/payroll";
import AlertModal from "@/components/AlertModal";
import { useSession, ReadOnlyNotice } from "@/components/SessionContext";
import type { Employee, EmployeeAdvance, EmployeeAdjustment, LedgerEntry } from "@/types";

type NumField = number | "";
const n = (v: NumField) => Number(v) || 0;
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Modal =
  | { kind: "pay"; employee: Employee }
  | { kind: "adjust"; employee: Employee }
  | { kind: "advance"; employee: Employee }
  | { kind: "loan"; employee: Employee }
  | { kind: "editItem"; employee: Employee; item: EmployeeAdvance }
  | { kind: "employee"; employee?: Employee }
  | null;

/**
 * PAYROLL
 *
 * One row per employee showing exactly what they take home this month. The
 * two ways money is handed over early are kept apart because they are
 * recovered differently:
 *
 *   Advance — comes off THIS month's salary, all of it.
 *   Loan    — comes off a fixed amount every month until it's paid back.
 *
 * Both are worked out automatically (lib/payroll.ts), so Net Payable is always
 * the real figure — there's no "apply instalment" button to forget.
 *
 * Clicking an employee opens their own ledger, like a vendor's account: what
 * they were given, what has come back out of their salary, what they still
 * owe, and every month's pay.
 */
export default function SalariesPage() {
  const supabase = createClient();
  const { readOnly } = useSession();

  const [restricted, setRestricted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [advances, setAdvances] = useState<EmployeeAdvance[]>([]);
  const [adjustments, setAdjustments] = useState<EmployeeAdjustment[]>([]);
  const [salaryEntries, setSalaryEntries] = useState<LedgerEntry[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [showLeavers, setShowLeavers] = useState(false);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edit a payment from an earlier month: switch the screen to that month,
  // then open the payment form once the figures for it are ready.
  const [pendingPay, setPendingPay] = useState<{ empId: string; month: string } | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "left"; employee: Employee }
    | { kind: "deleteItem"; item: EmployeeAdvance }
    | { kind: "undoPay"; employee: Employee; entry: LedgerEntry }
    | null
  >(null);

  // ---- form state ----
  const [amount, setAmount] = useState<NumField>("");
  const [monthly, setMonthly] = useState<NumField>("");
  const [firstMonth, setFirstMonth] = useState(currentMonth());
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [toLedger, setToLedger] = useState(true);
  const [handedTo, setHandedTo] = useState("");
  const [adjKind, setAdjKind] = useState<"bonus" | "deduction">("bonus");

  const [empName, setEmpName] = useState("");
  const [empDesignation, setEmpDesignation] = useState("");
  const [empSalary, setEmpSalary] = useState<NumField>("");
  const [empPhone, setEmpPhone] = useState("");
  const [empJoined, setEmpJoined] = useState(todayIso());
  const [empSalaryReason, setEmpSalaryReason] = useState("");

  async function load() {
    const [{ data: emp, error: empError }, { data: adv }, { data: adj }, { data: entries }] = await Promise.all([
      supabase.from("employees").select("*").order("full_name"),
      supabase.from("employee_advances").select("*").order("issued_on"),
      supabase.from("employee_adjustments").select("*"),
      supabase.from("ledger_entries").select("*").eq("category", "salary"),
    ]);
    if (empError) {
      setRestricted(true);
      setLoading(false);
      return;
    }
    setEmployees(emp || []);
    setAdvances(adv || []);
    setAdjustments(adj || []);
    setSalaryEntries(entries || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Everyone's figures for the month on screen, worked out once.
  const payroll = useMemo(() => {
    const map = new Map<string, EmployeePayroll>();
    employees.forEach((e) =>
      map.set(e.id, computeEmployeePayroll({ employee: e, advances, adjustments, salaryEntries, toMonth: month }))
    );
    return map;
  }, [employees, advances, adjustments, salaryEntries, month]);

  const visibleEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return employees.filter((e) => {
      if (!showLeavers && !e.active) return false;
      if (!q) return true;
      return (
        e.full_name.toLowerCase().includes(q) ||
        (e.designation || "").toLowerCase().includes(q) ||
        (digits.length >= 3 && (e.phone || "").replace(/\D/g, "").includes(digits))
      );
    });
  }, [employees, showLeavers, search]);

  const active = employees.filter((e) => e.active);
  const sum = (f: (p: EmployeePayroll) => number) => active.reduce((s, e) => s + f(payroll.get(e.id)!), 0);
  const totals = {
    base: sum((p) => p.current.base),
    advanceCut: sum((p) => p.current.advanceCut),
    loanCut: sum((p) => p.current.loanCut),
    net: sum((p) => p.current.net),
    paid: sum((p) => p.current.payment?.amount || 0),
    owed: employees.reduce((s, e) => {
      const p = payroll.get(e.id);
      return s + (p ? p.loanOutstanding + p.advanceOutstanding : 0);
    }, 0),
  };

  const openEmployee = employees.find((e) => e.id === openId) || null;

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  async function uid() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id;
  }
  function guard(): boolean {
    if (readOnly) {
      setError("Your account is monitor-only and cannot record payroll changes.");
      return false;
    }
    return true;
  }
  function resetForm() {
    setAmount("");
    setMonthly("");
    setDate(todayIso());
    setNote("");
    setToLedger(true);
    setError(null);
  }
  function close() {
    setModal(null);
    setError(null);
  }

  function openPay(emp: Employee) {
    const p = payroll.get(emp.id)!.current;
    resetForm();
    setAmount(p.payment ? p.payment.amount : p.net);
    setHandedTo(p.payment?.handed_to || emp.full_name);
    setDate(p.payment?.entry_date || todayIso());
    setModal({ kind: "pay", employee: emp });
  }
  function requestEditPay(emp: Employee, m: string) {
    if (m === month) return openPay(emp);
    setPendingPay({ empId: emp.id, month: m });
    setMonth(m);
  }
  useEffect(() => {
    if (!pendingPay || pendingPay.month !== month) return;
    const emp = employees.find((e) => e.id === pendingPay.empId);
    setPendingPay(null);
    if (emp && payroll.get(emp.id)) openPay(emp);
  }, [pendingPay, month, payroll]); // eslint-disable-line react-hooks/exhaustive-deps

  function openAdvance(emp: Employee) {
    resetForm();
    setModal({ kind: "advance", employee: emp });
  }
  function openLoan(emp: Employee) {
    resetForm();
    setFirstMonth(month);
    setModal({ kind: "loan", employee: emp });
  }
  function openAdjust(emp: Employee) {
    resetForm();
    setAdjKind("bonus");
    setModal({ kind: "adjust", employee: emp });
  }
  function openEditItem(emp: Employee, item: EmployeeAdvance) {
    resetForm();
    setMonthly(item.monthly_deduction || "");
    setFirstMonth(startMonthOf(item));
    setNote(item.notes || "");
    setModal({ kind: "editItem", employee: emp, item });
  }
  function openEmployeeForm(emp?: Employee) {
    setError(null);
    setEmpName(emp?.full_name || "");
    setEmpDesignation(emp?.designation || "");
    setEmpSalary(emp?.monthly_salary ?? "");
    setEmpPhone(emp?.phone || "");
    setEmpJoined(emp?.joined_on || todayIso());
    setEmpSalaryReason("");
    setModal({ kind: "employee", employee: emp });
  }

  // ---------------------------------------------------------------------
  // actions
  // ---------------------------------------------------------------------

  /**
   * Pay a month's salary, and fix that month's advance/loan deductions at
   * exactly what was taken — so a later change to a loan never rewrites a
   * month that has already been paid.
   */
  async function savePayment(emp: Employee) {
    if (!guard()) return;
    if (n(amount) <= 0) return setError("Enter the amount being paid.");
    setBusy(true);
    const me = await uid();
    const existing = payroll.get(emp.id)!.current.payment;

    const { error: err } = existing
      ? await supabase
          .from("ledger_entries")
          .update({ entry_date: date, amount: n(amount), handed_to: handedTo.trim() || emp.full_name })
          .eq("id", existing.id)
      : await supabase.from("ledger_entries").insert({
          entry_date: date,
          type: "expense",
          description: `Salary — ${emp.full_name} (${emp.designation}) — ${monthName(month)}`,
          amount: n(amount),
          handed_to: handedTo.trim() || emp.full_name,
          employee_id: emp.id,
          salary_month: month,
          category: "salary",
          created_by: me,
        });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }

    const lines = lockedRepaymentsFor({ employee: emp, advances, adjustments, salaryEntries, toMonth: month }, month);
    await supabase
      .from("employee_adjustments")
      .delete()
      .eq("employee_id", emp.id)
      .eq("month", month)
      .eq("kind", "repayment");
    if (lines.length) {
      await supabase.from("employee_adjustments").insert(
        lines.map((l) => ({
          employee_id: emp.id,
          month,
          kind: "repayment",
          amount: l.amount,
          advance_id: l.advance_id,
          notes: `${l.kind === "loan" ? "Loan instalment" : "Advance"} — ${monthName(month)}`,
          created_by: me,
        }))
      );
    }
    setBusy(false);
    close();
    load();
  }

  async function undoPayment(emp: Employee, entry: LedgerEntry) {
    if (!guard()) return;
    await supabase.from("ledger_entries").delete().eq("id", entry.id);
    await supabase
      .from("employee_adjustments")
      .delete()
      .eq("employee_id", emp.id)
      .eq("month", entry.salary_month || month)
      .eq("kind", "repayment");
    setConfirm(null);
    load();
  }

  async function saveItem(emp: Employee, kind: "advance" | "loan") {
    if (!guard()) return;
    if (n(amount) <= 0) return setError("Enter the amount handed over.");
    if (kind === "loan" && n(monthly) <= 0) return setError("Enter how much comes off each month's salary.");
    if (kind === "loan" && n(monthly) > n(amount)) return setError("The monthly deduction can't be more than the loan.");
    setBusy(true);
    const me = await uid();
    const { error: err } = await supabase.from("employee_advances").insert({
      employee_id: emp.id,
      kind,
      amount: n(amount),
      monthly_deduction: kind === "loan" ? n(monthly) : 0,
      issued_on: date,
      // An advance always comes off the salary of the month it's given.
      deduct_from: kind === "loan" ? firstMonth : monthOf(date),
      notes: note.trim() || null,
      created_by: me,
    });
    if (err) {
      setError(err.message.includes("deduct_from") ? "Run database migration 2026-18 first." : err.message);
      setBusy(false);
      return;
    }
    if (toLedger) {
      await supabase.from("ledger_entries").insert({
        entry_date: date,
        type: "expense",
        description: `${kind === "loan" ? "Loan" : "Advance"} — ${emp.full_name} (${emp.designation})`,
        amount: n(amount),
        handed_to: emp.full_name,
        employee_id: emp.id,
        category: "advance",
        created_by: me,
      });
    }
    setBusy(false);
    close();
    load();
  }

  async function updateItem(item: EmployeeAdvance) {
    if (!guard()) return;
    if (item.kind === "loan" && n(monthly) <= 0) return setError("Enter how much comes off each month's salary.");
    setBusy(true);
    const { error: err } = await supabase
      .from("employee_advances")
      .update({
        monthly_deduction: item.kind === "loan" ? n(monthly) : 0,
        deduct_from: firstMonth,
        notes: note.trim() || null,
      })
      .eq("id", item.id);
    setBusy(false);
    if (err) return setError(err.message);
    close();
    load();
  }

  async function deleteItem(item: EmployeeAdvance) {
    if (!guard()) return;
    const locked = adjustments.some((a) => a.advance_id === item.id && a.kind === "repayment");
    if (locked) {
      setError("Part of this has already been deducted from a paid salary, so it can't be deleted.");
      setConfirm(null);
      return;
    }
    await supabase.from("employee_advances").delete().eq("id", item.id);
    // Take the matching "money handed over" line back out of the daily ledger.
    const { data: led } = await supabase
      .from("ledger_entries")
      .select("id")
      .eq("employee_id", item.employee_id)
      .eq("category", "advance")
      .eq("entry_date", item.issued_on)
      .eq("amount", item.amount)
      .limit(1);
    if (led && led[0]) await supabase.from("ledger_entries").delete().eq("id", led[0].id);
    setConfirm(null);
    load();
  }

  async function saveAdjustment(emp: Employee) {
    if (!guard()) return;
    if (n(amount) <= 0) return setError("Enter an amount greater than zero.");
    setBusy(true);
    await supabase.from("employee_adjustments").insert({
      employee_id: emp.id,
      month,
      kind: adjKind,
      amount: n(amount),
      notes: note.trim() || null,
      created_by: await uid(),
    });
    setBusy(false);
    close();
    load();
  }

  async function removeAdjustment(id: string) {
    if (!guard()) return;
    await supabase.from("employee_adjustments").delete().eq("id", id);
    load();
  }

  async function saveEmployee(existing?: Employee) {
    if (!guard()) return;
    if (!empName.trim()) return setError("Enter the employee's name.");
    if (!empDesignation.trim()) return setError("Enter a designation.");
    setBusy(true);
    const me = await uid();
    const row = {
      full_name: empName.trim(),
      designation: empDesignation.trim(),
      monthly_salary: n(empSalary),
      phone: empPhone.trim() || null,
      joined_on: empJoined || null,
    };
    if (existing) {
      const { error: err } = await supabase.from("employees").update(row).eq("id", existing.id);
      if (err) {
        setError(err.message);
        setBusy(false);
        return;
      }
      if (n(empSalary) !== existing.monthly_salary) {
        await supabase.from("employee_salary_changes").insert({
          employee_id: existing.id,
          old_salary: existing.monthly_salary,
          new_salary: n(empSalary),
          effective_from: todayIso(),
          reason: empSalaryReason.trim() || null,
          created_by: me,
        });
      }
    } else {
      const { error: err } = await supabase.from("employees").insert({ ...row, active: true });
      if (err) {
        setError(err.message.includes("duplicate") ? "An employee with that exact name already exists." : err.message);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    close();
    load();
  }

  async function markAsLeft(emp: Employee) {
    if (!guard()) return;
    await supabase.from("employees").update({ active: false, left_on: todayIso() }).eq("id", emp.id);
    setConfirm(null);
    load();
  }
  async function reinstate(emp: Employee) {
    if (!guard()) return;
    await supabase.from("employees").update({ active: true, left_on: null }).eq("id", emp.id);
    load();
  }

  // ---------------------------------------------------------------------
  // export
  // ---------------------------------------------------------------------
  type ExportRow = { emp: Employee; p: EmployeePayroll };
  const exportColumns: SheetColumn<ExportRow>[] = [
    { header: "Employee", value: (r) => r.emp.full_name, width: 24 },
    { header: "Designation", value: (r) => r.emp.designation, width: 18 },
    { header: "Base Salary", value: (r) => Math.round(r.p.current.base), money: true },
    { header: "Bonus", value: (r) => Math.round(r.p.current.bonus), money: true },
    { header: "Deductions", value: (r) => Math.round(r.p.current.deduction), money: true },
    { header: "Advance Cut", value: (r) => Math.round(r.p.current.advanceCut), money: true },
    { header: "Loan Instalment", value: (r) => Math.round(r.p.current.loanCut), money: true },
    { header: "Net Payable", value: (r) => Math.round(r.p.current.net), money: true },
    { header: "Paid", value: (r) => Math.round(r.p.current.payment?.amount || 0), money: true },
    { header: "Paid On", value: (r) => (r.p.current.payment ? fmtDMY(r.p.current.payment.entry_date) : "") },
    { header: "Loan Balance", value: (r) => Math.round(r.p.loanOutstanding), money: true },
    { header: "Advance Balance", value: (r) => Math.round(r.p.advanceOutstanding), money: true },
  ];
  type ItemRow = { emp: Employee; item: EmployeePayroll["items"][number] };
  const itemColumns: SheetColumn<ItemRow>[] = [
    { header: "Employee", value: (r) => r.emp.full_name, width: 24 },
    { header: "Type", value: (r) => (r.item.advance.kind === "loan" ? "Loan" : "Advance") },
    { header: "Given On", value: (r) => fmtDMY(r.item.advance.issued_on) },
    { header: "Amount", value: (r) => Math.round(r.item.advance.amount), money: true },
    {
      header: "Deducted",
      value: (r) =>
        r.item.advance.kind === "loan"
          ? `Rs. ${Math.round(r.item.advance.monthly_deduction).toLocaleString("en-PK")} / month from ${monthName(
              startMonthOf(r.item.advance)
            )}`
          : `All from ${monthName(startMonthOf(r.item.advance))}`,
      width: 30,
    },
    { header: "Recovered", value: (r) => Math.round(r.item.recovered), money: true },
    { header: "Outstanding", value: (r) => Math.round(r.item.outstanding), money: true },
    { header: "Notes", value: (r) => r.item.advance.notes || "", width: 28 },
  ];

  function handleExport() {
    const rows = visibleEmployees.map((emp) => ({ emp, p: payroll.get(emp.id)! }));
    const items = employees.flatMap((emp) => payroll.get(emp.id)!.items.map((item) => ({ emp, item })));
    const t = (f: (r: ExportRow) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0));
    downloadXlsx(`serene-marquee-payroll-${month}`, [
      {
        name: monthName(month),
        columns: exportColumns,
        rows,
        titleLines: ["Serene Marquee — Payroll", `Month: ${monthName(month)}`],
        totalsRow: [
          "TOTAL",
          "",
          t((r) => r.p.current.base),
          t((r) => r.p.current.bonus),
          t((r) => r.p.current.deduction),
          t((r) => r.p.current.advanceCut),
          t((r) => r.p.current.loanCut),
          t((r) => r.p.current.net),
          t((r) => r.p.current.payment?.amount || 0),
          "",
          t((r) => r.p.loanOutstanding),
          t((r) => r.p.advanceOutstanding),
        ],
      },
      {
        name: "Advances & Loans",
        columns: itemColumns,
        rows: items,
        titleLines: ["Serene Marquee — Advances & Loans", `Balances after ${monthName(month)}`],
      },
    ]);
  }

  // ---------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------
  if (loading) return <div className="text-muted text-sm">Loading…</div>;
  if (restricted) {
    return (
      <div className="card max-w-md">
        <div className="text-[14.5px] font-bold text-primary mb-2">Ledger access restricted</div>
        <div className="text-sm text-muted">
          Your account doesn't have permission to view payroll. Ask an owner or manager to grant ledger access.
        </div>
      </div>
    );
  }

  const monthOptions = Array.from(new Set([...recentMonths(18), addMonths(currentMonth(), 1)])).sort().reverse();
  const futureMonths = Array.from({ length: 7 }, (_, i) => addMonths(monthOf(date), i));

  return (
    <div>
      <Link href="/ledger" className="text-xs font-bold text-gold-deep hover:underline">
        &larr; Back to Ledger
      </Link>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-2 mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Payroll / Salaries</div>
          <div className="text-xs text-muted mt-0.5">Click an employee to open their ledger.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="text-sm" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
          <button onClick={handleExport} className="btn-ghost rounded-lg px-3 py-2 text-sm">
            ⤓ Excel
          </button>
          {!readOnly && (
            <button onClick={() => openEmployeeForm()} className="btn-primary rounded-lg px-4 py-2 text-sm">
              + Add Employee
            </button>
          )}
        </div>
      </div>

      {readOnly && <ReadOnlyNotice what="payroll" />}
      {error && !modal && <div className="text-rose text-sm font-semibold my-2">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4 my-4">
        <Card label="Base Payroll" value={money(totals.base)} />
        <Card label="Advances Cut" value={`-${money(totals.advanceCut)}`} tone="rose" />
        <Card label="Loan Instalments" value={`-${money(totals.loanCut)}`} tone="rose" />
        <Card label="Net Payable" value={money(totals.net)} strong />
        <Card label="Still To Pay" value={money(Math.max(0, totals.net - totals.paid))} sub={`${money(totals.paid)} paid`} />
        <Card label="Owed By Staff" value={money(totals.owed)} sub="loans + advances" tone="rose" />
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <Rule
          title="Advance"
          text="Money given early against this month's pay. The whole amount comes off the salary of the month it's given."
        />
        <Rule
          title="Loan"
          text="A larger sum paid back over time. A fixed amount you choose comes off every month's salary until it's cleared."
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-[13px] font-bold text-primary">
            {monthName(month)} — {visibleEmployees.length} employee{visibleEmployees.length === 1 ? "" : "s"}
          </div>
          <input
            className="flex-1 min-w-[200px] text-[13px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, designation or phone…"
          />
          <button
            onClick={() => setShowLeavers((s) => !s)}
            className="text-xs font-bold text-gold-deep hover:underline whitespace-nowrap"
          >
            {showLeavers ? "Hide past employees" : `Show past employees (${employees.length - active.length})`}
          </button>
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
                <th className="py-2 px-2">Employee</th>
                <th className="py-2 px-2 text-right">Base</th>
                <th className="py-2 px-2 text-right">Advance</th>
                <th className="py-2 px-2 text-right">Loan</th>
                <th className="py-2 px-2 text-right">Bonus / Deduction</th>
                <th className="py-2 px-2 text-right">Net Payable</th>
                <th className="py-2 px-2 text-right">Still Owes</th>
                <th className="py-2 px-2">Salary</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-muted text-sm">
                    No employees match “{search.trim()}”
                  </td>
                </tr>
              )}
              {visibleEmployees.map((emp) => {
                const p = payroll.get(emp.id)!;
                const c = p.current;
                const extra = c.bonus - c.deduction;
                const owes = p.loanOutstanding + p.advanceOutstanding;
                return (
                  <tr
                    key={emp.id}
                    onClick={() => setOpenId(emp.id)}
                    className={`border-b border-border last:border-0 hover:bg-[#FBF8ED] cursor-pointer ${
                      emp.active ? "" : "opacity-60"
                    }`}
                  >
                    <td className="py-2.5 px-2">
                      <div className="font-semibold">{emp.full_name}</div>
                      <div className="text-[11px] text-muted">
                        {emp.designation}
                        {!emp.active && <span className="text-rose"> · Left{emp.left_on ? ` ${fmtDMY(emp.left_on)}` : ""}</span>}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right">{money(c.base)}</td>
                    <td className="py-2.5 px-2 text-right text-rose">{c.advanceCut ? `-${money(c.advanceCut)}` : "—"}</td>
                    <td className="py-2.5 px-2 text-right text-rose">{c.loanCut ? `-${money(c.loanCut)}` : "—"}</td>
                    <td className={`py-2.5 px-2 text-right ${extra >= 0 ? "text-gold-deep" : "text-rose"}`}>
                      {extra ? `${extra > 0 ? "+" : "-"}${money(Math.abs(extra))}` : "—"}
                    </td>
                    <td className="py-2.5 px-2 text-right font-bold">
                      {money(c.net)}
                      {c.shortfall > 0 && (
                        <div className="text-[10px] text-rose font-normal">{money(c.shortfall)} carried to next month</div>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {owes > 0 ? <span className="font-semibold text-rose">{money(owes)}</span> : <span className="text-muted">Clear</span>}
                    </td>
                    <td className="py-2.5 px-2">
                      {c.payment ? (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-primary-dim text-gold-deep whitespace-nowrap">
                          Paid {fmtDMY(c.payment.entry_date)}
                        </span>
                      ) : (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-light text-rose">
                          Not paid
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1.5 justify-end">
                        {!readOnly && emp.active && !c.payment && (
                          <button onClick={() => openPay(emp)} className="btn-primary rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap">
                            Pay {money(c.net)}
                          </button>
                        )}
                        <button onClick={() => setOpenId(emp.id)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap">
                          Ledger
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------ EMPLOYEE LEDGER ------------------------ */}
      {openEmployee && (
        <EmployeeLedger
          emp={openEmployee}
          p={payroll.get(openEmployee.id)!}
          month={month}
          readOnly={readOnly}
          error={!modal ? error : null}
          onClose={() => {
            setOpenId(null);
            setError(null);
          }}
          onPay={() => openPay(openEmployee)}
          onEditPay={(m) => requestEditPay(openEmployee, m)}
          onUndoPay={(entry) => setConfirm({ kind: "undoPay", employee: openEmployee, entry })}
          onAdvance={() => openAdvance(openEmployee)}
          onLoan={() => openLoan(openEmployee)}
          onAdjust={() => openAdjust(openEmployee)}
          onRemoveAdjustment={removeAdjustment}
          onEditItem={(item) => openEditItem(openEmployee, item)}
          onDeleteItem={(item) => setConfirm({ kind: "deleteItem", item })}
          onEdit={() => openEmployeeForm(openEmployee)}
          onLeft={() => setConfirm({ kind: "left", employee: openEmployee })}
          onReinstate={() => reinstate(openEmployee)}
        />
      )}

      {/* ---------------------------- MODALS ---------------------------- */}
      {modal && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden my-8">
            <div className="px-5 py-4 border-b border-border">
              <div className="font-bold text-sm text-primary">
                {modal.kind === "pay" &&
                  `${payroll.get(modal.employee.id)?.current.payment ? "Edit" : "Pay"} ${monthName(month)} salary — ${modal.employee.full_name}`}
                {modal.kind === "advance" && `Give an advance — ${modal.employee.full_name}`}
                {modal.kind === "loan" && `Give a loan — ${modal.employee.full_name}`}
                {modal.kind === "editItem" &&
                  `Change ${modal.item.kind === "loan" ? "loan" : "advance"} — ${modal.employee.full_name}`}
                {modal.kind === "adjust" && `Bonus or deduction — ${modal.employee.full_name}`}
                {modal.kind === "employee" && (modal.employee ? `Edit — ${modal.employee.full_name}` : "Add New Employee")}
              </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3">
              {error && <div className="text-rose text-[12.5px] font-semibold">{error}</div>}

              {modal.kind === "pay" &&
                (() => {
                  const c = payroll.get(modal.employee.id)!.current;
                  return (
                    <>
                      <Breakdown c={c} />
                      <Field label="Amount Paid">
                        <input type="number" className="w-full mt-1" value={amount} onChange={(e) => setAmount(num(e))} />
                        {n(amount) !== c.net && amount !== "" && (
                          <div className="text-[11px] text-rose mt-1">
                            Differs from net payable by {money(Math.abs(n(amount) - c.net))}.
                          </div>
                        )}
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Handed To">
                          <input className="w-full mt-1" value={handedTo} onChange={(e) => setHandedTo(e.target.value)} />
                        </Field>
                        <Field label="Payment Date">
                          <input type="date" className="w-full mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
                        </Field>
                      </div>
                      <div className="text-[11px] text-muted">
                        Posts to the daily ledger as an expense. The advance and loan amounts above are fixed for{" "}
                        {monthName(month)} once paid.
                      </div>
                    </>
                  );
                })()}

              {modal.kind === "advance" &&
                (() => {
                  const c = payroll.get(modal.employee.id)!.current;
                  const salaryMonth = monthOf(date);
                  return (
                    <>
                      <div className="bg-gold-light/60 border border-gold/30 rounded-lg px-3 py-2 text-[11.5px] text-[#6B5320]">
                        The whole advance comes off the <b>{monthName(salaryMonth)}</b> salary. For money paid back over
                        several months, give a loan instead.
                      </div>
                      <Field label="Amount Given">
                        <input type="number" className="w-full mt-1" value={amount} onChange={(e) => setAmount(num(e))} autoFocus />
                      </Field>
                      <Field label="Date Given">
                        <input type="date" className="w-full mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
                      </Field>
                      <Field label="Note (optional)">
                        <input className="w-full mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. family emergency" />
                      </Field>
                      {n(amount) > 0 && salaryMonth === month && (
                        <div className="text-[12px] bg-bg border border-dashed border-border rounded-lg px-3 py-2">
                          {monthName(month)} net payable: {money(c.net)} →{" "}
                          <b className="text-primary">{money(Math.max(0, c.net - n(amount)))}</b>
                          {n(amount) > c.net && (
                            <div className="text-rose text-[11px] mt-0.5">
                              {money(n(amount) - c.net)} is more than this month's pay and carries to next month.
                            </div>
                          )}
                        </div>
                      )}
                      <LedgerToggle checked={toLedger} onChange={setToLedger} />
                    </>
                  );
                })()}

              {modal.kind === "loan" && (
                <>
                  <div className="bg-gold-light/60 border border-gold/30 rounded-lg px-3 py-2 text-[11.5px] text-[#6B5320]">
                    A fixed amount comes off every month's salary until the loan is paid back.
                  </div>
                  <Field label="Loan Amount">
                    <input type="number" className="w-full mt-1" value={amount} onChange={(e) => setAmount(num(e))} autoFocus />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Deduct Each Month">
                      <input type="number" className="w-full mt-1" value={monthly} onChange={(e) => setMonthly(num(e))} />
                    </Field>
                    <Field label="First Deduction">
                      <select className="w-full mt-1" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)}>
                        {futureMonths.map((m) => (
                          <option key={m} value={m}>
                            {monthName(m)} salary
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Date Given">
                    <input type="date" className="w-full mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                  <Field label="Note (optional)">
                    <input className="w-full mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                  {n(amount) > 0 && n(monthly) > 0 && (
                    <div className="text-[12px] bg-bg border border-dashed border-border rounded-lg px-3 py-2">
                      {Math.ceil(n(amount) / n(monthly))} instalment{Math.ceil(n(amount) / n(monthly)) === 1 ? "" : "s"}:{" "}
                      {money(n(monthly))} a month from {monthName(firstMonth)}, cleared with the{" "}
                      <b>{monthName(addMonths(firstMonth, Math.ceil(n(amount) / n(monthly)) - 1))}</b> salary.
                    </div>
                  )}
                  <LedgerToggle checked={toLedger} onChange={setToLedger} />
                </>
              )}

              {modal.kind === "editItem" && (
                <>
                  <div className="text-[12px] text-muted">
                    {money(modal.item.amount)} given on {fmtDMY(modal.item.issued_on)}. Changes only affect months that
                    haven't been paid yet.
                  </div>
                  {modal.item.kind === "loan" && (
                    <Field label="Deduct Each Month">
                      <input type="number" className="w-full mt-1" value={monthly} onChange={(e) => setMonthly(num(e))} />
                    </Field>
                  )}
                  <Field label={modal.item.kind === "loan" ? "First Deduction" : "Comes Off"}>
                    <select className="w-full mt-1" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)}>
                      {Array.from({ length: 8 }, (_, i) => addMonths(monthOf(modal.item.issued_on), i)).map((m) => (
                        <option key={m} value={m}>
                          {monthName(m)} salary
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Note">
                    <input className="w-full mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </>
              )}

              {modal.kind === "adjust" && (
                <>
                  <div className="flex gap-2">
                    {(["bonus", "deduction"] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => setAdjKind(k)}
                        className={`flex-1 rounded-lg px-3 py-2 text-[12.5px] font-semibold border ${
                          adjKind === k ? "border-gold bg-gold-light text-gold-deep" : "border-border text-muted"
                        }`}
                      >
                        {k === "bonus" ? "Bonus (adds)" : "Deduction (cuts)"}
                      </button>
                    ))}
                  </div>
                  <Field label="Amount">
                    <input type="number" className="w-full mt-1" value={amount} onChange={(e) => setAmount(num(e))} autoFocus />
                  </Field>
                  <Field label="Reason (optional)">
                    <input
                      className="w-full mt-1"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={adjKind === "bonus" ? "e.g. Eid bonus" : "e.g. 2 days absent"}
                    />
                  </Field>
                  <div className="text-[11px] text-muted">
                    For {monthName(month)} only. To change the salary itself, use Edit on the employee.
                  </div>
                </>
              )}

              {modal.kind === "employee" && (
                <>
                  <Field label="Full Name">
                    <input className="w-full mt-1" value={empName} onChange={(e) => setEmpName(e.target.value)} />
                  </Field>
                  <Field label="Designation">
                    <input
                      className="w-full mt-1"
                      value={empDesignation}
                      onChange={(e) => setEmpDesignation(e.target.value)}
                      placeholder="e.g. Waiter, Cook, Supervisor"
                    />
                  </Field>
                  <Field label="Monthly Salary">
                    <input type="number" className="w-full mt-1" value={empSalary} onChange={(e) => setEmpSalary(num(e))} />
                  </Field>
                  {modal.employee && n(empSalary) !== modal.employee.monthly_salary && (
                    <Field label="Reason For Salary Change">
                      <input
                        className="w-full mt-1"
                        value={empSalaryReason}
                        onChange={(e) => setEmpSalaryReason(e.target.value)}
                        placeholder="e.g. Annual increment"
                      />
                    </Field>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Phone (optional)">
                      <input className="w-full mt-1" value={empPhone} onChange={(e) => setEmpPhone(e.target.value)} />
                    </Field>
                    <Field label="Joining Date">
                      <input type="date" className="w-full mt-1" value={empJoined} onChange={(e) => setEmpJoined(e.target.value)} />
                    </Field>
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
              <button onClick={close} className="btn-ghost rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (modal.kind === "pay") savePayment(modal.employee);
                  else if (modal.kind === "advance") saveItem(modal.employee, "advance");
                  else if (modal.kind === "loan") saveItem(modal.employee, "loan");
                  else if (modal.kind === "editItem") updateItem(modal.item);
                  else if (modal.kind === "adjust") saveAdjustment(modal.employee);
                  else saveEmployee(modal.employee);
                }}
                className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
              >
                {busy
                  ? "Saving…"
                  : modal.kind === "pay"
                  ? "Record Payment"
                  : modal.kind === "advance"
                  ? "Give Advance"
                  : modal.kind === "loan"
                  ? "Give Loan"
                  : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm?.kind === "left" && (
        <AlertModal
          title="Mark this employee as left?"
          message={`${confirm.employee.full_name} will be removed from the active payroll from today. Their history stays, and you can reinstate them later.`}
          tone="danger"
          confirmLabel="Mark as Left"
          onConfirm={() => markAsLeft(confirm.employee)}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "deleteItem" && (
        <AlertModal
          title={`Delete this ${confirm.item.kind}?`}
          message={`${money(confirm.item.amount)} given on ${fmtDMY(
            confirm.item.issued_on
          )} will be removed, along with its expense line in the daily ledger. Use this only for a mistake.`}
          tone="danger"
          confirmLabel="Delete"
          onConfirm={() => deleteItem(confirm.item)}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "undoPay" && (
        <AlertModal
          title="Delete this salary payment?"
          message={`${money(confirm.entry.amount)} paid to ${confirm.employee.full_name} for ${monthName(
            confirm.entry.salary_month || month
          )} will be deleted from the ledger and the month will show as unpaid. That month's advance and loan deductions will be worked out again.`}
          tone="danger"
          confirmLabel="Delete Payment"
          onConfirm={() => undoPayment(confirm.employee, confirm.entry)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Employee ledger
// ===========================================================================
function EmployeeLedger({
  emp,
  p,
  month,
  readOnly,
  error,
  onClose,
  onPay,
  onEditPay,
  onUndoPay,
  onAdvance,
  onLoan,
  onAdjust,
  onRemoveAdjustment,
  onEditItem,
  onDeleteItem,
  onEdit,
  onLeft,
  onReinstate,
}: {
  emp: Employee;
  p: EmployeePayroll;
  month: string;
  readOnly: boolean;
  error: string | null;
  onClose: () => void;
  onPay: () => void;
  onEditPay: (month: string) => void;
  onUndoPay: (entry: LedgerEntry) => void;
  onAdvance: () => void;
  onLoan: () => void;
  onAdjust: () => void;
  onRemoveAdjustment: (id: string) => void;
  onEditItem: (item: EmployeeAdvance) => void;
  onDeleteItem: (item: EmployeeAdvance) => void;
  onEdit: () => void;
  onLeft: () => void;
  onReinstate: () => void;
}) {
  const c = p.current;
  const rows = accountRows(p, monthName);
  const history = [...p.months].reverse().filter((m) => m.payment || m.lines.length || m.bonus || m.deduction || m.month === month);
  const openItems = p.items.filter((i) => i.outstanding > 0);
  const closedItems = p.items.filter((i) => i.outstanding <= 0);

  function exportLedger() {
    downloadXlsx(`payroll-${emp.full_name.replace(/[^a-z0-9]+/gi, "-")}`, [
      {
        name: "Advances & Loans",
        columns: [
          { header: "Date", value: (r: (typeof rows)[number]) => fmtDMY(r.date) },
          { header: "Description", value: (r) => r.description + (r.pending ? " (not yet paid)" : ""), width: 44 },
          { header: "Given", value: (r) => (r.given ? Math.round(r.given) : ""), money: true },
          { header: "Recovered", value: (r) => (r.recovered ? Math.round(r.recovered) : ""), money: true },
          { header: "Balance Owed", value: (r) => Math.round(r.balance), money: true },
        ],
        rows,
        titleLines: [`Serene Marquee — ${emp.full_name} (${emp.designation})`, `As at ${monthName(month)}`],
      },
      {
        name: "Salary History",
        columns: [
          { header: "Month", value: (m: (typeof history)[number]) => monthName(m.month), width: 16 },
          { header: "Base", value: (m) => Math.round(m.base), money: true },
          { header: "Bonus", value: (m) => Math.round(m.bonus), money: true },
          { header: "Deductions", value: (m) => Math.round(m.deduction), money: true },
          { header: "Advance Cut", value: (m) => Math.round(m.advanceCut), money: true },
          { header: "Loan Instalment", value: (m) => Math.round(m.loanCut), money: true },
          { header: "Net Payable", value: (m) => Math.round(m.net), money: true },
          { header: "Paid", value: (m) => Math.round(m.payment?.amount || 0), money: true },
          { header: "Paid On", value: (m) => (m.payment ? fmtDMY(m.payment.entry_date) : "") },
        ],
        rows: history,
        titleLines: [`Serene Marquee — ${emp.full_name}`, "Salary by month"],
      },
    ]);
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl w-full max-w-4xl shadow-2xl my-8">
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-serif text-lg font-bold text-primary">{emp.full_name}</div>
            <div className="text-xs text-muted mt-0.5">
              {emp.designation} · {money(emp.monthly_salary)} a month
              {emp.phone && ` · ${emp.phone}`}
              {emp.joined_on && ` · joined ${fmtDMY(emp.joined_on)}`}
              {!emp.active && <span className="text-rose"> · left {emp.left_on ? fmtDMY(emp.left_on) : ""}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={exportLedger} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
              ⤓ Excel
            </button>
            {!readOnly && (
              <>
                <button onClick={onEdit} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
                  Edit details
                </button>
                {emp.active ? (
                  <button
                    onClick={onLeft}
                    className="text-xs font-semibold text-rose border border-rose/30 rounded-lg px-3 py-1.5 hover:bg-rose-light"
                  >
                    Mark as left
                  </button>
                ) : (
                  <button onClick={onReinstate} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
                    Reinstate
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} className="text-muted hover:text-primary text-xl leading-none px-1" aria-label="Close">
              &times;
            </button>
          </div>
        </div>

        {error && <div className="mx-5 mt-3 text-rose text-[12px] font-semibold">{error}</div>}

        {/* This month */}
        <div className="px-5 pt-4 grid md:grid-cols-[1.3fr_1fr] gap-4">
          <div className="border border-border rounded-xl p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[13px] font-bold text-primary">{monthName(month)} salary</div>
              {c.payment ? (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-primary-dim text-gold-deep">
                  Paid {money(c.payment.amount)} on {fmtDMY(c.payment.entry_date)}
                </span>
              ) : (
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-light text-rose">
                  Not paid
                </span>
              )}
            </div>
            <Breakdown c={c} onRemoveAdjustment={readOnly || c.payment ? undefined : onRemoveAdjustment} />
            {!readOnly && (
              <div className="flex gap-2 flex-wrap mt-3">
                {c.payment ? (
                  <>
                    <button onClick={onPay} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
                      Edit payment
                    </button>
                    <button
                      onClick={() => onUndoPay(c.payment!)}
                      className="text-xs font-semibold text-rose border border-rose/30 rounded-lg px-3 py-1.5 hover:bg-rose-light"
                    >
                      Delete payment
                    </button>
                  </>
                ) : (
                  emp.active && (
                    <button onClick={onPay} className="btn-primary rounded-lg px-3.5 py-1.5 text-xs">
                      Pay {money(c.net)}
                    </button>
                  )
                )}
                {!c.payment && (
                  <button onClick={onAdjust} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">
                    + Bonus / Deduction
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-rows-[auto_auto_1fr] gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-bg border border-border rounded-lg px-3 py-2">
                <div className="text-[10.5px] text-muted uppercase font-semibold">Loan owed</div>
                <div className={`text-[15px] font-bold font-serif mt-0.5 ${p.loanOutstanding ? "text-rose" : ""}`}>
                  {money(p.loanOutstanding)}
                </div>
              </div>
              <div className="bg-bg border border-border rounded-lg px-3 py-2">
                <div className="text-[10.5px] text-muted uppercase font-semibold">Advance owed</div>
                <div className={`text-[15px] font-bold font-serif mt-0.5 ${p.advanceOutstanding ? "text-rose" : ""}`}>
                  {money(p.advanceOutstanding)}
                </div>
              </div>
            </div>
            {!readOnly && emp.active && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={onAdvance} className="btn-ghost rounded-lg px-3 py-2 text-[12px] text-left leading-tight">
                  <span className="font-bold block">Give advance</span>
                  <span className="text-[10.5px] text-muted">off this month's pay</span>
                </button>
                <button onClick={onLoan} className="btn-ghost rounded-lg px-3 py-2 text-[12px] text-left leading-tight">
                  <span className="font-bold block">Give loan</span>
                  <span className="text-[10.5px] text-muted">paid back monthly</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Open advances & loans */}
        {(openItems.length > 0 || closedItems.length > 0) && (
          <div className="px-5 pt-5">
            <div className="text-[13px] font-bold text-primary mb-2">Advances & loans</div>
            <div className="flex flex-col gap-2">
              {[...openItems, ...closedItems].map((i) => {
                const a = i.advance;
                const pct = a.amount ? Math.round((i.recovered / a.amount) * 100) : 100;
                const done = payoffMonth(i, month);
                return (
                  <div key={a.id} className={`border border-border rounded-lg px-3 py-2.5 ${i.outstanding <= 0 ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="text-[12.5px]">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-bold mr-1.5 ${
                            a.kind === "loan" ? "bg-primary-dim text-gold-deep" : "bg-gold-light text-[#8A6427]"
                          }`}
                        >
                          {a.kind === "loan" ? "Loan" : "Advance"}
                        </span>
                        <b>{money(a.amount)}</b> given {fmtDMY(a.issued_on)}
                        {a.notes && <span className="text-muted"> — {a.notes}</span>}
                        <div className="text-[11px] text-muted mt-0.5">
                          {a.kind === "loan"
                            ? `${money(a.monthly_deduction)} a month from ${monthName(startMonthOf(a))} salary`
                            : `Comes off ${monthName(startMonthOf(a))} salary`}
                          {i.outstanding > 0 && done && a.kind === "loan" && ` · cleared by ${monthName(addMonths(done, -1))}`}
                        </div>
                      </div>
                      <div className="text-right text-[12px]">
                        {i.outstanding > 0 ? (
                          <span className="font-bold text-rose">{money(i.outstanding)} left</span>
                        ) : (
                          <span className="font-bold text-emerald">Cleared</span>
                        )}
                        {!readOnly && (
                          <div className="flex gap-2 justify-end mt-0.5">
                            <button onClick={() => onEditItem(a)} className="text-[11px] font-semibold text-gold-deep hover:underline">
                              Change
                            </button>
                            {/* Always offered; deleteItem refuses (with a message) if
                                a paid salary has already locked in a deduction. */}
                            <button onClick={() => onDeleteItem(a)} className="text-[11px] font-semibold text-rose hover:underline">
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 bg-bg rounded-full mt-2 overflow-hidden">
                      <div className="h-full bg-gold rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Account, vendor-diary style */}
        <div className="px-5 pt-5">
          <div className="text-[13px] font-bold text-primary mb-2">Account</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12.5px] border border-border">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wide bg-gold-light/60">
                  <th className="py-2 px-2 w-[105px]">Date</th>
                  <th className="py-2 px-2">Description</th>
                  <th className="py-2 px-2 text-right w-[105px]">Given</th>
                  <th className="py-2 px-2 text-right w-[105px]">Recovered</th>
                  <th className="py-2 px-2 text-right w-[115px]">Still Owes</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-5 text-muted">
                      No advances or loans.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.key} className={`border-t border-border ${r.pending ? "text-muted italic" : ""}`}>
                    <td className="py-1.5 px-2">{fmtDMY(r.date)}</td>
                    <td className="py-1.5 px-2">
                      {r.description}
                      {r.pending && <span className="not-italic text-[10.5px]"> · when salary is paid</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right text-rose">{r.given ? money(r.given) : "—"}</td>
                    <td className="py-1.5 px-2 text-right text-gold-deep">{r.recovered ? money(r.recovered) : "—"}</td>
                    <td className="py-1.5 px-2 text-right font-bold bg-bg/60">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Salary history */}
        <div className="px-5 py-5">
          <div className="text-[13px] font-bold text-primary mb-2">Salary history</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
                  <th className="py-2 px-2">Month</th>
                  <th className="py-2 px-2 text-right">Base</th>
                  <th className="py-2 px-2 text-right">Bonus / Ded.</th>
                  <th className="py-2 px-2 text-right">Advance</th>
                  <th className="py-2 px-2 text-right">Loan</th>
                  <th className="py-2 px-2 text-right">Net</th>
                  <th className="py-2 px-2">Paid</th>
                  {!readOnly && <th className="py-2 px-2 text-right">Payment</th>}
                </tr>
              </thead>
              <tbody>
                {history.map((m) => (
                  <tr key={m.month} className="border-b border-border last:border-0">
                    <td className="py-1.5 px-2 font-semibold">{monthName(m.month)}</td>
                    <td className="py-1.5 px-2 text-right">{money(m.base)}</td>
                    <td className="py-1.5 px-2 text-right">
                      {m.bonus - m.deduction ? `${m.bonus - m.deduction > 0 ? "+" : "-"}${money(Math.abs(m.bonus - m.deduction))}` : "—"}
                    </td>
                    <td className="py-1.5 px-2 text-right text-rose">{m.advanceCut ? `-${money(m.advanceCut)}` : "—"}</td>
                    <td className="py-1.5 px-2 text-right text-rose">{m.loanCut ? `-${money(m.loanCut)}` : "—"}</td>
                    <td className="py-1.5 px-2 text-right font-bold">{money(m.net)}</td>
                    <td className="py-1.5 px-2 text-[11.5px]">
                      {m.payment ? (
                        `${money(m.payment.amount)} on ${fmtDMY(m.payment.entry_date)}`
                      ) : (
                        <span className="text-rose">Not paid</span>
                      )}
                    </td>
                    {!readOnly && (
                      <td className="py-1.5 px-2 text-right whitespace-nowrap">
                        {m.payment ? (
                          <>
                            <button
                              onClick={() => onEditPay(m.month)}
                              className="text-[11px] font-semibold text-primary hover:underline mr-3"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => onUndoPay(m.payment!)}
                              className="text-[11px] font-semibold text-rose hover:underline"
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Small pieces
// ===========================================================================
function num(e: React.ChangeEvent<HTMLInputElement>): NumField {
  return e.target.value === "" ? "" : Number(e.target.value);
}

function Breakdown({
  c,
  onRemoveAdjustment,
}: {
  c: EmployeePayroll["current"];
  onRemoveAdjustment?: (id: string) => void;
}) {
  const line = (label: React.ReactNode, value: string, tone = "") => (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-muted">{label}</span>
      <span className={`font-semibold ${tone}`}>{value}</span>
    </div>
  );
  return (
    <div className="text-[12.5px]">
      {line("Base salary", money(c.base))}
      {[...c.bonuses, ...c.deductions].map((a) => (
        <div key={a.id}>
          {line(
            <>
              {a.kind === "bonus" ? "Bonus" : "Deduction"}
              {a.notes && ` — ${a.notes}`}
              {onRemoveAdjustment && (
                <button onClick={() => onRemoveAdjustment(a.id)} className="text-rose ml-1.5 hover:underline" title="Remove">
                  ×
                </button>
              )}
            </>,
            `${a.kind === "bonus" ? "+" : "-"}${money(a.amount)}`,
            a.kind === "bonus" ? "text-gold-deep" : "text-rose"
          )}
        </div>
      ))}
      {c.lines
        .filter((l) => l.amount > 0)
        .map((l) => (
          <div key={l.advance.id}>
            {line(
              `${l.advance.kind === "loan" ? "Loan instalment" : "Advance"} (given ${fmtDMY(l.advance.issued_on)})`,
              `-${money(l.amount)}`,
              "text-rose"
            )}
          </div>
        ))}
      <div className="flex justify-between gap-3 pt-2 mt-1 border-t border-border text-[14px] font-bold text-primary">
        <span>Net payable</span>
        <span>{money(c.net)}</span>
      </div>
      {c.shortfall > 0 && (
        <div className="text-[11px] text-rose mt-1">
          {money(c.shortfall)} more was due but didn't fit in this month's pay — it comes off next month.
        </div>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  tone,
  strong,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "rose";
  strong?: boolean;
}) {
  return (
    <div className={`card ${strong ? "border-gold/50" : ""}`}>
      <div className="text-[11.5px] text-muted uppercase font-semibold">{label}</div>
      <div className={`text-xl font-bold font-serif mt-1.5 ${tone === "rose" ? "text-rose" : ""}`}>{value}</div>
      {sub && <div className="text-[10.5px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Rule({ title, text }: { title: string; text: string }) {
  return (
    <div className="bg-white border border-border rounded-lg px-3.5 py-2.5 text-[12px]">
      <span className="font-bold text-primary">{title}: </span>
      <span className="text-muted">{text}</span>
    </div>
  );
}

function LedgerToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[12.5px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Record the cash handed over as an expense in the daily ledger
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-bold text-muted uppercase">{label}</label>
      {children}
    </div>
  );
}
