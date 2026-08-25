"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY } from "@/lib/dateFormat";
import { monthName, currentMonth, recentMonths, downloadXlsx, type SheetColumn } from "@/lib/xlsx";
import AlertModal from "@/components/AlertModal";
import { useSession, ReadOnlyNotice } from "@/components/SessionContext";
import type { Employee, EmployeeAdvance, EmployeeAdjustment, LedgerEntry } from "@/types";

type NumField = number | "";
const n = (v: NumField) => Number(v) || 0;
const todayIso = () => new Date().toISOString().slice(0, 10);

type Modal =
  | { kind: "pay"; employee: Employee; entry?: LedgerEntry }
  | { kind: "adjust"; employee: Employee }
  | { kind: "advance"; employee: Employee }
  | { kind: "employee"; employee?: Employee }
  | null;

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
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Employee | null>(null);

  // ---- payment form ----
  const [payAmount, setPayAmount] = useState<NumField>("");
  const [payHandedTo, setPayHandedTo] = useState("");
  const [payDate, setPayDate] = useState(todayIso());

  // ---- adjustment form (bonus / deduction) ----
  const [adjKind, setAdjKind] = useState<"bonus" | "deduction">("bonus");
  const [adjAmount, setAdjAmount] = useState<NumField>("");
  const [adjNotes, setAdjNotes] = useState("");

  // ---- advance / loan form ----
  const [advKind, setAdvKind] = useState<"advance" | "loan">("advance");
  const [advAmount, setAdvAmount] = useState<NumField>("");
  const [advMonthly, setAdvMonthly] = useState<NumField>("");
  const [advDate, setAdvDate] = useState(todayIso());
  const [advNotes, setAdvNotes] = useState("");
  const [advToLedger, setAdvToLedger] = useState(true);

  // ---- add / edit employee form ----
  const [empName, setEmpName] = useState("");
  const [empDesignation, setEmpDesignation] = useState("");
  const [empSalary, setEmpSalary] = useState<NumField>("");
  const [empPhone, setEmpPhone] = useState("");
  const [empJoined, setEmpJoined] = useState(todayIso());
  const [empSalaryReason, setEmpSalaryReason] = useState("");

  async function load() {
    const [{ data: emp, error: empError }, { data: adv }, { data: adj }, { data: entries }] = await Promise.all([
      supabase.from("employees").select("*").order("full_name"),
      supabase.from("employee_advances").select("*").order("issued_on", { ascending: false }),
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

  const visibleEmployees = useMemo(
    () => employees.filter((e) => (showLeavers ? true : e.active)),
    [employees, showLeavers]
  );

  // ---- per-employee figures for the selected month -------------------
  function bonusFor(empId: string) {
    return adjustments
      .filter((a) => a.employee_id === empId && a.month === month && a.kind === "bonus")
      .reduce((s, a) => s + a.amount, 0);
  }
  function deductionFor(empId: string) {
    return adjustments
      .filter((a) => a.employee_id === empId && a.month === month && a.kind !== "bonus")
      .reduce((s, a) => s + a.amount, 0);
  }
  function netFor(emp: Employee) {
    return Math.max(0, emp.monthly_salary + bonusFor(emp.id) - deductionFor(emp.id));
  }
  function paymentFor(empId: string) {
    return salaryEntries.find((e) => e.employee_id === empId && e.salary_month === month) || null;
  }
  function adjustmentsFor(empId: string) {
    return adjustments.filter((a) => a.employee_id === empId && a.month === month);
  }

  // Outstanding balance on an advance/loan = principal minus everything
  // already recovered against it in any month.
  function outstandingOn(advanceId: string, principal: number) {
    const repaid = adjustments
      .filter((a) => a.advance_id === advanceId && a.kind === "repayment")
      .reduce((s, a) => s + a.amount, 0);
    return Math.max(0, principal - repaid);
  }
  function openAdvancesFor(empId: string) {
    return advances
      .filter((a) => a.employee_id === empId)
      .map((a) => ({ ...a, outstanding: outstandingOn(a.id, a.amount) }))
      .filter((a) => a.outstanding > 0);
  }
  // Everything still owed by this employee across all their advances/loans.
  function loanBalanceFor(empId: string) {
    return openAdvancesFor(empId).reduce((sum, a) => sum + a.outstanding, 0);
  }
  // Split so payroll can show what is a loan vs a plain salary advance.
  function loanBreakdownFor(empId: string) {
    const open = openAdvancesFor(empId);
    return {
      loan: open.filter((a) => a.kind === "loan").reduce((s, a) => s + a.outstanding, 0),
      advance: open.filter((a) => a.kind === "advance").reduce((s, a) => s + a.outstanding, 0),
      total: open.reduce((s, a) => s + a.outstanding, 0),
      monthlyCut: open.reduce((s, a) => s + Math.min(a.monthly_deduction || a.outstanding, a.outstanding), 0),
    };
  }
  function repaymentBookedThisMonth(advanceId: string) {
    return adjustments.some((a) => a.advance_id === advanceId && a.month === month && a.kind === "repayment");
  }

  const activeEmployees = employees.filter((e) => e.active);
  const totalBase = activeEmployees.reduce((s, e) => s + e.monthly_salary, 0);
  const totalBonus = activeEmployees.reduce((s, e) => s + bonusFor(e.id), 0);
  const totalDeduction = activeEmployees.reduce((s, e) => s + deductionFor(e.id), 0);
  const totalNet = activeEmployees.reduce((s, e) => s + netFor(e), 0);
  const totalPaid = activeEmployees.reduce((s, e) => s + (paymentFor(e.id)?.amount || 0), 0);
  const totalOutstandingLoans = advances.reduce((s, a) => s + outstandingOn(a.id, a.amount), 0);

  async function currentUserId() {
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

  // ---- open modals ----------------------------------------------------
  function openPay(emp: Employee) {
    const existing = paymentFor(emp.id);
    setModal({ kind: "pay", employee: emp, entry: existing || undefined });
    setPayAmount(existing ? existing.amount : netFor(emp));
    setPayHandedTo(existing?.handed_to || emp.full_name);
    setPayDate(existing?.entry_date || todayIso());
    setError(null);
  }
  function openAdjust(emp: Employee) {
    setModal({ kind: "adjust", employee: emp });
    setAdjKind("bonus");
    setAdjAmount("");
    setAdjNotes("");
    setError(null);
  }
  function openAdvance(emp: Employee) {
    setModal({ kind: "advance", employee: emp });
    setAdvKind("advance");
    setAdvAmount("");
    setAdvMonthly("");
    setAdvDate(todayIso());
    setAdvNotes("");
    setAdvToLedger(true);
    setError(null);
  }
  function openEmployee(emp?: Employee) {
    setModal({ kind: "employee", employee: emp });
    setEmpName(emp?.full_name || "");
    setEmpDesignation(emp?.designation || "");
    setEmpSalary(emp?.monthly_salary ?? "");
    setEmpPhone(emp?.phone || "");
    setEmpJoined(emp?.joined_on || todayIso());
    setEmpSalaryReason("");
    setError(null);
  }

  // ---- actions --------------------------------------------------------
  async function savePayment(emp: Employee, existing?: LedgerEntry) {
    if (!guard()) return;
    setBusy(true);
    const amount = n(payAmount);
    if (existing) {
      await supabase
        .from("ledger_entries")
        .update({ entry_date: payDate, amount, handed_to: payHandedTo.trim() || emp.full_name })
        .eq("id", existing.id);
    } else {
      await supabase.from("ledger_entries").insert({
        entry_date: payDate,
        type: "expense",
        description: `Salary — ${emp.full_name} (${emp.designation}) — ${monthName(month)}`,
        amount,
        handed_to: payHandedTo.trim() || emp.full_name,
        employee_id: emp.id,
        salary_month: month,
        category: "salary",
        created_by: await currentUserId(),
      });
    }
    setModal(null);
    setBusy(false);
    load();
  }

  async function saveAdjustment(emp: Employee) {
    if (!guard()) return;
    if (n(adjAmount) <= 0) return setError("Enter an amount greater than zero.");
    setBusy(true);
    await supabase.from("employee_adjustments").insert({
      employee_id: emp.id,
      month,
      kind: adjKind,
      amount: n(adjAmount),
      notes: adjNotes.trim() || null,
      created_by: await currentUserId(),
    });
    setModal(null);
    setBusy(false);
    load();
  }

  async function saveAdvance(emp: Employee) {
    if (!guard()) return;
    if (n(advAmount) <= 0) return setError("Enter the amount handed over.");
    setBusy(true);
    const uid = await currentUserId();
    const { error: advError } = await supabase.from("employee_advances").insert({
      employee_id: emp.id,
      kind: advKind,
      amount: n(advAmount),
      monthly_deduction: n(advMonthly),
      issued_on: advDate,
      notes: advNotes.trim() || null,
      created_by: uid,
    });
    if (advError) {
      setError(advError.message);
      setBusy(false);
      return;
    }
    // Money physically left the till, so mirror it into the daily ledger.
    if (advToLedger) {
      await supabase.from("ledger_entries").insert({
        entry_date: advDate,
        type: "expense",
        description: `${advKind === "loan" ? "Loan" : "Advance"} — ${emp.full_name} (${emp.designation})`,
        amount: n(advAmount),
        handed_to: emp.full_name,
        employee_id: emp.id,
        category: "advance",
        created_by: uid,
      });
    }
    setModal(null);
    setBusy(false);
    load();
  }

  // Book this month's agreed instalment against an outstanding advance/loan.
  async function applyInstalment(emp: Employee, advance: EmployeeAdvance, outstanding: number) {
    if (!guard()) return;
    const instalment = Math.min(advance.monthly_deduction || outstanding, outstanding);
    if (instalment <= 0) return;
    await supabase.from("employee_adjustments").insert({
      employee_id: emp.id,
      month,
      kind: "repayment",
      amount: instalment,
      advance_id: advance.id,
      notes: `${advance.kind === "loan" ? "Loan" : "Advance"} instalment — ${monthName(month)}`,
      created_by: await currentUserId(),
    });
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
    const uid = await currentUserId();

    if (existing) {
      const newSalary = n(empSalary);
      const { error: updError } = await supabase
        .from("employees")
        .update({
          full_name: empName.trim(),
          designation: empDesignation.trim(),
          monthly_salary: newSalary,
          phone: empPhone.trim() || null,
          joined_on: empJoined || null,
        })
        .eq("id", existing.id);
      if (updError) {
        setError(updError.message);
        setBusy(false);
        return;
      }
      // Log any change to the salary itself so raises/cuts are auditable.
      if (newSalary !== existing.monthly_salary) {
        await supabase.from("employee_salary_changes").insert({
          employee_id: existing.id,
          old_salary: existing.monthly_salary,
          new_salary: newSalary,
          effective_from: todayIso(),
          reason: empSalaryReason.trim() || null,
          created_by: uid,
        });
      }
    } else {
      const { error: insError } = await supabase.from("employees").insert({
        full_name: empName.trim(),
        designation: empDesignation.trim(),
        monthly_salary: n(empSalary),
        phone: empPhone.trim() || null,
        joined_on: empJoined || null,
        active: true,
      });
      if (insError) {
        setError(
          insError.message.includes("duplicate")
            ? "An employee with that exact name already exists."
            : insError.message
        );
        setBusy(false);
        return;
      }
    }
    setModal(null);
    setBusy(false);
    load();
  }

  // Leavers are deactivated rather than deleted, so their past salary
  // payments stay attached to the ledger history.
  async function markAsLeft(emp: Employee) {
    if (!guard()) return;
    await supabase.from("employees").update({ active: false, left_on: todayIso() }).eq("id", emp.id);
    setRemoveTarget(null);
    load();
  }
  async function reinstate(emp: Employee) {
    if (!guard()) return;
    await supabase.from("employees").update({ active: true, left_on: null }).eq("id", emp.id);
    load();
  }

  // ---- month export ---------------------------------------------------
  type ExportRow = { emp: Employee };
  const exportColumns: SheetColumn<ExportRow>[] = [
    { header: "Employee", value: (r) => r.emp.full_name, width: 24 },
    { header: "Designation", value: (r) => r.emp.designation, width: 18 },
    { header: "Status", value: (r) => (r.emp.active ? "Active" : `Left${r.emp.left_on ? " " + fmtDMY(r.emp.left_on) : ""}`) },
    { header: "Base Salary", value: (r) => Math.round(r.emp.monthly_salary), money: true },
    { header: "Bonus", value: (r) => Math.round(bonusFor(r.emp.id)), money: true },
    { header: "Deductions", value: (r) => Math.round(deductionFor(r.emp.id)), money: true },
    {
      header: "Loan Instalment",
      value: (r) =>
        Math.round(
          adjustmentsFor(r.emp.id)
            .filter((a) => a.kind === "repayment")
            .reduce((s, a) => s + a.amount, 0)
        ),
      money: true,
    },
    { header: "Net Payable", value: (r) => Math.round(netFor(r.emp)), money: true },
    { header: "Paid", value: (r) => Math.round(paymentFor(r.emp.id)?.amount || 0), money: true },
    { header: "Paid On", value: (r) => (paymentFor(r.emp.id) ? fmtDMY(paymentFor(r.emp.id)!.entry_date) : "") },
    { header: "Loan Balance", value: (r) => Math.round(loanBreakdownFor(r.emp.id).loan), money: true },
    { header: "Advance Balance", value: (r) => Math.round(loanBreakdownFor(r.emp.id).advance), money: true },
    { header: "Total Outstanding", value: (r) => Math.round(loanBreakdownFor(r.emp.id).total), money: true },
  ];

  // Second sheet: every advance and loan in full, so the workbook answers
  // "what does this person still owe and since when" without extra digging.
  type AdvRow = { emp: Employee; adv: EmployeeAdvance; outstanding: number };
  const advanceColumns: SheetColumn<AdvRow>[] = [
    { header: "Employee", value: (r) => r.emp.full_name, width: 24 },
    { header: "Type", value: (r) => (r.adv.kind === "loan" ? "Loan" : "Advance") },
    { header: "Given On", value: (r) => fmtDMY(r.adv.issued_on) },
    { header: "Amount", value: (r) => Math.round(r.adv.amount), money: true },
    { header: "Monthly Deduction", value: (r) => Math.round(r.adv.monthly_deduction), money: true },
    { header: "Recovered", value: (r) => Math.round(r.adv.amount - r.outstanding), money: true },
    { header: "Outstanding", value: (r) => Math.round(r.outstanding), money: true },
    { header: "Status", value: (r) => (r.outstanding > 0 ? "Open" : "Cleared") },
    { header: "Notes", value: (r) => r.adv.notes || "", width: 30 },
  ];

  function advanceRows(): AdvRow[] {
    return advances
      .map((adv) => {
        const emp = employees.find((e) => e.id === adv.employee_id);
        return emp ? { emp, adv, outstanding: outstandingOn(adv.id, adv.amount) } : null;
      })
      .filter((r): r is AdvRow => r !== null)
      .sort((a, b) => a.emp.full_name.localeCompare(b.emp.full_name) || b.adv.issued_on.localeCompare(a.adv.issued_on));
  }

  function handleExport() {
    const rows = visibleEmployees.map((emp) => ({ emp }));
    const advRows = advanceRows();
    downloadXlsx(`serene-marquee-payroll-${month}`, [
      {
        name: monthName(month),
        columns: exportColumns,
        rows,
        titleLines: [
          "Serene Marquee — Payroll",
          `Month: ${monthName(month)}`,
          `Net Payable: Rs. ${Math.round(totalNet).toLocaleString("en-PK")}   |   Paid: Rs. ${Math.round(
            totalPaid
          ).toLocaleString("en-PK")}   |   Outstanding Loans/Advances: Rs. ${Math.round(
            totalOutstandingLoans
          ).toLocaleString("en-PK")}`,
        ],
        totalsRow: [
          "TOTAL",
          "",
          "",
          Math.round(rows.reduce((s, r) => s + r.emp.monthly_salary, 0)),
          Math.round(rows.reduce((s, r) => s + bonusFor(r.emp.id), 0)),
          Math.round(rows.reduce((s, r) => s + deductionFor(r.emp.id), 0)),
          Math.round(
            rows.reduce(
              (s, r) =>
                s +
                adjustmentsFor(r.emp.id)
                  .filter((a) => a.kind === "repayment")
                  .reduce((x, a) => x + a.amount, 0),
              0
            )
          ),
          Math.round(rows.reduce((s, r) => s + netFor(r.emp), 0)),
          Math.round(rows.reduce((s, r) => s + (paymentFor(r.emp.id)?.amount || 0), 0)),
          "",
          Math.round(rows.reduce((s, r) => s + loanBreakdownFor(r.emp.id).loan, 0)),
          Math.round(rows.reduce((s, r) => s + loanBreakdownFor(r.emp.id).advance, 0)),
          Math.round(rows.reduce((s, r) => s + loanBreakdownFor(r.emp.id).total, 0)),
        ],
      },
      {
        name: "Advances & Loans",
        columns: advanceColumns,
        rows: advRows,
        titleLines: ["Serene Marquee — Advances & Loans", `As at ${monthName(month)}`],
        totalsRow: [
          "TOTAL",
          "",
          "",
          Math.round(advRows.reduce((s, r) => s + r.adv.amount, 0)),
          Math.round(advRows.reduce((s, r) => s + r.adv.monthly_deduction, 0)),
          Math.round(advRows.reduce((s, r) => s + (r.adv.amount - r.outstanding), 0)),
          Math.round(advRows.reduce((s, r) => s + r.outstanding, 0)),
        ],
      },
    ]);
  }

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

  return (
    <div>
      <Link href="/ledger" className="text-xs font-bold text-gold-deep hover:underline">
        &larr; Back to Ledger
      </Link>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-2 mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Payroll / Salaries</div>
          <div className="text-xs text-muted mt-0.5">
            Salaries, bonuses, advances and loan instalments — every payment posts to the ledger automatically.
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
            {recentMonths(18).map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
          <button onClick={handleExport} className="btn-ghost rounded-lg px-3 py-2 text-sm">
            ⤓ Excel
          </button>
          {!readOnly && (
            <button onClick={() => openEmployee()} className="btn-primary rounded-lg px-4 py-2 text-sm">
              + Add Employee
            </button>
          )}
        </div>
      </div>

      {readOnly && <ReadOnlyNotice what="payroll" />}
      {error && !modal && <div className="text-rose text-sm font-semibold my-2">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4 my-4">
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Base Payroll</div>
          <div className="text-xl font-bold font-serif mt-1.5">{money(totalBase)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Bonuses</div>
          <div className="text-xl font-bold font-serif text-gold-deep mt-1.5">+{money(totalBonus)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Deductions</div>
          <div className="text-xl font-bold font-serif text-rose mt-1.5">-{money(totalDeduction)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Net Payable</div>
          <div className="text-xl font-bold font-serif mt-1.5">{money(totalNet)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Remaining</div>
          <div className="text-xl font-bold font-serif text-rose mt-1.5">{money(totalNet - totalPaid)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Loans Outstanding</div>
          <div className="text-xl font-bold font-serif text-rose mt-1.5">{money(totalOutstandingLoans)}</div>
        </div>
      </div>

      {totalOutstandingLoans > 0 && (
        <div className="card mb-4">
          <div className="text-[13px] font-bold text-primary mb-2">Outstanding Advances & Loans</div>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full min-w-[560px] text-[12.5px]">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
                  <th className="py-2 px-2">Employee</th>
                  <th className="py-2 px-2">Type</th>
                  <th className="py-2 px-2">Given On</th>
                  <th className="py-2 px-2">Amount</th>
                  <th className="py-2 px-2">Monthly Cut</th>
                  <th className="py-2 px-2">Outstanding</th>
                  <th className="py-2 px-2">{monthName(month)}</th>
                </tr>
              </thead>
              <tbody>
                {employees.flatMap((emp) =>
                  openAdvancesFor(emp.id).map((adv) => (
                    <tr key={adv.id} className="border-b border-border last:border-0">
                      <td className="py-2 px-2 font-semibold">{emp.full_name}</td>
                      <td className="py-2 px-2 capitalize">{adv.kind}</td>
                      <td className="py-2 px-2 text-muted">{fmtDMY(adv.issued_on)}</td>
                      <td className="py-2 px-2">{money(adv.amount)}</td>
                      <td className="py-2 px-2">{adv.monthly_deduction ? money(adv.monthly_deduction) : "—"}</td>
                      <td className="py-2 px-2 font-bold text-rose">{money(adv.outstanding)}</td>
                      <td className="py-2 px-2">
                        {repaymentBookedThisMonth(adv.id) ? (
                          <span className="text-[11px] font-bold text-gold-deep">Instalment applied</span>
                        ) : readOnly ? (
                          <span className="text-muted text-[11px]">—</span>
                        ) : (
                          <button
                            onClick={() => applyInstalment(emp, adv, adv.outstanding)}
                            className="btn-ghost rounded-md px-2.5 py-1 text-[11px]"
                          >
                            Deduct {money(Math.min(adv.monthly_deduction || adv.outstanding, adv.outstanding))}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-muted mt-2.5">
            Applying an instalment adds it as a deduction on {monthName(month)}'s salary and reduces the
            outstanding balance. Nothing is deducted automatically — it's always an explicit action.
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-[13px] font-bold text-primary">
            Employees ({visibleEmployees.length})
          </div>
          <button onClick={() => setShowLeavers((s) => !s)} className="text-xs font-bold text-gold-deep hover:underline">
            {showLeavers ? "Hide past employees" : `Show past employees (${employees.length - activeEmployees.length})`}
          </button>
        </div>
        <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[980px] text-[13px]">
          <thead>
            <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
              <th className="py-2 px-2">Employee</th>
              <th className="py-2 px-2">Designation</th>
              <th className="py-2 px-2">Base</th>
              <th className="py-2 px-2">Bonus</th>
              <th className="py-2 px-2">Deductions</th>
              <th className="py-2 px-2">Net Payable</th>
              <th className="py-2 px-2">Loan / Advance Balance</th>
              <th className="py-2 px-2">{monthName(month)}</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {visibleEmployees.map((emp) => {
              const paid = paymentFor(emp.id);
              const bonus = bonusFor(emp.id);
              const deduction = deductionFor(emp.id);
              const rowAdjustments = adjustmentsFor(emp.id);
              const loans = loanBreakdownFor(emp.id);
              return (
                <tr key={emp.id} className={`border-b border-border last:border-0 ${emp.active ? "" : "opacity-60"}`}>
                  <td className="py-2.5 px-2 font-semibold">
                    {emp.full_name}
                    {!emp.active && (
                      <div className="text-[10.5px] text-rose font-normal">
                        Left{emp.left_on ? ` ${fmtDMY(emp.left_on)}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-muted">{emp.designation}</td>
                  <td className="py-2.5 px-2">{money(emp.monthly_salary)}</td>
                  <td className="py-2.5 px-2 text-gold-deep">{bonus ? `+${money(bonus)}` : "—"}</td>
                  <td className="py-2.5 px-2 text-rose">
                    {deduction ? `-${money(deduction)}` : "—"}
                    {rowAdjustments.length > 0 && (
                      <div className="text-[10px] text-muted font-normal leading-snug mt-0.5">
                        {rowAdjustments.map((a) => (
                          <div key={a.id} className="flex items-center gap-1">
                            <span>
                              {a.kind === "bonus" ? "Bonus" : a.kind === "repayment" ? "Instalment" : "Deduction"}{" "}
                              {money(a.amount)}
                            </span>
                            {!readOnly && (
                              <button
                                onClick={() => removeAdjustment(a.id)}
                                className="text-rose hover:underline"
                                title="Remove this adjustment"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-2 font-bold">{money(netFor(emp))}</td>
                  <td className="py-2.5 px-2">
                    {loans.total > 0 ? (
                      <>
                        <span className="font-bold text-rose">{money(loans.total)}</span>
                        <div className="text-[10px] text-muted font-normal leading-snug mt-0.5">
                          {loans.loan > 0 && <div>Loan {money(loans.loan)}</div>}
                          {loans.advance > 0 && <div>Advance {money(loans.advance)}</div>}
                          {loans.monthlyCut > 0 && <div>Cut {money(loans.monthlyCut)}/month</div>}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted">Clear</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2">
                    {paid ? (
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-primary-dim text-gold-deep">
                        Paid {money(paid.amount)} on {fmtDMY(paid.entry_date)}
                      </span>
                    ) : (
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-light text-rose">
                        Not paid
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-2">
                    {readOnly ? (
                      <span className="text-muted text-[11px]">—</span>
                    ) : (
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        <button onClick={() => openPay(emp)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap">
                          {paid ? "Edit Payment" : "Record Payment"}
                        </button>
                        <button onClick={() => openAdjust(emp)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap">
                          Bonus / Deduct
                        </button>
                        <button onClick={() => openAdvance(emp)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap">
                          Advance / Loan
                        </button>
                        <button onClick={() => openEmployee(emp)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap">
                          Edit
                        </button>
                        {emp.active ? (
                          <button
                            onClick={() => setRemoveTarget(emp)}
                            className="text-[11px] font-semibold text-rose border border-rose/30 rounded-md px-2.5 py-1 hover:bg-rose-light whitespace-nowrap"
                          >
                            Mark as Left
                          </button>
                        ) : (
                          <button onClick={() => reinstate(emp)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap">
                            Reinstate
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      {/* ---------------------------- MODALS ---------------------------- */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden my-8">
            <div className="px-5 py-4 border-b border-border">
              <div className="font-bold text-sm text-primary">
                {modal.kind === "pay" && `${modal.entry ? "Edit" : "Record"} Payment — ${modal.employee.full_name}`}
                {modal.kind === "adjust" && `Bonus / Deduction — ${modal.employee.full_name}`}
                {modal.kind === "advance" && `Advance or Loan — ${modal.employee.full_name}`}
                {modal.kind === "employee" && (modal.employee ? `Edit — ${modal.employee.full_name}` : "Add New Employee")}
              </div>
              {modal.kind !== "employee" && (
                <div className="text-xs text-muted mt-0.5">For {monthName(month)}</div>
              )}
            </div>

            <div className="px-5 py-4 flex flex-col gap-3">
              {error && <div className="text-rose text-[12.5px] font-semibold">{error}</div>}

              {modal.kind === "pay" && (
                <>
                  <div className="bg-bg border border-dashed border-border rounded-lg px-3 py-2 text-[11.5px] text-muted">
                    Base {money(modal.employee.monthly_salary)} + bonus {money(bonusFor(modal.employee.id))} − deductions{" "}
                    {money(deductionFor(modal.employee.id))} = <b className="text-primary">{money(netFor(modal.employee))}</b>
                  </div>
                  <Field label="Amount">
                    <input
                      type="number"
                      className="w-full mt-1"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Handed To">
                    <input className="w-full mt-1" value={payHandedTo} onChange={(e) => setPayHandedTo(e.target.value)} />
                  </Field>
                  <Field label="Payment Date">
                    <input type="date" className="w-full mt-1" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                  </Field>
                </>
              )}

              {modal.kind === "adjust" && (
                <>
                  <Field label="Type">
                    <select className="w-full mt-1" value={adjKind} onChange={(e) => setAdjKind(e.target.value as any)}>
                      <option value="bonus">Bonus (adds to salary)</option>
                      <option value="deduction">Deduction (cuts from salary)</option>
                    </select>
                  </Field>
                  <Field label="Amount">
                    <input
                      type="number"
                      className="w-full mt-1"
                      value={adjAmount}
                      placeholder="0"
                      onChange={(e) => setAdjAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Reason (optional)">
                    <input
                      className="w-full mt-1"
                      value={adjNotes}
                      onChange={(e) => setAdjNotes(e.target.value)}
                      placeholder={adjKind === "bonus" ? "e.g. Eid bonus" : "e.g. 2 days absent"}
                    />
                  </Field>
                  <div className="text-[11px] text-muted">
                    This applies to {monthName(month)} only. To change the salary permanently, use Edit instead.
                  </div>
                </>
              )}

              {modal.kind === "advance" && (
                <>
                  <Field label="Type">
                    <select className="w-full mt-1" value={advKind} onChange={(e) => setAdvKind(e.target.value as any)}>
                      <option value="advance">Advance (against upcoming salary)</option>
                      <option value="loan">Loan (recovered over months)</option>
                    </select>
                  </Field>
                  <Field label="Amount Handed Over">
                    <input
                      type="number"
                      className="w-full mt-1"
                      value={advAmount}
                      placeholder="0"
                      onChange={(e) => setAdvAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Monthly Deduction">
                    <input
                      type="number"
                      className="w-full mt-1"
                      value={advMonthly}
                      placeholder="0"
                      onChange={(e) => setAdvMonthly(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                    <div className="text-[11px] text-muted mt-1">
                      The instalment cut from each month's salary until it's paid off. Leave 0 to recover the whole
                      amount in one go.
                    </div>
                  </Field>
                  <Field label="Date Given">
                    <input type="date" className="w-full mt-1" value={advDate} onChange={(e) => setAdvDate(e.target.value)} />
                  </Field>
                  <Field label="Notes (optional)">
                    <input className="w-full mt-1" value={advNotes} onChange={(e) => setAdvNotes(e.target.value)} />
                  </Field>
                  <label className="flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" checked={advToLedger} onChange={(e) => setAdvToLedger(e.target.checked)} />
                    Also record this as an expense in the daily ledger
                  </label>
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
                    <input
                      type="number"
                      className="w-full mt-1"
                      value={empSalary}
                      placeholder="0"
                      onChange={(e) => setEmpSalary(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </Field>
                  {modal.employee && n(empSalary) !== modal.employee.monthly_salary && (
                    <Field label="Reason For Salary Change">
                      <input
                        className="w-full mt-1"
                        value={empSalaryReason}
                        onChange={(e) => setEmpSalaryReason(e.target.value)}
                        placeholder="e.g. Annual increment"
                      />
                      <div className="text-[11px] text-muted mt-1">
                        {money(modal.employee.monthly_salary)} → {money(n(empSalary))} will be logged in the salary
                        history.
                      </div>
                    </Field>
                  )}
                  <Field label="Phone (optional)">
                    <input className="w-full mt-1" value={empPhone} onChange={(e) => setEmpPhone(e.target.value)} />
                  </Field>
                  <Field label="Joining Date">
                    <input type="date" className="w-full mt-1" value={empJoined} onChange={(e) => setEmpJoined(e.target.value)} />
                  </Field>
                </>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
              <button onClick={() => { setModal(null); setError(null); }} className="btn-ghost rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (modal.kind === "pay") savePayment(modal.employee, modal.entry);
                  else if (modal.kind === "adjust") saveAdjustment(modal.employee);
                  else if (modal.kind === "advance") saveAdvance(modal.employee);
                  else saveEmployee(modal.employee);
                }}
                className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <AlertModal
          title="Mark this employee as left?"
          message={`${removeTarget.full_name} will be removed from the active payroll from today. Their past salary payments stay in the ledger, and you can reinstate them later if they return.`}
          tone="danger"
          confirmLabel="Mark as Left"
          onConfirm={() => markAsLeft(removeTarget)}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
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
