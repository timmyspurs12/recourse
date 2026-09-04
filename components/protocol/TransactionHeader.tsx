import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cx } from "@/lib/format";
import { Amount, Timestamp } from "@/components/system/Values";
import { AgentIdentity } from "@/components/system/AgentIdentity";
import { ProtectedChip, StateBadge } from "@/components/system/StateBadge";
import { ProvenanceTag } from "@/components/system/Provenance";
import type { Order } from "@/lib/types";

/**
 * TransactionHeader — the identity block at the top of an order dossier.
 */
export function TransactionHeader({
  order,
  kicker = "ORDER",
  disputeHref,
  className,
}: {
  order: Order;
  kicker?: string;
  disputeHref?: string;
  className?: string;
}) {
  return (
    <header className={cx("border border-line bg-panel", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="mono-label text-fg-faint">{kicker}</span>
          <span className="font-mono text-sm tracking-[0.14em] text-fg">{order.ref}</span>
          <ProvenanceTag provenance={order.provenance} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order.protected ? <ProtectedChip /> : null}
          <StateBadge status={order.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        <div className="px-4 py-5 sm:px-6">
          <h1 className="text-xl leading-snug tracking-[-0.01em] text-fg sm:text-2xl">
            {order.title}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-fg-muted">{order.description}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Timestamp iso={order.createdAt} prefix="OPENED" />
            <Timestamp iso={order.updatedAt} prefix="UPDATED" />
            {disputeHref ? (
              <Link
                href={disputeHref}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.14em] text-protected uppercase transition-colors hover:text-fg"
              >
                View dispute dossier
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-1 lg:gap-6">
          <div className="flex flex-col gap-4 sm:col-span-2 lg:col-span-1">
            <AgentIdentity agent={order.buyer} role="BUYER" showOperator />
            <div className="flex items-center gap-3 pl-4" aria-hidden>
              <span className="h-6 w-px bg-line-strong" />
              <span className="mono-label text-fg-faint">pays under protection</span>
            </div>
            <AgentIdentity agent={order.merchant} role="MERCHANT" showOperator />
          </div>
          <div className="border-t border-line pt-4 sm:col-span-2 lg:col-span-1">
            <span className="mono-label">Amount</span>
            <div className="mt-2">
              <Amount money={order.amount} size="lg" />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
