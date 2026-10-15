/**
 * Wire types for the Recourse HTTP API.
 *
 * These mirror the protocol's domain objects exactly. They are intentionally
 * transport types: no classes, no getters, nothing that fails to survive JSON.
 */

export type OrderState =
  | "OFFERED"
  | "ACCEPTED"
  | "ESCROWED"
  | "DELIVERED"
  | "VERIFICATION_PENDING"
  | "FULFILLED"
  | "DISPUTED"
  | "ADJUDICATING"
  /** v0.2: ruled, but appealable until GenLayer finalizes the ruling. */
  | "PROVISIONAL_RULING"
  /** v0.2: an appeal round is re-running consensus. */
  | "APPEALED"
  | "BUYER_WON"
  | "MERCHANT_WON"
  /** v0.2: final ruling with a partial refund (graduated agreements). */
  | "SPLIT_AWARDED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "RELEASED"
  | "CANCELLED";

export type TermOperator = "GTE" | "LTE" | "EQ" | "MATCH" | "JUDGMENT";
export type TermEvaluation = "DETERMINISTIC" | "SEMANTIC";

export interface AgreementTerm {
  id: string;
  label: string;
  operator: TermOperator;
  expected: string | number;
  unit?: string;
  mandatory: boolean;
  evaluation: TermEvaluation;
  description?: string;
}

export interface Money {
  amount: string;
  currency: "USDC";
}

export interface AgentRef {
  handle: string;
  operator?: string;
  address?: string;
}

export interface Agreement {
  id: string;
  orderId: string;
  hash: string;
  lockedAt: string | null;
  document: {
    version: "recourse/0.1" | "recourse/0.2";
    terms: AgreementTerm[];
    refundPolicy: {
      recourseWindowHours: number;
      settlement: "full_refund" | "graduated_refund";
    };
    [key: string]: unknown;
  };
}

export interface Order {
  id: string;
  ref: string;
  state: OrderState;
  buyer: AgentRef;
  merchant: AgentRef;
  resource: { name: string; type: string };
  amount: Money;
  rail: string;
  createdAt: string;
  updatedAt: string;
  recourseWindowEndsAt: string | null;
}

export interface DeterministicCheck {
  termId: string;
  label: string;
  expression: string;
  expected: string;
  observed: string;
  result: "PASS" | "BREACH" | "INDETERMINATE";
  mandatory: boolean;
}

export interface Verification {
  orderId: string;
  engine: string;
  checks: DeterministicCheck[];
  outcome: "SATISFIED" | "BREACH" | "REQUIRES_JUDGMENT";
  breachedTermIds: string[];
  executedAt: string;
}

export interface Ruling {
  decision: "BUYER_WINS" | "MERCHANT_WINS" | "SPLIT";
  materialBreach: boolean;
  violatedTerms: string[];
  satisfiedTerms: string[];
  recommendedSettlement: "REFUND" | "RELEASE" | "SPLIT";
  /**
   * Share of the escrow owed to the buyer, in basis points (10000 = full
   * refund). Absent on rulings recorded before v0.2; derive it from the
   * decision in that case.
   */
  refundBps?: number;
  reasoningSummary: string;
}

export interface AppealRecord {
  id: string;
  requestedBy: "BUYER" | "MERCHANT";
  requestedByHandle: string;
  reason: string;
  filedAt: string;
  transactionHash: string;
  /** Bond plus appeal funding the network quoted, in wei. */
  chargeWei: string | null;
  paidBy: string | null;
  decisionId: string | null;
  outcome: "PENDING" | "UPHELD" | "REVISED";
  rulingBefore: { decision: Ruling["decision"]; refundBps: number; violatedTerms: string[] };
  rulingAfter: { decision: Ruling["decision"]; refundBps: number; violatedTerms: string[] } | null;
  resolvedAt: string | null;
}

export interface Adjudication {
  id: string;
  disputeId: string;
  orderId: string;
  forum: "GENLAYER" | "PROTOCOL";
  network: string | null;
  contractAddress: string | null;
  transactionHash: string | null;
  networkStatus: string | null;
  votes: Record<string, string> | null;
  /**
   * DECIDED: a provisional ruling (GenLayer ACCEPTED it; still appealable).
   * APPEALED: an appeal round is in progress. FINALIZED: final, settleable.
   */
  status: "NOT_REQUIRED" | "SUBMITTED" | "PENDING" | "DECIDED" | "APPEALED" | "FINALIZED" | "FAILED";
  ruling: Ruling | null;
  failureReason: string | null;
  submittedAt: string;
  finalizedAt: string | null;
  /** v0.2 fields; absent on records written before them. */
  finality?: "PROVISIONAL" | "FINAL" | null;
  remedyMode?: "ALL_OR_NOTHING" | "GRADUATED";
  submitter?: string | null;
  contractVersion?: number | null;
  appeals?: AppealRecord[];
}

export interface Dispute {
  id: string;
  orderId: string;
  status: "OPEN" | "ADJUDICATING" | "RULED" | "SETTLED" | "FAILED";
  claim: string;
  contestedTermIds: string[];
  openedAt: string;
}

export interface SettlementLeg {
  party: "BUYER" | "MERCHANT";
  to: string;
  amount: Money;
  execution: "ONCHAIN" | "SIGNATURE_VERIFIED_LOCAL_ESCROW";
  transactionHash: string | null;
}

export interface Settlement {
  id: string;
  orderId: string;
  outcome: "RELEASED" | "REFUNDED" | "PARTIAL_REFUND";
  /** Share of the escrow returned to the buyer, in basis points (v0.2). */
  refundBps?: number;
  /** Every movement out of escrow; a partial refund has two (v0.2). */
  legs?: SettlementLeg[];
  amount: Money;
  to: string;
  reason: string;
  execution: "ONCHAIN" | "SIGNATURE_VERIFIED_LOCAL_ESCROW";
  transactionHash: string | null;
  executedAt: string;
}

export interface LedgerEvent {
  id: string;
  orderId: string;
  type: string;
  state: OrderState;
  at: string;
  summary: string;
}

export interface Dossier {
  order: Order;
  agreement: Agreement;
  payment: {
    escrow: "NONE" | "HELD" | "RELEASED" | "REFUNDED" | "SPLIT";
    reference: string;
    authorizationVerified: boolean;
    execution: string;
  } | null;
  delivery: { id: string; evidenceHash: string; submittedAt: string } | null;
  verification: Verification | null;
  dispute: Dispute | null;
  adjudication: Adjudication | null;
  settlement: Settlement | null;
  events: LedgerEvent[];
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource: { url: string; description: string; mimeType: string };
  extra?: Record<string, string>;
}

export class RecourseError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(code: string, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "RecourseError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}
