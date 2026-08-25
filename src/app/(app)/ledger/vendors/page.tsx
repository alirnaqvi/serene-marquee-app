"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY } from "@/lib/dateFormat";
import { monthName, currentMonth, recentMonths, downloadCsv, downloadExcel, type ExportColumn } from "@/lib/exportLedger";
import AlertModal from "@/components/AlertModal";
import { useSession, ReadOnlyNotice } from "@/components/SessionContext";
import type { Vendor, LedgerEntry } from "@/types";

type NumField = number | "";
const n = (v: NumField) => Number(v) || 0;
const todayIso = () => new Date().toISOString().slice(0, 10);

type Modal = { kind: "vendor"; vendor?: Vendor } | { kind: "pay"; vendor: Vendor } | null;

export default function VendorsPage() {
  const supabase = createClient();
  const { readOnly } = useSession();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payments, setPayments] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerBlocked, setLedgerBlocked] = useState(false);
  const [month, setMonth] = useState(currentMonth());
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Vendor | null>(null);

  // vendor form
  const [category, setCategory] = useState("");
  const [shopName, setShopName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");

  // payment form
  const [payAmount, setPayAmount] = useState<NumField>("");
  const [payDate, setPayDate] = useState(todayIso());
  const [payDesc, setPayDesc] = useState("");

  async function load() {
    const [{ data: v }, { data: p, error: payError }] = await Promise.all([
      supabase.from("vendors").select("*").order("sort_order").order("category"),
      supabase.from("ledger_entries").select("*").eq("category", "vendor"),
    ]);
    setVendors(v || []);
    // Vendors themselves are visible to all staff; the money side is only
    // visible to accounts that already have ledger access.
    if (payError) setLedgerBlocked(true);
    else setPayments(p || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(
    () => vendors.filter((v) => (showInactive ? true : v.active)),
    [vendors, showInactive]
  );

  function paidThisMonth(vendorId: string) {
    return payments
      .filter((p) => p.vendor_id === vendorId && p.entry_date.slice(0, 7) === month)
      .reduce((s, p) => s + p.amount, 0);
  }
  function paidAllTime(vendorId: string) {
    return payments.filter((p) => p.vendor_id === vendorId).reduce((s, p) => s + p.amount, 0);
  }
  function lastPayment(vendorId: string) {
    const rows = payments
      .filter((p) => p.vendor_id === vendorId)
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
    return rows[0] || null;
  }

  const monthTotal = visible.reduce((s, v) => s + paidThisMonth(v.id), 0);

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

  function openPay(vendor: Vendor) {
    setModal({ kind: "pay", vendor });
    setPayAmount("");
    setPayDate(todayIso());
    setPayDesc(`${vendor.category} — ${vendor.shop_name || "no name"}`);
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

  async function savePayment(vendor: Vendor) {
    if (readOnly) return;
    if (n(payAmount) <= 0) return setError("Enter the amount paid.");
    setBusy(true);
    const { error: err } = await supabase.from("ledger_entries").insert({
      entry_date: payDate,
      type: "expense",
      description: payDesc.trim() || `${vendor.category} — ${vendor.shop_name || "no name"}`,
      amount: n(payAmount),
      handed_to: vendor.shop_name || vendor.category,
      vendor_id: vendor.id,
      category: "vendor",
      created_by: await currentUserId(),
    });
    if (err) {
      setError(
        err.message.includes("row-level security")
          ? "Your account can't post to the ledger, so this payment wasn't recorded."
          : err.message
      );
      setBusy(false);
      return;
    }
    setModal(null);
    setBusy(false);
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

  const exportColumns: ExportColumn<Vendor>[] = [
    { header: "Supplies", value: (v) => v.category },
    { header: "Shop Name", value: (v) => v.shop_name || "(no name)" },
    { header: "Contact", value: (v) => v.contact || "" },
    { header: `Paid ${monthName(month)} (Rs.)`, value: (v) => Math.round(paidThisMonth(v.id)) },
    { header: "Paid All Time (Rs.)", value: (v) => Math.round(paidAllTime(v.id)) },
    { header: "Notes", value: (v) => v.notes || "" },
  ];

  const exportTitle = ["Serene Marquee — Vendors", `Month: ${monthName(month)}`];

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
            The shops the marquee buys from. Shop names aren't fixed — rename any of them any time.
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
          <button
            onClick={() => downloadCsv(`serene-marquee-vendors-${month}`, exportColumns, visible, exportTitle)}
            className="btn-ghost rounded-lg px-3 py-2 text-sm"
          >
            ⤓ CSV
          </button>
          <button
            onClick={() => downloadExcel(`serene-marquee-vendors-${month}`, exportColumns, visible, exportTitle)}
            className="btn-ghost rounded-lg px-3 py-2 text-sm"
          >
            ⤓ Excel
          </button>
          {!readOnly && (
            <button onClick={() => openVendor()} className="btn-primary rounded-lg px-4 py-2 text-sm">
              + Add Vendor
            </button>
          )}
        </div>
      </div>

      {readOnly && <ReadOnlyNotice what="vendors" />}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 my-4">
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Active Vendors</div>
          <div className="text-2xl font-bold font-serif mt-1.5">{vendors.filter((v) => v.active).length}</div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Paid — {monthName(month)}</div>
          <div className="text-2xl font-bold font-serif text-rose mt-1.5">
            {ledgerBlocked ? "—" : money(monthTotal)}
          </div>
        </div>
        <div className="card">
          <div className="text-[11.5px] text-muted uppercase font-semibold">Paid — All Time</div>
          <div className="text-2xl font-bold font-serif mt-1.5">
            {ledgerBlocked ? "—" : money(payments.reduce((s, p) => s + p.amount, 0))}
          </div>
        </div>
      </div>

      {ledgerBlocked && (
        <div className="text-[11.5px] text-muted bg-bg border border-dashed border-border rounded-lg px-3 py-2 mb-4">
          Vendor names and contacts are shown, but payment amounts are hidden — those live in the ledger, which
          your account doesn't have access to.
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-[13px] font-bold text-primary">Vendor List ({visible.length})</div>
          <button onClick={() => setShowInactive((s) => !s)} className="text-xs font-bold text-gold-deep hover:underline">
            {showInactive ? "Hide removed vendors" : `Show removed (${vendors.filter((v) => !v.active).length})`}
          </button>
        </div>

        <div className="overflow-x-auto -mx-1"><table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
              <th className="py-2 px-2">Supplies</th>
              <th className="py-2 px-2">Shop Name</th>
              <th className="py-2 px-2">Contact</th>
              <th className="py-2 px-2">Paid — {monthName(month)}</th>
              <th className="py-2 px-2">Last Payment</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted text-sm">
                  No vendors yet — add the first one.
                </td>
              </tr>
            )}
            {visible.map((v) => {
              const last = lastPayment(v.id);
              return (
                <tr key={v.id} className={`border-b border-border last:border-0 ${v.active ? "" : "opacity-60"}`}>
                  <td className="py-2.5 px-2 font-semibold">
                    {v.category}
                    {!v.active && <div className="text-[10.5px] text-rose font-normal">Removed</div>}
                  </td>
                  <td className="py-2.5 px-2">
                    {v.shop_name || <span className="text-muted italic">no name</span>}
                    {v.notes && <div className="text-[11px] text-muted font-normal">{v.notes}</div>}
                  </td>
                  <td className="py-2.5 px-2 text-muted">{v.contact || "—"}</td>
                  <td className="py-2.5 px-2">{ledgerBlocked ? "—" : money(paidThisMonth(v.id))}</td>
                  <td className="py-2.5 px-2 text-muted text-[12px]">
                    {ledgerBlocked || !last ? "—" : `${money(last.amount)} · ${fmtDMY(last.entry_date)}`}
                  </td>
                  <td className="py-2.5 px-2">
                    {readOnly ? (
                      <span className="text-muted text-[11px]">—</span>
                    ) : (
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        {!ledgerBlocked && v.active && (
                          <button onClick={() => openPay(v)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px] whitespace-nowrap">
                            Record Payment
                          </button>
                        )}
                        <button onClick={() => openVendor(v)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px]">
                          Rename / Edit
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
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl overflow-hidden my-8">
            <div className="px-5 py-4 border-b border-border">
              <div className="font-bold text-sm text-primary">
                {modal.kind === "vendor"
                  ? modal.vendor
                    ? `Edit — ${modal.vendor.category}`
                    : "Add Vendor"
                  : `Record Payment — ${modal.vendor.shop_name || modal.vendor.category}`}
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
                    <label className="text-xs font-bold text-muted uppercase">Date</label>
                    <input type="date" className="w-full mt-1" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-muted uppercase">Description</label>
                    <input className="w-full mt-1" value={payDesc} onChange={(e) => setPayDesc(e.target.value)} />
                  </div>
                  <div className="text-[11px] text-muted">This posts to the daily ledger as an expense.</div>
                </>
              )}
            </div>
            <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
              <button onClick={() => { setModal(null); setError(null); }} className="btn-ghost rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => (modal.kind === "vendor" ? saveVendor(modal.vendor) : savePayment(modal.vendor))}
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
          message={`${removeTarget.shop_name || removeTarget.category} will be hidden from the active list. Past payments to them stay in the ledger, and you can restore them any time.`}
          tone="danger"
          confirmLabel="Remove Vendor"
          onConfirm={() => deactivate(removeTarget)}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}
