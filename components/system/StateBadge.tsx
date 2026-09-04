import type { ReactNode } from "react";
import {
  checkResultTone,
  cx,
  orderStatusMeta,
  rulingOutcomeLabel,
  toneClasses,
  type Tone,
} from "@/lib/format";
import type {
  AdjudicationStatus,
  CheckResult,
  DisputeStatus,
  EvidenceStatus,
  OrderStatus,
  RulingOutcome,
  SettlementStatus,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Tag — the shared chip primitive                                     */
/* ------------------------------------------------------------------ */

export function Tag({
  children,
  tone = "neutral",
  dot = false,
  size = "sm",
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  size?: "xs" | "sm";
  className?: string;
  title?: string;
}) {
  const t = toneClasses[tone];
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 border font-mono uppercase tracking-[0.14em] whitespace-nowrap",
        size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]",
        t.text,
        t.border,
        t.bg,
        className,
      )}
    >
      {dot ? <span className={cx("size-1.5 shrink-0 rounded-full", t.dot)} aria-hidden /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* StateBadge — order lifecycle state                                  */
/* ------------------------------------------------------------------ */

export function StateBadge({
  status,
  size = "sm",
  dot = true,
  className,
}: {
  status: OrderStatus;
  size?: "xs" | "sm";
  dot?: boolean;
  className?: string;
}) {
  const meta = orderStatusMeta[status];
  return (
    <Tag tone={meta.tone} dot={dot} size={size} className={className} title={meta.description}>
      {meta.label}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* ResultBadge — PASS / BREACH / INDETERMINATE                         */
/* ------------------------------------------------------------------ */

export function ResultBadge({
  result,
  size = "sm",
  className,
}: {
  result: CheckResult;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <Tag tone={checkResultTone[result]} size={size} className={className}>
      {result === "INDETERMINATE" ? "UNDECIDED" : result}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Domain-specific badges                                              */
/* ------------------------------------------------------------------ */

const disputeStatusTone: Record<DisputeStatus, Tone> = {
  OPEN: "breach",
  EVIDENCE_REVIEW: "pending",
  ADJUDICATING: "pending",
  RULED: "protected",
  SETTLED: "protected",
  WITHDRAWN: "neutral",
};

export function DisputeStatusBadge({ status }: { status: DisputeStatus }) {
  return (
    <Tag tone={disputeStatusTone[status]} dot>
      {status.replace(/_/g, " ")}
    </Tag>
  );
}

const adjudicationStatusTone: Record<AdjudicationStatus, Tone> = {
  NOT_SUBMITTED: "neutral",
  QUEUED: "pending",
  IN_PROGRESS: "pending",
  FINALIZED: "protected",
  UNAVAILABLE: "neutral",
};

export function AdjudicationStatusBadge({ status }: { status: AdjudicationStatus }) {
  return (
    <Tag tone={adjudicationStatusTone[status]} dot>
      {status === "FINALIZED" ? "RULING FINALIZED" : status.replace(/_/g, " ")}
    </Tag>
  );
}

const evidenceStatusTone: Record<EvidenceStatus, Tone> = {
  VERIFIED: "pass",
  UNVERIFIED: "pending",
  REJECTED: "breach",
};

export function EvidenceStatusBadge({ status }: { status: EvidenceStatus }) {
  return (
    <Tag tone={evidenceStatusTone[status]} size="xs">
      {status}
    </Tag>
  );
}

export function RulingBadge({ outcome }: { outcome: RulingOutcome }) {
  return (
    <Tag tone={outcome === "BUYER_WINS" ? "protected" : outcome === "MERCHANT_WINS" ? "pass" : "pending"} dot>
      {rulingOutcomeLabel[outcome]}
    </Tag>
  );
}

const settlementStatusTone: Record<SettlementStatus, Tone> = {
  PENDING: "pending",
  CONFIRMED: "pass",
  UNAVAILABLE: "breach",
};

export function SettlementStatusBadge({ status }: { status: SettlementStatus }) {
  return (
    <Tag tone={settlementStatusTone[status]} size="xs">
      {status}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Protection chip — used on the hero object and order rows            */
/* ------------------------------------------------------------------ */

export function ProtectedChip({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 border border-protected/35 bg-protected-dim px-2.5 py-1.5",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-protected" aria-hidden />
      <span className="font-mono text-[10px] leading-none tracking-[0.16em] text-protected uppercase">
        Recourse protected
      </span>
    </span>
  );
}
