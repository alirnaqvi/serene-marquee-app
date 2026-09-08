"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Percent } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/components/SessionContext";
import type { DiscountApproval } from "@/types";

/**
 * Discount request tally on the dashboard, opening the full history.
 *
 * What it counts follows who is looking, because RLS hands back a person's own
 * requests plus everything addressed to their role:
 *
 *   Manager ......... requests they made
 *   General Manager . requests they received, plus their own to the Admin
 *   Admin ........... everything that reached them
 */
export default function DiscountHistoryCard() {
  const supabase = createClient();
  const { role } = useSession();
  const [rows, setRows] = useState<DiscountApproval[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("discount_approvals")
      .select("id, status, requested_by, requested_amount, approved_amount");
    setRows((data as DiscountApproval[]) || []);
  }, [supabase]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("dashboard-discount-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "discount_approvals" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Owner accounts are monitor-only and raise no requests, so an empty card
  // would be pure furniture for them.
  if (rows === null || (rows.length === 0 && role === "owner")) return null;

  const pending = rows.filter((r) => r.status === "pending").length;
  const approved = rows.filter((r) => r.status === "approved").length;
  const rejected = rows.filter((r) => r.status === "rejected").length;

  return (
    <Link href="/discounts" className="card card-hover flex flex-col justify-between">
      <div className="flex items-start justify-between">
        <div className="text-[11.5px] text-muted uppercase font-semibold tracking-wide">Discount Requests</div>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-gold-deep bg-gold-light">
          <Percent size={15} strokeWidth={2.2} />
        </div>
      </div>
      <div className="text-[26px] font-bold font-serif text-primary mt-2 leading-none">{rows.length}</div>
      <div className="text-[11.5px] text-muted mt-2 flex items-center gap-1">
        {pending} pending · {approved} approved · {rejected} declined
        <ArrowUpRight size={11} className="opacity-60" />
      </div>
    </Link>
  );
}
