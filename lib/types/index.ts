/**
 * Recourse — core domain model.
 *
 * These types describe what the frontend needs. They are deliberately written
 * as a *requirement* for a future backend, not as a mirror of an existing one.
 * See `docs/API_CONTRACT.md`.
 */

import type { ErrorCode } from "@/domain/shared/errors";

/* ------------------------------------------------------------------ */
/* Provenance — the frontend never blurs real data with demo data.     */
/* ------------------------------------------------------------------ */

export const PROVENANCE = ["LIVE", "DEMO_FIXTURE", "SIMULATED", "NOT_AVAILABLE"] as const;
export type Provenance = (typeof PROVENANCE)[number];

/** A value that may or may not exist yet, always carrying its origin. */
export interface Attested<T> {
  value: T | null;
  provenance: Provenance;
  /** Human-readable explanation shown when `value` is null. */
  note?: string;
}

export type NetworkMode = "LIVE" | "DEMO" | "SIMULATED";

export interface NetworkStatus {
  mode: NetworkMode;
  /** e.g. "GENLAYER TESTNET" */
  label: string;
  chain: string;
  adapter: string;
  /** Null until a real node connection exists. */
  blockHeight: Attested<number>;
}

/* ------------------------------------------------------------------ */
/* Money + agents                                                      */
/* ------------------------------------------------------------------ */

export type Currency = "USDC";

export interface Money {
  /** Decimal string, never a float. */
  amount: string;
  currency: Currency;
}

export type AgentRole = "SHOPPER" | "MERCHANT" | "PROTOCOL";

export interface Agent {
  id: string;
  /** Machine handle, e.g. "shopper.agent" */
  handle: string;
  /** Human label, e.g. "Shopper Agent" */
  label: string;
  role: AgentRole;
  /** Operator or org behind the agent, when disclosed. */
  operator?: string;
  address: Attested<string>;
}

/* ------------------------------------------------------------------ */
/* Order lifecycle                                                     */
/* ------------------------------------------------------------------ */

export const ORDER_STATUSES = [
  "OFFERED",
  "ACCEPTED",
  "ESCROWED",
  "DELIVERED",
  "VERIFICATION_PENDING",
  "FULFILLED",
  "RELEASED",
  "DISPUTED",
  "ADJUDICATING",
  "BUYER_WON",
  "MERCHANT_WON",
  "REFUNDED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type LifecyclePhase =
  | "PROMISE"
  | "PAYMENT"
  | "PROOF"
  | "JUDGMENT"
  | "SETTLEMENT";

/* ------------------------------------------------------------------ */
/* Agreement — the machine-readable promise                            */
/* ------------------------------------------------------------------ */

export type TermEvaluation = "DETERMINISTIC" | "SEMANTIC";

export type TermOperator = "GTE" | "LTE" | "EQ" | "MATCH" | "JUDGMENT";

export type Remedy = "FULL_REFUND" | "PARTIAL_REFUND" | "NONE";

export interface AgreementTerm {
  /** Machine key, e.g. "minimum_sources". */
  id: string;
  label: string;
  operator: TermOperator;
  /** Rendered promise, e.g. "≥ 5" or "Lagos, Nigeria". */
  promise: string;
  /** Raw comparable value used by verification. */
  promiseValue: string | number;
  unit?: string;
  mandatory: boolean;
  evaluation: TermEvaluation;
  description?: string;
}

export type AgreementStatus = "DRAFT" | "OFFERED" | "LOCKED" | "VOID";

export interface Agreement {
  id: string;
  orderId: string;
  version: string;
  title: string;
  status: AgreementStatus;
  terms: AgreementTerm[];
  breachRemedy: Remedy;
  refundOnMaterialBreach: boolean;
  /** The exact machine-readable document the agents exchanged. */
  document: Record<string, unknown>;
  createdAt: string;
  lockedAt: string | null;
  /** Content hash of the locked document. */
  hash: Attested<string>;
}

/* ------------------------------------------------------------------ */
/* Payment                                                             */
/* ------------------------------------------------------------------ */

export type PaymentRail = "x402";

export type EscrowState = "NONE" | "HELD" | "RELEASED" | "REFUNDED";

export interface Payment {
  id: string;
  orderId: string;
  rail: PaymentRail;
  amount: Money;
  payerId: string;
  payeeId: string;
  escrow: EscrowState;
  /** Protection window during which recourse can be opened. */
  recourseWindowHours: number;
  initiatedAt: string;
  confirmedAt: string | null;
  reference: Attested<string>;
}

/* ------------------------------------------------------------------ */
/* Delivery + evidence                                                 */
/* ------------------------------------------------------------------ */

export type EvidenceStatus = "VERIFIED" | "UNVERIFIED" | "REJECTED";

export type EvidenceKind = "SOURCE" | "DOCUMENT" | "ATTESTATION";

export interface Evidence {
  id: string;
  index: number;
  kind: EvidenceKind;
  /** Domain or origin of the evidence item. */
  source: string;
  title?: string;
  submittedAt: string;
  /** Age of the underlying source material, in days. */
  sourceAgeDays: number | null;
  status: EvidenceStatus;
  checksum: Attested<string>;
  note?: string;
}

export interface DeliveryArtifact {
  title: string;
  format: string;
  sections: number;
  sizeBytes: number | null;
  /** Content hash of the delivered artifact. */
  hash?: string;
}

export interface Delivery {
  id: string;
  orderId: string;
  merchantId: string;
  submittedAt: string;
  statement: string;
  artifact: DeliveryArtifact;
  evidence: Evidence[];
  /** Set when the evidence payload exists but cannot be retrieved. */
  evidenceUnavailableReason?: string;
}

/* ------------------------------------------------------------------ */
/* Verification — deterministic first, semantic only if needed         */
/* ------------------------------------------------------------------ */

export type CheckResult = "PASS" | "BREACH" | "INDETERMINATE";

export type BreachSeverity = "MATERIAL" | "MINOR";

export interface DeterministicCheck {
  termId: string;
  label: string;
  /** Rendered comparison, e.g. "2 < 5". */
  expression: string;
  promise: string;
  observed: string;
  result: CheckResult;
  severity: BreachSeverity | null;
}

export type SemanticReviewStatus =
  | "NOT_REQUIRED"
  | "ADJUDICATION_REQUIRED"
  | "IN_ADJUDICATION"
  | "COMPLETE";

export interface Verification {
  id: string;
  orderId: string;
  executedAt: string;
  engine: string;
  checks: DeterministicCheck[];
  outcome: CheckResult;
  semanticReview: {
    status: SemanticReviewStatus;
    question: string | null;
    rationale: string | null;
  };
}

/* ------------------------------------------------------------------ */
/* Dispute → adjudication → ruling → settlement                        */
/* ------------------------------------------------------------------ */

export type DisputeStatus =
  | "OPEN"
  | "EVIDENCE_REVIEW"
  | "ADJUDICATING"
  | "RULED"
  | "SETTLED"
  | "WITHDRAWN";

export type AdjudicationStatus =
  | "NOT_SUBMITTED"
  | "QUEUED"
  | "IN_PROGRESS"
  | "FINALIZED"
  | "UNAVAILABLE";

export interface AdjudicationInput {
  label: string;
  value: string;
}

export interface Adjudication {
  id: string;
  disputeId: string;
  forum: "GENLAYER";
  network: string;
  question: string;
  inputs: AdjudicationInput[];
  status: AdjudicationStatus;
  submittedAt: string | null;
  finalizedAt: string | null;
  /** Contract that received the adjudication request. */
  contract: Attested<string>;
  transaction: Attested<string>;
  /** Validator/consensus detail is only shown when a node actually reports it. */
  consensus: Attested<{
    validators: number;
    agreement: string;
    rounds: number | null;
  }>;
  /**
   * Raw per-validator votes exactly as the network returned them. Never
   * synthesised: absent unless a node reported them.
   */
  votes: Attested<Array<{ validator: string; vote: string }>>;
}

export type RulingOutcome = "BUYER_WINS" | "MERCHANT_WINS" | "SPLIT";

export interface BreachedTerm {
  termId: string;
  label: string;
  promised: string;
  observed: string;
  severity: BreachSeverity;
}

export interface Ruling {
  id: string;
  disputeId: string;
  outcome: RulingOutcome;
  breachedTerms: BreachedTerm[];
  rationale: string[];
  remedy: Remedy;
  finalizedAt: string;
  provenance: Provenance;
}

export type SettlementOutcome = "RELEASED" | "REFUNDED" | "PARTIAL_REFUND";

export type SettlementStatus = "PENDING" | "CONFIRMED" | "UNAVAILABLE";

export interface Settlement {
  id: string;
  orderId: string;
  disputeId: string | null;
  outcome: SettlementOutcome;
  status: SettlementStatus;
  amount: Money;
  buyerId: string;
  merchantId: string;
  reason: string;
  settledAt: string | null;
  transaction: Attested<string>;
  /** Set when a ruling exists but settlement confirmation has not arrived. */
  unavailableReason?: string;
}

export interface Dispute {
  id: string;
  /** Protocol case reference, e.g. "RC / 000042". */
  ref: string;
  orderId: string;
  title: string;
  openedById: string;
  openedAt: string;
  status: DisputeStatus;
  claim: string;
  claimedRemedy: Remedy;
  adjudication: Adjudication | null;
  ruling: Ruling | null;
}

/* ------------------------------------------------------------------ */
/* Event stream                                                        */
/* ------------------------------------------------------------------ */

export type EventActor = "BUYER" | "MERCHANT" | "PROTOCOL" | "GENLAYER";

export interface TransactionEvent {
  id: string;
  orderId: string;
  at: string;
  state: OrderStatus;
  phase: LifecyclePhase;
  label: string;
  actor: EventActor;
  detail?: string;
  provenance: Provenance;
}

/* ------------------------------------------------------------------ */
/* Order aggregate                                                     */
/* ------------------------------------------------------------------ */

export interface Order {
  id: string;
  /** Display reference, e.g. "RC / 000042". */
  ref: string;
  /** Zero-padded sequence, e.g. "000042". */
  sequence: string;
  title: string;
  description: string;
  buyer: Agent;
  merchant: Agent;
  amount: Money;
  status: OrderStatus;
  protected: boolean;
  createdAt: string;
  updatedAt: string;
  provenance: Provenance;
}

/** Everything needed to render an order detail or dispute dossier. */
export interface OrderDossier {
  order: Order;
  agreement: Agreement;
  payment: Payment;
  delivery: Delivery | null;
  verification: Verification | null;
  dispute: Dispute | null;
  settlement: Settlement | null;
  events: TransactionEvent[];
}

/** Ledger row for /cases. */
export interface CaseRecord {
  ref: string;
  disputeId: string;
  orderId: string;
  /** The dispute's actual stage. "No ruling yet" is not the same as "adjudicating". */
  status: DisputeStatus;
  title: string;
  buyerHandle: string;
  merchantHandle: string;
  breachedTermId: string | null;
  outcome: RulingOutcome | null;
  settlement: SettlementOutcome | null;
  openedAt: string;
  amount: Money;
  provenance: Provenance;
}

/* ------------------------------------------------------------------ */
/* Promise vs Proof — the core visual comparison                       */
/* ------------------------------------------------------------------ */

export interface PromiseProofRow {
  termId: string;
  label: string;
  promise: string;
  proof: string;
  result: CheckResult;
  mandatory: boolean;
  evaluation: TermEvaluation;
}

/* ------------------------------------------------------------------ */
/* Write operations (frontend request shapes)                          */
/* ------------------------------------------------------------------ */

export interface CreatePurchaseInput {
  merchantHandle: string;
  amount: string;
  currency: Currency;
  title: string;
  agreement: {
    minimumSources: number;
    maxSourceAgeDays: number;
    requiredSections: number;
    geography: string;
    refundOnMaterialBreach: boolean;
  };
}

export interface SubmitDeliveryInput {
  orderId: string;
  statement: string;
  artifact: DeliveryArtifact;
  evidence: Array<Omit<Evidence, "id" | "index" | "checksum">>;
}

export interface OpenDisputeInput {
  orderId: string;
  claim: string;
  claimedRemedy: Remedy;
  citedTermIds: string[];
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Error codes are owned by the domain, so the UI cannot invent one the
 * protocol never raises — or miss one it does.
 */
export type RecourseErrorCode = ErrorCode | "ADAPTER_NOT_IMPLEMENTED";

export class RecourseError extends Error {
  readonly code: RecourseErrorCode;
  readonly detail: string;

  constructor(code: RecourseErrorCode, message: string, detail: string) {
    super(message);
    this.name = "RecourseError";
    this.code = code;
    this.detail = detail;
  }
}
