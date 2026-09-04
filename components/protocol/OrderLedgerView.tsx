"use client";

import { useMemo, useState } from "react";
import { cx, orderStatusMeta } from "@/lib/format";
import { OrderLedger } from "@/components/protocol/Ledgers";
import type { Order, OrderStatus } from "@/lib/types";

type Filter = "ALL" | "OPEN" | "CONTESTED" | "SETTLED";

const FILTERS: Array<{ id: Filter; label: string; match: (status: OrderStatus) => boolean }> = [
  { id: "ALL", label: "All", match: () => true },
  {
    id: "OPEN",
    label: "In flight",
    match: (s) =>
      s === "OFFERED" ||
      s === "ACCEPTED" ||
      s === "ESCROWED" ||
      s === "DELIVERED" ||
      s === "VERIFICATION_PENDING" ||
      s === "FULFILLED",
  },
  {
    id: "CONTESTED",
    label: "Contested",
    match: (s) => s === "DISPUTED" || s === "ADJUDICATING" || s === "BUYER_WON" || s === "MERCHANT_WON",
  },
  { id: "SETTLED", label: "Settled", match: (s) => s === "RELEASED" || s === "REFUNDED" },
];

/**
 * Ledger filtering is a view concern, so it lives in the client while the
 * data still arrives from the adapter on the server.
 */
export function OrderLedgerView({ orders }: { orders: Order[] }) {
  const [filter, setFilter] = useState<Filter>("ALL");

  const counts = useMemo(() => {
    const map = new Map<Filter, number>();
    for (const f of FILTERS) {
      map.set(f.id, orders.filter((o) => f.match(o.status)).length);
    }
    return map;
  }, [orders]);

  const active = FILTERS.find((f) => f.id === filter)!;
  const filtered = orders.filter((o) => active.match(o.status));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const selected = f.id === filter;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={selected}
              className={cx(
                "border px-3 py-2 font-mono text-[10px] tracking-[0.14em] uppercase transition-colors",
                selected
                  ? "border-line-strong bg-raised text-fg"
                  : "border-line text-fg-dim hover:border-line-strong hover:text-fg-muted",
              )}
            >
              {f.label}
              <span className="ml-2 text-fg-faint tnum">{counts.get(f.id) ?? 0}</span>
            </button>
          );
        })}
      </div>

      <OrderLedger orders={filtered} className="mt-5" />

      <p className="mt-4 font-mono text-[10px] leading-relaxed tracking-[0.12em] text-fg-faint uppercase">
        Statuses shown: {Array.from(new Set(filtered.map((o) => orderStatusMeta[o.status].label))).join(" · ") || "none"}
      </p>
    </div>
  );
}
