import { cx, formatTimestamp } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { Amount } from "@/components/system/Values";
import { SettlementStatusBadge, Tag } from "@/components/system/StateBadge";
import { HashValue } from "@/components/system/HashValue";
import { ProtocolErrorState } from "@/components/system/States";
import type { Agent, Settlement } from "@/lib/types";

/**
 * SettlementReceipt — the terminal artifact of a protected purchase.
 *
 * Reads like a receipt, not a dashboard card: fixed field order, monospaced
 * values, and an explicit outcome band.
 */
export function SettlementReceipt({
  settlement,
  buyer,
  merchant,
  disputeRef,
  className,
}: {
  settlement: Settlement | null;
  buyer: Agent;
  merchant: Agent;
  disputeRef?: string | null;
  className?: string;
}) {
  if (!settlement) {
    return (
      <ProtocolErrorState
        tone="neutral"
        code="NO_SETTLEMENT"
        title="Settlement not reached"
        description="Funds remain escrowed under protection. A settlement receipt is produced when the order is released or refunded."
        className={className}
      />
    );
  }

  if (settlement.status === "UNAVAILABLE") {
    return (
      <ProtocolErrorState
        code="SETTLEMENT_UNAVAILABLE"
        title="Settlement unavailable"
        description="The ruling exists, but settlement confirmation has not been received."
        detail={settlement.unavailableReason}
        className={className}
      />
    );
  }

  const refunded = settlement.outcome === "REFUNDED" || settlement.outcome === "PARTIAL_REFUND";
  const accent = refunded ? "text-protected" : "text-pass";

  return (
    <Panel className={cx("overflow-hidden", className)}>
      <PanelHeader
        title="SETTLEMENT"
        meta={settlement.settledAt ? formatTimestamp(settlement.settledAt, { seconds: true }) : undefined}
        actions={<SettlementStatusBadge status={settlement.status} />}
      />

      <div
        className={cx(
          "flex flex-wrap items-end justify-between gap-6 border-b px-4 py-5 sm:px-6",
          refunded ? "border-protected/25 bg-protected-dim/35" : "border-pass/25 bg-pass-dim/30",
        )}
      >
        <div>
          <p className="mono-label">Outcome</p>
          <p className={cx("mt-2 font-mono text-2xl tracking-[0.06em] uppercase sm:text-3xl", accent)}>
            {settlement.outcome.replace(/_/g, " ")}
          </p>
        </div>
        <div className="text-right">
          <p className="mono-label">Amount</p>
          <div className="mt-2">
            <Amount money={settlement.amount} size="lg" tone={refunded ? "protected" : "pass"} />
          </div>
        </div>
      </div>

      <dl className="divide-y divide-line">
        <ReceiptRow label="Buyer" value={buyer.handle} />
        <ReceiptRow label="Merchant" value={merchant.handle} />
        <ReceiptRow
          label="Direction"
          value={refunded ? `${merchant.handle} → ${buyer.handle}` : `${buyer.handle} → ${merchant.handle}`}
        />
        <ReceiptRow label="Reason" value={settlement.reason} />
        {disputeRef ? <ReceiptRow label="Dispute" value={disputeRef} /> : null}
        <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <dt className="mono-label">Settlement tx</dt>
          <dd>
            <HashValue attested={settlement.transaction} label="settlement transaction" />
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-surface px-4 py-3 sm:px-6">
        <Tag size="xs">{settlement.transaction.value ? "On-chain" : "Escrow ledger"}</Tag>
        <p className="text-xs leading-relaxed text-fg-dim">
          {settlement.transaction.value
            ? "Settlement was broadcast and confirmed on the payment network."
            : "The escrow movement is recorded in the protocol ledger. Broadcasting it on-chain requires a funded facilitator, which this deployment does not have, so no transaction hash is claimed."}
        </p>
      </div>
    </Panel>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
      <dt className="mono-label">{label}</dt>
      <dd className="font-mono text-sm break-all text-fg">{value}</dd>
    </div>
  );
}
