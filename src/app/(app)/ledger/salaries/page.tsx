"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY } from "@/lib/dateFormat";
import type { Employee, LedgerEntry } from "@/types";

function monthLabel(monthStr: string) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function SalariesPage() {
  const supabase = createClient();
  const [restricted, setRestricted] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaryEntries, setSalaryEntries] = useState<LedgerEntry[]>([]);
  const [month, setMonth] = useState(currentMonthStr());
  const [payingId, setPayingId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState<number | "">("");
  const [payHandedTo, setPayHandedTo] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  async function load() {
    const [{ data: emp, error: empError }, { data: entries }] = await Promise.all([
      supabase.from("employees").select("*").eq("active", true).order("full_name"),
      // Salaries are ordinary expense entries whose description is tagged
      // "Salary — ..." — this reads them back out for the month view without
      // needing extra schema beyond what the ledger already has.
      supabase.from("ledger_entries").select("*").eq("type", "expense").ilike("description", "Salary —%"),
    ]);
    if (empError) {
      setRestricted(true);
      return;
    }
    setEmployees(emp || []);
    setSalaryEntries(entries || []);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paidThisMonth = useMemo(() => {
    const map = new Map<string, LedgerEntry>();
    salaryEntries.forEach((e) => {
      if (e.description.includes(`— ${monthLabel(month)}`)) {
        // description format: "Salary — {name} ({designation}) — {Month Year}"
        const match = e.description.match(/^Salary — (.+?) \(/);
        if (match) map.set(match[1], e);
      }
    });
    return map;
  }, [salaryEntries, month]);

  const totalPayroll = employees.reduce((s, e) => s + e.monthly_salary, 0);
  const totalPaidThisMonth = Array.from(paidThisMonth.values()).reduce((s, e) => s + e.amount, 0);

  function startPayment(emp: Employee) {
    setPayingId(emp.id);
    setEditingEntryId(null);
    setPayAmount(emp.monthly_salary);
    setPayHandedTo(emp.full_name);
    setPayDate(new Date().toISOString().slice(0, 10));
  }

  function startEditPayment(emp: Employee, entry: LedgerEntry) {
    setPayingId(emp.id);
    setEditingEntryId(entry.id);
    setPayAmount(entry.amount);
    setPayHandedTo(entry.handed_to || emp.full_name);
    setPayDate(entry.entry_date);
  }

  async function confirmPayment(emp: Employee) {
    const amount = Number(payAmount) || 0;
    if (editingEntryId) {
      await supabase
        .from("ledger_entries")
        .update({
          entry_date: payDate,
          amount,
          handed_to: payHandedTo.trim() || emp.full_name,
        })
        .eq("id", editingEntryId);
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await supabase.from("ledger_entries").insert({
        entry_date: payDate,
        type: "expense",
        description: `Salary — ${emp.full_name} (${emp.designation}) — ${monthLabel(month)}`,
        amount,
        handed_to: payHandedTo.trim() || emp.full_name,
        created_by: user?.id,
      });
    }
    setPayingId(null);
    setEditingEntryId(null);
    load();
  }

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

  const payingEmployee = employees.find((e) => e.id === payingId);

  return (
    <div>
      <Link href="/ledger" className="text-xs font-bold text-gold-deep hover:underline">
        &larr; Back to Ledger
      </Link>
      <div className="flex items-center justify-between gap-3 flex-wrap mt-2 mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Payroll / Salaries</div>
          <div className="text-xs text-muted mt-0.5">
            Recording a salary payment adds it to the ledger as an expense automatically.
          </div>
        </div>
        <select className="text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
          {Array.from({ length: 12 }, (_, i) => {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            return (
              <option key={val} value={val}>
                {monthLabel(val)}
              </option>
            );
          })}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-4 my-4">
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Total Monthly Payroll</div>
          <div className="text-2xl font-bold font-serif mt-1.5">{money(totalPayroll)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Paid — {monthLabel(month)}</div>
          <div className="text-2xl font-bold font-serif text-gold-deep mt-1.5">{money(totalPaidThisMonth)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Remaining This Month</div>
          <div className="text-2xl font-bold font-serif text-rose mt-1.5">{money(totalPayroll - totalPaidThisMonth)}</div>
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
              <th className="py-2 px-2">Employee</th>
              <th className="py-2 px-2">Designation</th>
              <th className="py-2 px-2">Monthly Salary</th>
              <th className="py-2 px-2">{monthLabel(month)}</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => {
              const paid = paidThisMonth.get(emp.full_name);
              return (
                <tr key={emp.id} className="border-b border-border last:border-0">
                  <td className="py-2.5 px-2 font-semibold">{emp.full_name}</td>
                  <td className="py-2.5 px-2 text-muted">{emp.designation}</td>
                  <td className="py-2.5 px-2">{money(emp.monthly_salary)}</td>
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
                  <td className="py-2.5 px-2 text-right">
                    {paid ? (
                      <button
                        onClick={() => startEditPayment(emp, paid)}
                        className="btn-ghost rounded-md px-2.5 py-1 text-xs"
                      >
                        Edit
                      </button>
                    ) : (
                      <button
                        onClick={() => startPayment(emp)}
                        className="btn-ghost rounded-md px-2.5 py-1 text-xs"
                      >
                        Record Payment
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      {payingId && payingEmployee && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <div className="font-bold text-sm text-primary">
                {editingEntryId ? "Edit Payment" : "Record Payment"} — {payingEmployee.full_name}
              </div>
              <div className="text-xs text-muted mt-0.5">For {monthLabel(month)}</div>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              <div>
                <label className="text-xs font-bold text-muted uppercase">Amount</label>
                <input
                  type="number"
                  className="w-full mt-1"
                  value={payAmount}
                  placeholder="0"
                  onChange={(e) => setPayAmount(e.target.value === "" ? "" : Number(e.target.value))}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted uppercase">Handed To</label>
                <input className="w-full mt-1" value={payHandedTo} onChange={(e) => setPayHandedTo(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-bold text-muted uppercase">Payment Date</label>
                <input type="date" className="w-full mt-1" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
              <button onClick={() => { setPayingId(null); setEditingEntryId(null); }} className="btn-ghost rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button onClick={() => confirmPayment(payingEmployee)} className="btn-primary rounded-lg px-4 py-2 text-sm">
                {editingEntryId ? "Save Changes" : "Confirm Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
