import { cx, formatTimestamp } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { Amount } from "@/components/system/Values";
import { Tag } from "@/components/system/StateBadge";
import { HashValue } from "@/components/system/HashValue";
import type { EscrowState, Payment } from "@/lib/types";

const escrowTone: Record<EscrowState, "neutral" | "protected" | "pass"> = {
  NONE: "neutral",
  HELD: "protected",
  RELEASED: "pass",
  REFUNDED: "protected",
};

/**
 * PaymentPanel — the rail-level record. x402 moves the money; this panel
 * never claims it does anything else.
 */
export function PaymentPanel({
  payment,
  className,
}: {
  payment: Payment;
  className?: string;
}) {
  return (
    <Panel className={className}>
      <PanelHeader
        title="PAYMENT"
        meta={`RAIL · ${payment.rail}`}
        actions={
          <Tag tone={escrowTone[payment.escrow]} size="xs" dot>
            Escrow {payment.escrow.toLowerCase()}
          </Tag>
        }
      />
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-5 sm:px-5">
          <p className="mono-label">Amount</p>
          <div className="mt-2">
            <Amount money={payment.amount} size="lg" />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-fg-dim">
            Held under protection for {payment.recourseWindowHours} hours. Recourse can be opened at
            any point inside that window.
          </p>
        </div>
        <div className="space-y-4 px-4 py-5 sm:px-5">
          <div>
            <p className="mono-label">Initiated</p>
            <p className="mt-1.5 font-mono text-xs tnum text-fg-muted">
              {formatTimestamp(payment.initiatedAt, { seconds: true })}
            </p>
          </div>
          <div>
            <p className="mono-label">Confirmed</p>
            <p
              className={cx(
                "mt-1.5 font-mono text-xs tnum",
                payment.confirmedAt ? "text-fg-muted" : "text-fg-faint",
              )}
            >
              {payment.confirmedAt ? formatTimestamp(payment.confirmedAt, { seconds: true }) : "—"}
            </p>
          </div>
          <div>
            <p className="mono-label">Rail reference</p>
            <div className="mt-1.5">
              <HashValue attested={payment.reference} label="payment reference" lead={12} tail={6} />
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
