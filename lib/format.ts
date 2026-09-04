import type {
  CheckResult,
  LifecyclePhase,
  Money,
  OrderStatus,
  Provenance,
  RulingOutcome,
  SettlementOutcome,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Tone system — semantic colour is derived, never hand-written in JSX */
/* ------------------------------------------------------------------ */

export type Tone = "neutral" | "pass" | "pending" | "breach" | "protected";

export const toneClasses: Record<Tone, { text: string; border: string; bg: string; dot: string }> =
  {
    neutral: {
      text: "text-fg-muted",
      border: "border-line-strong",
      bg: "bg-raised",
      dot: "bg-fg-dim",
    },
    pass: {
      text: "text-pass",
      border: "border-pass/35",
      bg: "bg-pass-dim",
      dot: "bg-pass",
    },
    pending: {
      text: "text-pending",
      border: "border-pending/35",
      bg: "bg-pending-dim",
      dot: "bg-pending",
    },
    breach: {
      text: "text-breach",
      border: "border-breach/35",
      bg: "bg-breach-dim",
      dot: "bg-breach",
    },
    protected: {
      text: "text-protected",
      border: "border-protected/35",
      bg: "bg-protected-dim",
      dot: "bg-protected",
    },
  };

/* ------------------------------------------------------------------ */
/* Order status metadata                                               */
/* ------------------------------------------------------------------ */

interface StatusMeta {
  label: string;
  tone: Tone;
  phase: LifecyclePhase;
  description: string;
}

export const orderStatusMeta: Record<OrderStatus, StatusMeta> = {
  OFFERED: {
    label: "OFFERED",
    tone: "neutral",
    phase: "PROMISE",
    description: "Merchant agent published terms. Nothing is locked yet.",
  },
  ACCEPTED: {
    label: "ACCEPTED",
    tone: "neutral",
    phase: "PROMISE",
    description: "Shopper agent accepted the machine-readable agreement.",
  },
  ESCROWED: {
    label: "ESCROWED",
    tone: "protected",
    phase: "PAYMENT",
    description: "Payment executed and held under protection.",
  },
  DELIVERED: {
    label: "DELIVERED",
    tone: "neutral",
    phase: "PROOF",
    description: "Merchant agent submitted fulfillment and evidence.",
  },
  VERIFICATION_PENDING: {
    label: "VERIFICATION PENDING",
    tone: "pending",
    phase: "PROOF",
    description: "Deterministic conditions are being evaluated against the promise.",
  },
  FULFILLED: {
    label: "FULFILLED",
    tone: "pass",
    phase: "JUDGMENT",
    description: "Every mandatory term of the agreement was satisfied.",
  },
  RELEASED: {
    label: "RELEASED",
    tone: "pass",
    phase: "SETTLEMENT",
    description: "Escrowed funds settled to the merchant agent.",
  },
  DISPUTED: {
    label: "DISPUTED",
    tone: "breach",
    phase: "JUDGMENT",
    description: "A material breach was cited and recourse was opened.",
  },
  ADJUDICATING: {
    label: "ADJUDICATING",
    tone: "pending",
    phase: "JUDGMENT",
    description: "Contested fulfillment referred to GenLayer for semantic judgment.",
  },
  BUYER_WON: {
    label: "BUYER WON",
    tone: "protected",
    phase: "JUDGMENT",
    description: "Ruling finalized in favour of the buyer agent.",
  },
  MERCHANT_WON: {
    label: "MERCHANT WON",
    tone: "pass",
    phase: "JUDGMENT",
    description: "Ruling finalized in favour of the merchant agent.",
  },
  CANCELLED: {
    label: "Cancelled",
    tone: "neutral",
    phase: "SETTLEMENT",
    description: "The protected purchase was cancelled before delivery.",
  },
  REFUNDED: {
    label: "REFUNDED",
    tone: "protected",
    phase: "SETTLEMENT",
    description: "Escrowed funds returned to the buyer agent.",
  },
};

export const checkResultTone: Record<CheckResult, Tone> = {
  PASS: "pass",
  BREACH: "breach",
  INDETERMINATE: "pending",
};

export const rulingOutcomeLabel: Record<RulingOutcome, string> = {
  BUYER_WINS: "BUYER WINS",
  MERCHANT_WINS: "MERCHANT WINS",
  SPLIT: "SPLIT REMEDY",
};

export const settlementOutcomeTone: Record<SettlementOutcome, Tone> = {
  RELEASED: "pass",
  REFUNDED: "protected",
  PARTIAL_REFUND: "pending",
};

export const provenanceLabel: Record<Provenance, string> = {
  LIVE: "LIVE",
  DEMO_FIXTURE: "DEMO FIXTURE",
  SIMULATED: "SIMULATED",
  NOT_AVAILABLE: "NOT YET AVAILABLE",
};

export const provenanceTone: Record<Provenance, Tone> = {
  LIVE: "pass",
  DEMO_FIXTURE: "neutral",
  SIMULATED: "pending",
  NOT_AVAILABLE: "neutral",
};

/* ------------------------------------------------------------------ */
/* Value formatting — deterministic, hydration-safe (no locale APIs)   */
/* ------------------------------------------------------------------ */

export function formatMoney(money: Money): string {
  const symbol = money.currency === "USDC" ? "$" : "";
  return `${symbol}${money.amount} ${money.currency}`;
}

/** "2026-09-04T08:41:00Z" -> "2026-09-04 08:41 UTC" */
export function formatTimestamp(iso: string, opts?: { seconds?: boolean }): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, y, m, d, hh, mm, ss] = match;
  const time = opts?.seconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
  return `${y}-${m}-${d} ${time} UTC`;
}

/** "2026-09-04T08:41:00Z" -> "08:41:02" */
export function formatClock(iso: string): string {
  const match = /T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  return match ? `${match[1]}:${match[2]}:${match[3]}` : iso;
}

/** "2026-09-04T08:41:00Z" -> "2026-09-04" */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function truncateHash(hash: string, lead = 6, tail = 4): string {
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
