"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY, fmtDMYTime } from "@/lib/dateFormat";
import {
  downloadCsv,
  downloadExcel,
  monthName,
  currentMonth,
  recentMonths,
  type ExportColumn,
} from "@/lib/exportLedger";
import DateField from "@/components/DateField";
import AlertModal from "@/components/AlertModal";
import { useSession, ReadOnlyNotice } from "@/components/SessionContext";
import type { LedgerEntry } from "@/types";

type NumField = number | "";
type Row = LedgerEntry & { running: number };

const ALL_MONTHS = "__all__";

export default function LedgerPage() {
  const supabase = createClient();
  const { readOnly } = useSession();
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<"income" | "expense">("expense");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState<NumField>("");
  const [handedTo, setHandedTo] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<LedgerEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [month, setMonth] = useState<string>(currentMonth());

  async function load() {
    // Joins the recording staff member's name in the same query — shown in
    // the table below so every entry is traceable to who logged it.
    const { data, error } = await supabase
      .from("ledger_entries")
      .select("*, profiles(full_name)")
      .order("entry_date");
    if (error) {
      setRestricted(true);
      setEntries([]);
    } else {
      setEntries((data as any) || []);
    }
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel("ledger")
      .on("postgres_changes", { event: "*", schema: "public", table: "ledger_entries" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Running balance is always computed over the full history so the figure
  // stays true even when the view is narrowed to one month.
  const allRows: Row[] = useMemo(() => {
    let running = 0;
    return [...(entries || [])]
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at))
      .map((e) => {
        running += e.type === "income" ? e.amount : -e.amount;
        return { ...e, running };
      });
  }, [entries]);

  const rows = useMemo(
    () => (month === ALL_MONTHS ? allRows : allRows.filter((e) => e.entry_date.slice(0, 7) === month)),
    [allRows, month]
  );

  const income = rows.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const expense = rows.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  const periodLabel = month === ALL_MONTHS ? "All Time" : monthName(month);

  async function handleSave() {
    if (readOnly) return;
    if (!desc.trim() || !amount) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("ledger_entries").insert({
      entry_date: date,
      type,
      description: desc.trim(),
      amount: Number(amount) || 0,
      handed_to: type === "expense" ? handedTo.trim() || null : null,
      created_by: user?.id,
    });
    setDesc("");
    setAmount("");
    setHandedTo("");
    setShowForm(false);
  }

  async function handleDelete() {
    if (!deleteTarget || readOnly) return;
    setDeleting(true);
    await supabase.from("ledger_entries").delete().eq("id", deleteTarget.id);
    setDeleteTarget(null);
    setDeleting(false);
  }

  // ---- Month-end export -----------------------------------------------
  const exportColumns: ExportColumn<Row>[] = [
    { header: "Date", value: (e) => fmtDMY(e.entry_date) },
    { header: "Description", value: (e) => e.description },
    { header: "Handed To", value: (e) => e.handed_to || "" },
    { header: "Type", value: (e) => (e.type === "income" ? "Income" : "Expense") },
    { header: "Income (Rs.)", value: (e) => (e.type === "income" ? Math.round(e.amount) : "") },
    { header: "Expense (Rs.)", value: (e) => (e.type === "expense" ? Math.round(e.amount) : "") },
    { header: "Running Balance (Rs.)", value: (e) => Math.round(e.running) },
    { header: "Recorded By", value: (e) => e.profiles?.full_name || "" },
    { header: "Recorded On", value: (e) => fmtDMYTime(new Date(e.created_at)) },
  ];

  function fileBase() {
    const stamp = month === ALL_MONTHS ? "all-time" : month;
    return `serene-marquee-ledger-${stamp}`;
  }

  function titleLines() {
    return [
      "Serene Marquee — Daily Ledger",
      `Period: ${periodLabel}`,
      `Total Income: Rs. ${Math.round(income).toLocaleString("en-PK")}`,
      `Total Expense: Rs. ${Math.round(expense).toLocaleString("en-PK")}`,
      `Net: Rs. ${Math.round(income - expense).toLocaleString("en-PK")}`,
      `Generated: ${fmtDMYTime(new Date())}`,
    ];
  }

  function handleExportCsv() {
    downloadCsv(fileBase(), exportColumns, rows, titleLines());
  }

  function handleExportExcel() {
    downloadExcel(fileBase(), exportColumns, rows, titleLines());
  }

  if (restricted) {
    return (
      <div className="card max-w-md">
        <div className="text-[14.5px] font-bold text-primary mb-2">Ledger access restricted</div>
        <div className="text-sm text-muted">
          Your account doesn't have permission to view the daily ledger. If this should be enabled for you,
          ask an owner or manager to grant ledger access from the staff list.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Daily Ledger</div>
          <div className="text-xs text-muted mt-0.5">Income and expenses — replaces the paper روزنامچہ</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/ledger/salaries" className="btn-ghost rounded-lg px-4 py-2 text-sm">
            Payroll / Salaries
          </Link>
          <Link href="/ledger/vendors" className="btn-ghost rounded-lg px-4 py-2 text-sm">
            Vendors
          </Link>
          {!readOnly && (
            <button onClick={() => setShowForm(true)} className="btn-primary rounded-lg px-4 py-2 text-sm">
              + Add Entry
            </button>
          )}
        </div>
      </div>

      {readOnly && <ReadOnlyNotice what="the ledger" />}

      {/* Month picker + month-end download */}
      <div className="card my-4 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <label className="text-xs font-bold text-muted uppercase">Showing</label>
          <select className="mt-1 text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
            {recentMonths(24).map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
            <option value={ALL_MONTHS}>All time</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <div className="text-[11.5px] text-muted mr-1 mb-2 hidden sm:block">
            {rows.length} entr{rows.length === 1 ? "y" : "ies"} in {periodLabel}
          </div>
          <button
            onClick={handleExportCsv}
            disabled={rows.length === 0}
            className="btn-ghost rounded-lg px-3.5 py-2 text-sm disabled:opacity-40"
          >
            ⤓ CSV
          </button>
          <button
            onClick={handleExportExcel}
            disabled={rows.length === 0}
            className="btn-primary rounded-lg px-3.5 py-2 text-sm disabled:opacity-40"
          >
            ⤓ Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 my-4">
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Income — {periodLabel}</div>
          <div className="text-2xl font-bold font-serif text-gold-deep mt-1.5">{money(income)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Expense — {periodLabel}</div>
          <div className="text-2xl font-bold font-serif text-rose mt-1.5">{money(expense)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Net — {periodLabel}</div>
          <div className="text-2xl font-bold font-serif mt-1.5">{money(income - expense)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Balance Carried</div>
          <div className="text-2xl font-bold font-serif mt-1.5">
            {money(rows.length ? rows[rows.length - 1].running : 0)}
          </div>
        </div>
      </div>

      {showForm && !readOnly && (
        <div className="card mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-muted uppercase">Date</label>
              <DateField value={date} onChange={setDate} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted uppercase">Type</label>
              <select className="w-full mt-1" value={type} onChange={(e) => setType(e.target.value as any)}>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-muted uppercase">Description</label>
              <input className="w-full mt-1" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Grocery purchase" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted uppercase">Amount</label>
              <input
                type="number"
                className="w-full mt-1"
                value={amount}
                placeholder="0"
                onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>
            {type === "expense" && (
              <div>
                <label className="text-xs font-bold text-muted uppercase">Handed To <span className="normal-case font-normal">(optional)</span></label>
                <input className="w-full mt-1" value={handedTo} onChange={(e) => setHandedTo(e.target.value)} placeholder="e.g. Vendor name, staff member" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowForm(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">
              Cancel
            </button>
            <button onClick={handleSave} className="btn-primary rounded-lg px-4 py-2 text-sm">
              Save Entry
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
              <th className="py-2 px-2">Date</th>
              <th className="py-2 px-2">Description</th>
              <th className="py-2 px-2">Handed To</th>
              <th className="py-2 px-2">Type</th>
              <th className="py-2 px-2">Amount</th>
              <th className="py-2 px-2">Running Balance</th>
              <th className="py-2 px-2">Recorded By</th>
              {!readOnly && <th className="py-2 px-2"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 7 : 8} className="text-center py-8 text-muted text-sm">
                  No entries recorded for {periodLabel}
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0 hover:bg-[#FBF8ED]">
                <td className="py-2.5 px-2">{fmtDMY(e.entry_date)}</td>
                <td className="py-2.5 px-2">{e.description}</td>
                <td className="py-2.5 px-2 text-muted">{e.handed_to || "—"}</td>
                <td className="py-2.5 px-2">
                  <span
                    className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      e.type === "income" ? "bg-primary-dim text-gold-deep" : "bg-rose-light text-rose"
                    }`}
                  >
                    {e.type === "income" ? "Income" : "Expense"}
                  </span>
                </td>
                <td className={`py-2.5 px-2 ${e.type === "income" ? "text-gold-deep" : "text-rose"}`}>
                  {e.type === "income" ? "+" : "-"}
                  {money(e.amount)}
                </td>
                <td className="py-2.5 px-2">{money(e.running)}</td>
                <td className="py-2.5 px-2 text-muted text-[11.5px]">
                  {e.profiles?.full_name || "—"}
                  <br />
                  <span className="text-[10px]">{fmtDMYTime(new Date(e.created_at))}</span>
                </td>
                {!readOnly && (
                  <td className="py-2.5 px-2">
                    <button
                      onClick={() => setDeleteTarget(e)}
                      className="text-[11px] font-semibold text-rose hover:underline"
                      title="Delete this entry"
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {deleteTarget && (
        <AlertModal
          title="Delete this ledger entry?"
          message={`This will permanently remove "${deleteTarget.description}" (${money(deleteTarget.amount)}) from the ledger. This can't be undone.`}
          tone="danger"
          confirmLabel={deleting ? "Deleting…" : "Delete Entry"}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
