"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/calculations";
import { fmtDMY, fmtDMYTime } from "@/lib/dateFormat";
import { useSession } from "@/components/SessionContext";
import { ROLE_LABELS, type DiscountApproval, type ApprovalStatus } from "@/types";

/**
 * Every discount request ever raised, with what happened to it.
 *
 * What lands here depends on who is looking, because RLS returns a person's
 * own requests plus anything addressed to their role:
 *
 *   Manager ......... the requests they made
 *   General Manager . the requests they received, and the ones they made
 *   Admin ........... every request that reached them
 *
 * So the same screen answers "what did I ask for?" and "what came to me?"
 * without either role needing a different page.
 */

type Tab = "all" | "received" | "made";

function StatusPill({ status }: { status: ApprovalStatus }) {
  const styles: Record<ApprovalStatus, string> = {
    pending: "bg-gold-light text-[#8A6427]",
    approved: "bg-primary-dim text-gold-deep",
    rejected: "bg-rose-light text-rose",
  };
  const labels: Record<ApprovalStatus, string> = {
    pending: "Pending",
    approved: "Approved",
    rejected: "Declined",
  };
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-bold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "gold" | "rose" }) {
  return (
    <div className="bg-bg border border-border rounded-lg px-3 py-2.5">
      <div className="text-[10.5px] text-muted uppercase font-semibold tracking-wide">{label}</div>
      <div
        className={`text-[19px] font-bold font-serif mt-1 leading-none ${
          tone === "rose" ? "text-rose" : tone === "gold" ? "text-gold-deep" : "text-primary"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted mt-1">{sub}</div>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[9.5px] tracking-[0.1em] uppercase text-muted">{label}</div>
      <div className="text-[12.5px] font-semibold text-primary leading-snug">{value}</div>
    </div>
  );
}

export default function DiscountHistoryPage() {
  const supabase = createClient();
  const { role } = useSession();

  const [rows, setRows] = useState<DiscountApproval[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ApprovalStatus>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data } = await supabase
      .from("discount_approvals")
      .select("*")
      .order("created_at", { ascending: false });
    const list = (data as DiscountApproval[]) || [];
    setRows(list);

    const ids = Array.from(
      new Set([...list.map((r) => r.requested_by), ...list.map((r) => r.decided_by)].filter(Boolean) as string[])
    );
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: any) => (map[p.id] = p.full_name));
      setNames(map);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("discount-history")
      .on("postgres_changes", { event: "*", schema: "public", table: "discount_approvals" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const made = useMemo(() => rows.filter((r) => r.requested_by === userId), [rows, userId]);
  const received = useMemo(() => rows.filter((r) => r.requested_by !== userId), [rows, userId]);

  // A Manager only ever makes requests, so the two-sided view would just show
  // them an empty "received" column. Admin and General Manager see both.
  const hasReceived = received.length > 0 || role === "admin" || role === "general_manager";

  const scoped = tab === "made" ? made : tab === "received" ? received : rows;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      const ref = r.booking_number ? `sm-${String(r.booking_number).padStart(6, "0")}` : "";
      return (
        (r.client_name || "").toLowerCase().includes(q) ||
        ref.includes(q) ||
        (r.booking_number ? String(r.booking_number).includes(q.replace(/\D/g, "")) : false) ||
        (names[r.requested_by] || "").toLowerCase().includes(q) ||
        (r.reason || "").toLowerCase().includes(q)
      );
    });
  }, [scoped, statusFilter, search, names]);

  const count = (list: DiscountApproval[], s: ApprovalStatus) => list.filter((r) => r.status === s).length;
  const grantedTotal = scoped
    .filter((r) => r.status === "approved")
    .reduce((sum, r) => sum + (r.approved_amount ?? r.requested_amount), 0);

  return (
    <div>
      <div className="text-xl font-bold font-serif text-primary mb-1">Discount Requests</div>
      <div className="text-xs text-muted mb-5">
        {role === "admin"
          ? "Every request that reached you — pending, approved and declined."
          : role === "general_manager"
          ? "Requests that came to you, and the ones you sent up to the Admin."
          : "Every approval you have asked for, and what was decided."}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 mb-5">
        <Stat label="Total Requests" value={scoped.length} />
        <Stat label="Pending" value={count(scoped, "pending")} tone="gold" sub="Awaiting a decision" />
        <Stat label="Approved" value={count(scoped, "approved")} />
        <Stat label="Declined" value={count(scoped, "rejected")} tone="rose" />
        <Stat label="Discount Granted" value={money(grantedTotal)} sub="Total actually allowed" />
      </div>

      <div className="card mb-4">
        <div className="flex gap-2 flex-wrap items-center">
          {hasReceived && (
            <div className="flex gap-1.5">
              {([
                ["all", "All"],
                ["received", `Received (${received.length})`],
                ["made", `I requested (${made.length})`],
              ] as [Tab, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border ${
                    tab === value ? "bg-primary text-gold-light border-primary" : "bg-white border-border"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <select
            className="text-[13px]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Declined</option>
          </select>
          <input
            className="flex-1 min-w-[200px] text-[13px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order no., client, requester or reason…"
          />
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[13px] min-w-[860px]">
            <thead>
              <tr className="text-left text-muted text-[11px] uppercase tracking-wide border-b border-border">
                <th className="py-2 px-2">Raised</th>
                <th className="py-2 px-2">Order No.</th>
                <th className="py-2 px-2">Client</th>
                <th className="py-2 px-2">Requested By</th>
                <th className="py-2 px-2 text-right">Asked</th>
                <th className="py-2 px-2 text-right">Granted</th>
                <th className="py-2 px-2">Status</th>
                <th className="py-2 px-2">Decided By</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted text-sm">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted text-sm">
                    No discount requests to show.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const ref = r.booking_number ? `SM-${String(r.booking_number).padStart(6, "0")}` : "—";
                const open = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : r.id)}
                      className="border-b border-border last:border-0 hover:bg-[#FBF8ED] cursor-pointer"
                    >
                      <td className="py-2.5 px-2 whitespace-nowrap">{fmtDMY(r.created_at.slice(0, 10))}</td>
                      <td className="py-2.5 px-2 font-semibold">
                        {r.booking_id ? (
                          <Link
                            href={`/bookings/${r.booking_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {ref}
                          </Link>
                        ) : (
                          ref
                        )}
                      </td>
                      <td className="py-2.5 px-2">{r.client_name || "—"}</td>
                      <td className="py-2.5 px-2">
                        {names[r.requested_by] || "—"}
                        <span className="text-muted text-[11px]"> · {ROLE_LABELS[r.requester_role]}</span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-semibold">{money(r.requested_amount)}</td>
                      <td className="py-2.5 px-2 text-right font-semibold">
                        {r.status === "approved" ? money(r.approved_amount ?? r.requested_amount) : "—"}
                      </td>
                      <td className="py-2.5 px-2">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="py-2.5 px-2">{r.decided_by ? names[r.decided_by] || "—" : "—"}</td>
                    </tr>
                    {open && (
                      <tr className="border-b border-border bg-bg">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                            <Detail
                              label="Date & sitting"
                              value={
                                r.event_date
                                  ? `${fmtDMY(r.event_date)}${r.session ? ` · ${r.session}` : ""}`
                                  : null
                              }
                            />
                            <Detail label="Venue" value={r.venue_label} />
                            <Detail label="Function" value={r.function_label} />
                            <Detail label="Guests" value={r.guests ? String(r.guests) : null} />
                            <Detail label="Menu" value={r.menu_label} />
                            <Detail
                              label="Booking total"
                              value={r.booking_total != null ? money(r.booking_total) : null}
                            />
                            <Detail
                              label="Discount at the time"
                              value={r.current_discount != null ? money(r.current_discount) : null}
                            />
                            <Detail label="Requester's own limit" value={money(r.requester_limit)} />
                            <Detail
                              label="Sent to"
                              value={r.approver_roles.map((role) => ROLE_LABELS[role]).join(" and ")}
                            />
                            <Detail
                              label="Decided"
                              value={r.decided_at ? fmtDMYTime(new Date(r.decided_at)) : null}
                            />
                            <Detail
                              label="Applied to booking"
                              value={r.consumed_at ? `Yes · ${fmtDMYTime(new Date(r.consumed_at))}` : "Not yet used"}
                            />
                          </div>
                          {r.reason && (
                            <div className="text-[12.5px] text-muted italic mt-2">
                              Reason given: “{r.reason}”
                            </div>
                          )}
                          {r.decision_note && (
                            <div className="text-[12.5px] text-primary font-semibold mt-1">
                              Note from the approver: “{r.decision_note}”
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-muted mt-3">Tap any row to see the booking it was raised against.</div>
      </div>
    </div>
  );
}
