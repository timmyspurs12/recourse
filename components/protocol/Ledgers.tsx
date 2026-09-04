import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cx, formatDate, formatMoney, rulingOutcomeLabel } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { StateBadge, Tag } from "@/components/system/StateBadge";
import { EmptyState } from "@/components/system/States";
import { provenanceSummary } from "@/lib/selectors";
import type { CaseRecord, Order } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Order ledger                                                        */
/* ------------------------------------------------------------------ */

/**
 * OrderLedger — a protocol transaction ledger, not a marketing table.
 * One DOM table; rows become stacked records below `md`.
 */
export function OrderLedger({
  orders,
  title = "ORDERS",
  emptyMessage,
  className,
}: {
  orders: Order[];
  title?: string;
  emptyMessage?: string;
  className?: string;
}) {
  if (orders.length === 0) {
    return (
      <EmptyState
        label="LEDGER"
        title="No orders match"
        description={
          emptyMessage ??
          "No protected purchases match the current filter. Clear the filter to see the full ledger."
        }
        className={className}
      />
    );
  }

  return (
    <Panel className={className}>
      <PanelHeader
        title={title}
        meta={`${orders.length} RECORDS`}
        actions={<Tag size="xs">{provenanceSummary(orders)}</Tag>}
      />
      <table className="w-full border-collapse text-left">
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-line">
            <th scope="col" className="mono-label px-5 py-3 font-normal">Order</th>
            <th scope="col" className="mono-label px-5 py-3 font-normal">Buyer</th>
            <th scope="col" className="mono-label px-5 py-3 font-normal">Merchant</th>
            <th scope="col" className="mono-label px-5 py-3 text-right font-normal">Amount</th>
            <th scope="col" className="mono-label px-5 py-3 font-normal">Status</th>
            <th scope="col" className="mono-label px-5 py-3 text-right font-normal">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {orders.map((order) => (
            <tr
              key={order.id}
              className="block border-b border-line transition-colors last:border-b-0 hover:bg-raised/60 md:table-row"
            >
              <th scope="row" className="block px-4 pt-4 pb-2 text-left font-normal md:table-cell md:px-5 md:py-4">
                <Link
                  href={`/orders/${order.id}`}
                  className="group inline-flex items-center gap-2 font-mono text-sm text-fg"
                >
                  <span className="tracking-[0.08em]">{order.ref}</span>
                  <ArrowUpRight
                    className="size-3.5 text-fg-faint transition-colors group-hover:text-protected"
                    aria-hidden
                  />
                </Link>
                <span className="mt-1 block max-w-xs truncate text-xs text-fg-dim">{order.title}</span>
              </th>
              <td className="flex items-baseline justify-between gap-4 px-4 py-1 md:table-cell md:px-5 md:py-4">
                <span className="mono-label md:hidden">Buyer</span>
                <span className="font-mono text-xs text-fg-muted">{order.buyer.handle}</span>
              </td>
              <td className="flex items-baseline justify-between gap-4 px-4 py-1 md:table-cell md:px-5 md:py-4">
                <span className="mono-label md:hidden">Merchant</span>
                <span className="font-mono text-xs text-fg-muted">{order.merchant.handle}</span>
              </td>
              <td className="flex items-baseline justify-between gap-4 px-4 py-1 md:table-cell md:px-5 md:py-4 md:text-right">
                <span className="mono-label md:hidden">Amount</span>
                <span className="font-mono text-sm tnum text-fg">{formatMoney(order.amount)}</span>
              </td>
              <td className="flex items-center justify-between gap-4 px-4 py-2 md:table-cell md:px-5 md:py-4">
                <span className="mono-label md:hidden">Status</span>
                <StateBadge status={order.status} size="xs" />
              </td>
              <td className="flex items-baseline justify-between gap-4 px-4 pt-1 pb-4 md:table-cell md:px-5 md:py-4 md:text-right">
                <span className="mono-label md:hidden">Created</span>
                <span className="font-mono text-xs tnum text-fg-dim">{formatDate(order.createdAt)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Case ledger                                                         */
/* ------------------------------------------------------------------ */

/**
 * CaseLedger — disputes as protocol cases. Each record states the contested
 * term, the outcome and the resulting settlement. No analytics, no charts.
 */
/**
 * A case with no ruling yet is not necessarily being adjudicated. "Opened" and
 * "submitted to the forum" are different facts and the ledger states which.
 */
const caseStageLabel: Record<CaseRecord["status"], string> = {
  OPEN: "Awaiting adjudication",
  EVIDENCE_REVIEW: "Adjudication failed",
  ADJUDICATING: "Adjudicating",
  RULED: "Ruled",
  SETTLED: "Settled",
  WITHDRAWN: "Withdrawn",
};

export function CaseLedger({
  cases,
  className,
}: {
  cases: CaseRecord[];
  className?: string;
}) {
  if (cases.length === 0) {
    return (
      <EmptyState
        label="CASES"
        title="No cases opened"
        description="Cases appear here when a protected purchase is contested. A satisfied promise never becomes a case."
        className={className}
      />
    );
  }

  return (
    <ul className={cx("grid grid-cols-1 gap-3 lg:grid-cols-2", className)}>
      {cases.map((record) => (
        <li key={record.disputeId}>
          <Link
            href={`/disputes/${record.disputeId}`}
            className="group flex h-full flex-col border border-line bg-panel transition-colors hover:border-line-strong"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <span className="font-mono text-sm tracking-[0.1em] text-fg">{record.ref}</span>
              <div className="flex items-center gap-2">
                {record.outcome ? (
                  <Tag tone={record.outcome === "BUYER_WINS" ? "protected" : "pass"} size="xs">
                    {rulingOutcomeLabel[record.outcome].replace("WINS", "WON")}
                  </Tag>
                ) : (
                  <Tag tone="pending" size="xs" dot>
                    {caseStageLabel[record.status]}
                  </Tag>
                )}
                <ArrowUpRight
                  className="size-3.5 text-fg-faint transition-colors group-hover:text-protected"
                  aria-hidden
                />
              </div>
            </div>

            <div className="flex-1 px-4 py-4">
              <p className="text-sm leading-snug text-fg">{record.title}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <dt className="mono-label">Buyer</dt>
                  <dd className="mt-1 truncate font-mono text-xs text-fg-muted">{record.buyerHandle}</dd>
                </div>
                <div>
                  <dt className="mono-label">Merchant</dt>
                  <dd className="mt-1 truncate font-mono text-xs text-fg-muted">{record.merchantHandle}</dd>
                </div>
                <div>
                  <dt className="mono-label">Breach</dt>
                  <dd
                    className={cx(
                      "mt-1 font-mono text-xs",
                      record.breachedTermId ? "text-breach" : "text-fg-dim",
                    )}
                  >
                    {record.breachedTermId ??
                      (record.outcome === "MERCHANT_WINS" ? "none upheld" : "under review")}
                  </dd>
                </div>
                <div>
                  <dt className="mono-label">Settlement</dt>
                  <dd
                    className={cx(
                      "mt-1 font-mono text-xs",
                      record.settlement === "REFUNDED"
                        ? "text-protected"
                        : record.settlement === "RELEASED"
                          ? "text-pass"
                          : "text-fg-dim",
                    )}
                  >
                    {record.settlement ?? "pending"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
              <span className="font-mono text-[10px] tnum tracking-[0.12em] text-fg-faint uppercase">
                Opened {formatDate(record.openedAt)}
              </span>
              <span className="font-mono text-xs tnum text-fg-muted">{formatMoney(record.amount)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
