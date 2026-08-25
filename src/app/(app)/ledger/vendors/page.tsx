"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY } from "@/lib/dateFormat";
import { downloadXlsx, monthName, currentMonth, recentMonths, monthBounds, type SheetColumn } from "@/lib/xlsx";
import AlertModal from "@/components/AlertModal";
import { useSession, ReadOnlyNotice } from "@/components/SessionContext";
import type { Vendor, VendorTransaction } from "@/types";

type NumField = number | "";
const n = (v: NumField) => Number(v) || 0;
const todayIso = () => new Date().toISOString().slice(0, 10);

// A transaction with its running balance filled in.
type LedgerRow = VendorTransaction & { balance: number };

type Modal =
  | { kind: "vendor"; vendor?: Vendor }
  | { kind: "entry"; vendor: Vendor }
  | null;

export default function VendorsPage() {
  const supabase = createClient();
  const { readOnly } = useSession();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [txns, setTxns] = useState<VendorTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerBlocked, setLedgerBlocked] = useState(false);
  const [month, setMonth] = useState(currentMonth());
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Vendor | null>(null);

  // vendor form
  const [category, setCategory] = useState("");
  const [shopName, setShopName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");

  // transaction form — one row of the shop diary
  const [entryKind, setEntryKind] = useState<"credit" | "debit">("credit");
  const [entryAmount, setEntryAmount] = useState<NumField>("");
  const [entryDate, setEntryDate] = useState(todayIso());
  const [entryDesc, setEntryDesc] = useState("");
  const [entryToLedger, setEntryToLedger] = useState(true);

  // per-vendor detail view scope
  const [detailScope, setDetailScope] = useState<"month" | "all">("all");

  async function load() {
    const [{ data: v }, { data: t, error: txnError }] = await Promise.all([
      supabase.from("vendors").select("*").order("sort_order").order("category"),
      supabase.from("vendor_transactions").select("*").order("txn_date").order("created_at"),
    ]);
    setVendors(v || []);
    // Vendor names are visible to all staff; the money side needs ledger access.
    if (txnError) setLedgerBlocked(true);
    else setTxns(t || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(
    () => vendors.filter((v) => (showInactive ? true : v.active)),
    [vendors, showInactive]
  );

  // Running balance is always computed over a vendor's FULL history in date
  // order, so a month view still shows the true carried-forward balance rather
  // than restarting from zero.
  function ledgerFor(vendorId: string): LedgerRow[] {
    let balance = 0;
    return txns
      .filter((t) => t.vendor_id === vendorId)
      .sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.created_at.localeCompare(b.created_at))
      .map((t) => {
        balance += t.credit - t.debit;
        return { ...t, balance };
      });
  }

  function outstandingFor(vendorId: string) {
    const rows = ledgerFor(vendorId);
    return rows.length ? rows[rows.length - 1].balance : 0;
  }
  function billedInMonth(vendorId: string, m: string) {
    return txns
      .filter((t) => t.vendor_id === vendorId && t.txn_date.slice(0, 7) === m)
      .reduce((s, t) => s + t.credit, 0);
  }
  function paidInMonth(vendorId: string, m: string) {
    return txns
      .filter((t) => t.vendor_id === vendorId && t.txn_date.slice(0, 7) === m)
      .reduce((s, t) => s + t.debit, 0);
  }
  function entryCountInMonth(vendorId: string, m: string) {
    return txns.filter((t) => t.vendor_id === vendorId && t.txn_date.slice(0, 7) === m).length;
  }

  const monthBilled = visible.reduce((s, v) => s + billedInMonth(v.id, month), 0);
  const monthPaid = visible.reduce((s, v) => s + paidInMonth(v.id, month), 0);
  const totalOutstanding = visible.reduce((s, v) => s + outstandingFor(v.id), 0);

  async function currentUserId() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id;
  }

  function openVendor(vendor?: Vendor) {
    setModal({ kind: "vendor", vendor });
    setCategory(vendor?.category || "");
    setShopName(vendor?.shop_name || "");
    setContact(vendor?.contact || "");
    setNotes(vendor?.notes || "");
    setError(null);
  }

  function openEntry(vendor: Vendor, kind: "credit" | "debit" = "credit") {
    setModal({ kind: "entry", vendor });
    setEntryKind(kind);
    setEntryAmount("");
    setEntryDate(todayIso());
    setEntryDesc("");
    setEntryToLedger(true);
    setError(null);
  }

  async function saveVendor(existing?: Vendor) {
    if (readOnly) return;
    if (!category.trim()) return setError("Enter what this vendor supplies (e.g. Grocery, Beef).");
    setBusy(true);
    const payload = {
      category: category.trim(),
      shop_name: shopName.trim() || null,
      contact: contact.trim() || null,
      notes: notes.trim() || null,
    };
    const { error: err } = existing
      ? await supabase.from("vendors").update(payload).eq("id", existing.id)
      : await supabase.from("vendors").insert({
          ...payload,
          active: true,
          sort_order: (vendors[vendors.length - 1]?.sort_order || 0) + 1,
        });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    setModal(null);
    setBusy(false);
    load();
  }

  async function saveEntry(vendor: Vendor) {
    if (readOnly) return;
    if (n(entryAmount) <= 0) return setError("Enter an amount greater than zero.");
    setBusy(true);
    const uid = await currentUserId();
    const amount = n(entryAmount);
    const isPayment = entryKind === "debit";
    const description =
      entryDesc.trim() || (isPayment ? "Payment made" : `Bill — ${vendor.shop_name || vendor.category}`);

    // A payment is real money leaving the till, so it also belongs in the
    // daily ledger. A bill received is not — it only affects what we owe.
    let ledgerEntryId: string | null = null;
    if (isPayment && entryToLedger) {
      const { data: le } = await supabase
        .from("ledger_entries")
        .insert({
          entry_date: entryDate,
          type: "expense",
          description: `${vendor.category} — ${vendor.shop_name || "no name"}: ${description}`,
          amount,
          handed_to: vendor.shop_name || vendor.category,
          vendor_id: vendor.id,
          category: "vendor",
          created_by: uid,
        })
        .select("id")
        .single();
      ledgerEntryId = le?.id ?? null;
    }

    const { error: err } = await supabase.from("vendor_transactions").insert({
      vendor_id: vendor.id,
      txn_date: entryDate,
      description,
      debit: isPayment ? amount : 0,
      credit: isPayment ? 0 : amount,
      ledger_entry_id: ledgerEntryId,
      created_by: uid,
    });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    setModal(null);
    setBusy(false);
    load();
  }

  async function deleteTxn(t: VendorTransaction) {
    if (readOnly) return;
    // Remove the mirrored ledger expense too, or the daily balance drifts.
    if (t.ledger_entry_id) await supabase.from("ledger_entries").delete().eq("id", t.ledger_entry_id);
    await supabase.from("vendor_transactions").delete().eq("id", t.id);
    load();
  }

  async function deactivate(vendor: Vendor) {
    if (readOnly) return;
    await supabase.from("vendors").update({ active: false }).eq("id", vendor.id);
    setRemoveTarget(null);
    load();
  }
  async function reactivate(vendor: Vendor) {
    if (readOnly) return;
    await supabase.from("vendors").update({ active: true }).eq("id", vendor.id);
    load();
  }

  // ---- exports --------------------------------------------------------
  const detailColumns: SheetColumn<LedgerRow>[] = [
    { header: "Date", value: (t) => fmtDMY(t.txn_date) },
    { header: "Description", value: (t) => t.description || "", width: 40 },
    { header: "Debit", value: (t) => (t.debit ? Math.round(t.debit) : ""), money: true },
    { header: "Credit", value: (t) => (t.credit ? Math.round(t.credit) : ""), money: true },
    { header: "Balance", value: (t) => Math.round(t.balance), money: true },
  ];

  function detailRows(vendor: Vendor): LedgerRow[] {
    const all = ledgerFor(vendor.id);
    if (detailScope === "all") return all;
    const { from, to } = monthBounds(month);
    return all.filter((t) => t.txn_date >= from && t.txn_date <= to);
  }

  function exportVendor(vendor: Vendor) {
    const rows = detailRows(vendor);
    const debit = rows.reduce((s, t) => s + t.debit, 0);
    const credit = rows.reduce((s, t) => s + t.credit, 0);
    const closing = rows.length ? rows[rows.length - 1].balance : outstandingFor(vendor.id);
    const label = detailScope === "all" ? "All time" : monthName(month);
    downloadXlsx(
      `vendor-${(vendor.shop_name || vendor.category).replace(/\s+/g, "-").toLowerCase()}-${
        detailScope === "all" ? "all" : month
      }`,
      [
        {
          name: (vendor.shop_name || vendor.category).slice(0, 28),
          columns: detailColumns,
          rows,
          titleLines: [
            "Serene Marquee — Vendor Account",
            `${vendor.category} — ${vendor.shop_name || "(no name)"}${vendor.contact ? ` · ${vendor.contact}` : ""}`,
            `Period: ${label}`,
            `Total Billed: Rs. ${Math.round(credit).toLocaleString("en-PK")}   |   Total Paid: Rs. ${Math.round(
              debit
            ).toLocaleString("en-PK")}   |   Balance Remaining: Rs. ${Math.round(closing).toLocaleString("en-PK")}`,
          ],
          totalsRow: ["TOTAL", "", Math.round(debit), Math.round(credit), Math.round(closing)],
        },
      ]
    );
  }

  // Whole-book export: one summary sheet, then a sheet per vendor.
  function exportAll() {
    const summaryColumns: SheetColumn<Vendor>[] = [
      { header: "Supplies", value: (v) => v.category, width: 18 },
      { header: "Shop Name", value: (v) => v.shop_name || "(no name)", width: 24 },
      { header: "Contact", value: (v) => v.contact || "", width: 18 },
      { header: "Entries This Month", value: (v) => entryCountInMonth(v.id, month) },
      { header: "Billed This Month", value: (v) => Math.round(billedInMonth(v.id, month)), money: true },
      { header: "Paid This Month", value: (v) => Math.round(paidInMonth(v.id, month)), money: true },
      { header: "Balance Remaining", value: (v) => Math.round(outstandingFor(v.id)), money: true },
      { header: "Notes", value: (v) => v.notes || "", width: 28 },
    ];

    downloadXlsx(`serene-marquee-vendors-${month}`, [
      {
        name: "Summary",
        columns: summaryColumns,
        rows: visible,
        titleLines: ["Serene Marquee — Vendors", `Month: ${monthName(month)}`],
        totalsRow: [
          "TOTAL",
          "",
          "",
          visible.reduce((s, v) => s + entryCountInMonth(v.id, month), 0),
          Math.round(monthBilled),
          Math.round(monthPaid),
          Math.round(totalOutstanding),
          "",
        ],
      },
      ...visible.map((v) => {
        const rows = ledgerFor(v.id);
        const debit = rows.reduce((s, t) => s + t.debit, 0);
        const credit = rows.reduce((s, t) => s + t.credit, 0);
        return {
          name: (v.shop_name || v.category).slice(0, 28),
          columns: detailColumns,
          rows,
          titleLines: [`${v.category} — ${v.shop_name || "(no name)"}`, "Full account history"],
          totalsRow: [
            "TOTAL",
            "",
            Math.round(debit),
            Math.round(credit),
            Math.round(rows.length ? rows[rows.length - 1].balance : 0),
          ],
        };
      }),
    ]);
  }

  if (loading) return <div className="text-muted text-sm">Loading…</div>;

  return (
    <div>
      <Link href="/ledger" className="text-xs font-bold text-gold-deep hover:underline">
        &larr; Back to Ledger
      </Link>

      <div className="flex items-center justify-between gap-3 flex-wrap mt-2 mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Vendors</div>
          <div className="text-xs text-muted mt-0.5">
            The shops the marquee buys from. Click any vendor to open its account diary.
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
          {!ledgerBlocked && (
            <button onClick={exportAll} className="btn-ghost rounded-lg px-3 py-2 text-sm">
              ⤓ Excel (all)
            </button>
          )}
          {!readOnly && (
            <button onClick={() => openVendor()} className="btn-primary rounded-lg px-4 py-2 text-sm">
              + Add Vendor
            </button>
          )}
        </div>
      </div>

      {readOnly && <ReadOnlyNotice what="vendors" />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 my-4">
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Active Vendors</div>
          <div className="text-2xl font-bold font-serif mt-1.5">{vendors.filter((v) => v.active).length}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Billed — {monthName(month)}</div>
          <div className="text-2xl font-bold font-serif mt-1.5">{ledgerBlocked ? "—" : money(monthBilled)}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Paid — {monthName(month)}</div>
          <div className="text-2xl font-bold font-serif text-gold-deep mt-1.5">
            {ledgerBlocked ? "—" : money(monthPaid)}
          </div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Balance Payable</div>
          <div className="text-2xl font-bold font-serif text-rose mt-1.5">
            {ledgerBlocked ? "—" : money(totalOutstanding)}
          </div>
        </div>
      </div>

      {ledgerBlocked && (
        <div className="text-[11.5px] text-muted bg-bg border border-dashed border-border rounded-lg px-3 py-2 mb-4">
          Vendor names and contacts are shown, but amounts are hidden — those live in the ledger, which your
          account doesn't have access to.
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-[13px] font-bold text-primary">Vendor List ({visible.length})</div>
          <button onClick={() => setShowInactive((s) => !s)} className="text-xs font-bold text-gold-deep hover:underline">
            {showInactive ? "Hide removed vendors" : `Show removed (${vendors.filter((v) => !v.active).length})`}
          </button>
        </div>

        <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[820px] text-[13px]">
          <thead>
            <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
              <th className="py-2 px-2">Supplies</th>
              <th className="py-2 px-2">Shop Name</th>
              <th className="py-2 px-2">Contact</th>
              <th className="py-2 px-2">Entries</th>
              <th className="py-2 px-2">Billed — {monthName(month)}</th>
              <th className="py-2 px-2">Paid — {monthName(month)}</th>
              <th className="py-2 px-2">Balance</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted text-sm">
                  No vendors yet — add the first one.
                </td>
              </tr>
            )}
            {visible.map((v) => {
              const bal = outstandingFor(v.id);
              return (
                <tr
                  key={v.id}
                  onClick={() => !ledgerBlocked && (setDetailVendor(v), setDetailScope("all"))}
                  className={`border-b border-border last:border-0 ${v.active ? "" : "opacity-60"} ${
                    ledgerBlocked ? "" : "cursor-pointer hover:bg-[#FBF8ED]"
                  }`}
                >
                  <td className="py-2.5 px-2 font-semibold">
                    {v.category}
                    {!v.active && <div className="text-[10.5px] text-rose font-normal">Removed</div>}
                  </td>
                  <td className="py-2.5 px-2">
                    {v.shop_name || <span className="text-muted italic">no name</span>}
                    {v.notes && <div className="text-[11px] text-muted font-normal">{v.notes}</div>}
                  </td>
                  <td className="py-2.5 px-2 text-muted">{v.contact || "—"}</td>
                  <td className="py-2.5 px-2 text-muted">
                    {ledgerBlocked ? "—" : entryCountInMonth(v.id, month)}
                  </td>
                  <td className="py-2.5 px-2">{ledgerBlocked ? "—" : money(billedInMonth(v.id, month))}</td>
                  <td className="py-2.5 px-2 text-gold-deep">
                    {ledgerBlocked ? "—" : money(paidInMonth(v.id, month))}
                  </td>
                  <td className={`py-2.5 px-2 font-bold ${bal > 0 ? "text-rose" : ""}`}>
                    {ledgerBlocked ? "—" : bal > 0 ? money(bal) : "Clear"}
                  </td>
                  <td className="py-2.5 px-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      {!ledgerBlocked && (
                        <button
                          onClick={() => (setDetailVendor(v), setDetailScope("all"))}
                          className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap"
                        >
                          View Ledger
                        </button>
                      )}
                      {!readOnly && !ledgerBlocked && v.active && (
                        <button
                          onClick={() => openEntry(v, "credit")}
                          className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap"
                        >
                          + Entry
                        </button>
                      )}
                      {!readOnly && (
                        <>
                          <button onClick={() => openVendor(v)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px]">
                            Rename
                          </button>
                          {v.active ? (
                            <button
                              onClick={() => setRemoveTarget(v)}
                              className="text-[11px] font-semibold text-rose border border-rose/30 rounded-md px-2.5 py-1 hover:bg-rose-light"
                            >
                              Remove
                            </button>
                          ) : (
                            <button onClick={() => reactivate(v)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px]">
                              Restore
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <div className="text-[11px] text-muted mt-3">
          <b>Credit</b> = a bill received from the shop (increases what we owe). <b>Debit</b> = a payment made
          (reduces it, and posts to the daily ledger). Balance is what's still payable.
        </div>
      </div>

      {/* ---------------- PER-VENDOR ACCOUNT DIARY ---------------- */}
      {detailVendor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-4xl shadow-2xl my-8">
            <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-serif text-lg font-bold text-primary">
                  {detailVendor.shop_name || "(no name)"}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {detailVendor.category}
                  {detailVendor.contact && ` · ${detailVendor.contact}`}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className="text-xs py-1"
                  value={detailScope}
                  onChange={(e) => setDetailScope(e.target.value as any)}
                >
                  <option value="all">Full history</option>
                  <option value="month">{monthName(month)} only</option>
                </select>
                {!readOnly && detailVendor.active && (
                  <button
                    onClick={() => openEntry(detailVendor, "credit")}
                    className="btn-ghost rounded-lg px-3 py-1.5 text-xs"
                  >
                    + Add Entry
                  </button>
                )}
                <button onClick={() => exportVendor(detailVendor)} className="btn-primary rounded-lg px-3 py-1.5 text-xs">
                  ⤓ Download Excel
                </button>
                <button
                  onClick={() => setDetailVendor(null)}
                  className="text-muted hover:text-primary text-xl leading-none px-1"
                >
                  &times;
                </button>
              </div>
            </div>

            {(() => {
              const rows = detailRows(detailVendor);
              const debit = rows.reduce((s, t) => s + t.debit, 0);
              const credit = rows.reduce((s, t) => s + t.credit, 0);
              const closing = rows.length ? rows[rows.length - 1].balance : outstandingFor(detailVendor.id);
              return (
                <>
                  <div className="px-5 pt-4 grid grid-cols-3 gap-3">
                    <div className="bg-bg border border-border rounded-lg px-3 py-2">
                      <div className="text-[10.5px] text-muted uppercase font-semibold">Total Billed</div>
                      <div className="text-[15px] font-bold font-serif mt-0.5">{money(credit)}</div>
                    </div>
                    <div className="bg-bg border border-border rounded-lg px-3 py-2">
                      <div className="text-[10.5px] text-muted uppercase font-semibold">Total Paid</div>
                      <div className="text-[15px] font-bold font-serif text-gold-deep mt-0.5">{money(debit)}</div>
                    </div>
                    <div className="bg-bg border border-border rounded-lg px-3 py-2">
                      <div className="text-[10.5px] text-muted uppercase font-semibold">Balance Remaining</div>
                      <div className={`text-[15px] font-bold font-serif mt-0.5 ${closing > 0 ? "text-rose" : ""}`}>
                        {money(closing)}
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-4 max-h-[52vh] overflow-y-auto">
                    <table className="w-full text-[12.5px]">
                      <thead className="sticky top-0 bg-white">
                        <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
                          <th className="py-2 px-2">Date</th>
                          <th className="py-2 px-2">Description</th>
                          <th className="py-2 px-2 text-right">Debit</th>
                          <th className="py-2 px-2 text-right">Credit</th>
                          <th className="py-2 px-2 text-right">Balance</th>
                          {!readOnly && <th className="py-2 px-2"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 && (
                          <tr>
                            <td colSpan={readOnly ? 5 : 6} className="text-center py-8 text-muted">
                              No entries recorded{detailScope === "month" ? ` in ${monthName(month)}` : ""} yet.
                            </td>
                          </tr>
                        )}
                        {rows.map((t) => (
                          <tr key={t.id} className="border-b border-border last:border-0">
                            <td className="py-2 px-2 whitespace-nowrap">{fmtDMY(t.txn_date)}</td>
                            <td className="py-2 px-2">{t.description || "—"}</td>
                            <td className="py-2 px-2 text-right text-gold-deep">
                              {t.debit ? money(t.debit) : "—"}
                            </td>
                            <td className="py-2 px-2 text-right text-rose">{t.credit ? money(t.credit) : "—"}</td>
                            <td className="py-2 px-2 text-right font-bold">{money(t.balance)}</td>
                            {!readOnly && (
                              <td className="py-2 px-2 text-right">
                                <button
                                  onClick={() => deleteTxn(t)}
                                  className="text-[11px] font-semibold text-rose hover:underline"
                                >
                                  Delete
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      {rows.length > 0 && (
                        <tfoot>
                          <tr className="border-t-2 border-border font-bold">
                            <td className="py-2 px-2" colSpan={2}>
                              TOTAL
                            </td>
                            <td className="py-2 px-2 text-right">{money(debit)}</td>
                            <td className="py-2 px-2 text-right">{money(credit)}</td>
                            <td className="py-2 px-2 text-right">{money(closing)}</td>
                            {!readOnly && <td />}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ---------------- ADD / EDIT MODALS ---------------- */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl overflow-hidden my-8">
            <div className="px-5 py-4 border-b border-border">
              <div className="font-bold text-sm text-primary">
                {modal.kind === "vendor"
                  ? modal.vendor
                    ? `Edit — ${modal.vendor.category}`
                    : "Add Vendor"
                  : `New Entry — ${modal.vendor.shop_name || modal.vendor.category}`}
              </div>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              {error && <div className="text-rose text-[12.5px] font-semibold">{error}</div>}

              {modal.kind === "vendor" ? (
                <>
                  <div>
                    <label className="text-xs font-bold text-muted uppercase">Supplies</label>
                    <input
                      className="w-full mt-1"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="e.g. Grocery, Beef, Gas Cylinder"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-muted uppercase">Shop Name</label>
                    <input
                      className="w-full mt-1"
                      value={shopName}
                      onChange={(e) => setShopName(e.target.value)}
                      placeholder="Leave blank if the shop has no name"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-muted uppercase">Contact (optional)</label>
                    <input className="w-full mt-1" value={contact} onChange={(e) => setContact(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-muted uppercase">Notes (optional)</label>
                    <input className="w-full mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-bold text-muted uppercase">Entry Type</label>
                    <select
                      className="w-full mt-1"
                      value={entryKind}
                      onChange={(e) => setEntryKind(e.target.value as any)}
                    >
                      <option value="credit">Credit — bill received (we owe more)</option>
                      <option value="debit">Debit — payment made (we owe less)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-muted uppercase">Date</label>
                    <input type="date" className="w-full mt-1" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                    <div className="text-[11px] text-muted mt-1">
                      Multiple entries on the same date are fine — add one row per bill or payment.
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-muted uppercase">Amount</label>
                    <input
                      type="number"
                      className="w-full mt-1"
                      value={entryAmount}
                      placeholder="0"
                      onChange={(e) => setEntryAmount(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-muted uppercase">Description</label>
                    <input
                      className="w-full mt-1"
                      value={entryDesc}
                      onChange={(e) => setEntryDesc(e.target.value)}
                      placeholder={entryKind === "debit" ? "e.g. Cash paid against bill #12" : "e.g. Weekly grocery bill"}
                    />
                  </div>
                  {entryKind === "debit" && (
                    <label className="flex items-center gap-2 text-[12.5px]">
                      <input
                        type="checkbox"
                        checked={entryToLedger}
                        onChange={(e) => setEntryToLedger(e.target.checked)}
                      />
                      Also record in the daily ledger as an expense
                    </label>
                  )}
                </>
              )}
            </div>
            <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
              <button onClick={() => { setModal(null); setError(null); }} className="btn-ghost rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => (modal.kind === "vendor" ? saveVendor(modal.vendor) : saveEntry(modal.vendor))}
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
          title="Remove this vendor?"
          message={`${removeTarget.shop_name || removeTarget.category} will be hidden from the active list. Their account history stays intact, and you can restore them any time.`}
          tone="danger"
          confirmLabel="Remove Vendor"
          onConfirm={() => deactivate(removeTarget)}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}
