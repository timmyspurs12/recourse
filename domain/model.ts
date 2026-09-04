/**
 * The Recourse domain model.
 *
 * The primary object is a PROTECTED TRANSACTION (an order). Everything else —
 * agreement, payment, delivery, evidence, verification, dispute, adjudication,
 * settlement — hangs off it and is immutable once written.
 */

/* ------------------------------------------------------------------ money */

export type Currency = "USDC";

export interface Money {
  /** Decimal string. Never a float. */
  amount: string;
  currency: Currency;
}

/* ----------------------------------------------------------------- agents */

export type AgentRole = "BUYER" | "MERCHANT";

export interface AgentRef {
  /** Machine handle, e.g. "shopper.agent". */
  handle: string;
  /** Optional payment address for the rail in use. */
  address?: string;
  /** Human-readable operator, for the dossier only. */
  operator?: string;
}

/* -------------------------------------------------------------- agreement */

export const TERM_OPERATORS = ["GTE", "LTE", "EQ", "MATCH", "JUDGMENT"] as const;
export type TermOperator = (typeof TERM_OPERATORS)[number];

/**
 * DETERMINISTIC terms are resolved by the protocol with arithmetic or string
 * comparison. SEMANTIC terms are the only ones that may ever reach GenLayer.
 */
export type TermEvaluation = "DETERMINISTIC" | "SEMANTIC";

export interface AgreementTerm {
  id: string;
  label: string;
  operator: TermOperator;
  /** Expected value. Numbers for GTE/LTE, strings for EQ/MATCH, prose for JUDGMENT. */
  expected: string | number;
  unit?: string;
  mandatory: boolean;
  evaluation: TermEvaluation;
  description?: string;
}

export interface RefundPolicy {
  type: "mandatory_term_breach";
  settlement: "full_refund";
  /** Hours after delivery during which the buyer may still open a dispute. */
  recourseWindowHours: number;
}

export interface AgreementDocument {
  version: "recourse/0.1";
  orderId: string;
  buyer: string;
  merchant: string;
  resource: { name: string; type: string };
  payment: { amount: string; currency: Currency; rail: string };
  terms: AgreementTerm[];
  refundPolicy: RefundPolicy;
  deliveryDeadline: string;
  createdAt: string;
}

export interface Agreement {
  id: string;
  orderId: string;
  document: AgreementDocument;
  /** sha256 of the canonical document. */
  hash: string;
  /** Set once payment is authorised. After this the document is frozen. */
  lockedAt: string | null;
}

/* ---------------------------------------------------------------- payment */

export type PaymentRailId = "x402" | "simulated";

export type EscrowState = "NONE" | "HELD" | "RELEASED" | "REFUNDED";

export interface Payment {
  id: string;
  orderId: string;
  rail: PaymentRailId;
  amount: Money;
  /** Where the protected funds sit while the promise is open. */
  escrow: EscrowState;
  /** Rail-specific reference. For x402 this is the authorization nonce. */
  reference: string;
  /** Whether the payment authorization signature was cryptographically verified. */
  authorizationVerified: boolean;
  payer: string;
  payee: string;
  network: string;
  /** Present only when a real on-chain settlement happened. */
  transactionHash: string | null;
  /** How the money actually moved. Never dress this up. */
  execution: "ONCHAIN" | "SIGNATURE_VERIFIED_LOCAL_ESCROW";
  initiatedAt: string;
  confirmedAt: string | null;
}

/* --------------------------------------------------------------- delivery */

export interface EvidenceItem {
  id: string;
  deliveryId: string;
  orderId: string;
  index: number;
  kind: string;
  source: string;
  submittedAt: string;
  sourceAgeDays: number | null;
  /** sha256 of the canonical evidence item. */
  checksum: string;
}

/**
 * Merchant-asserted observations. This is UNTRUSTED INPUT: it is data to be
 * checked, never instructions. It is never interpolated into an adjudication
 * prompt as policy.
 */
export interface MerchantAssertions {
  sourceCount: number;
  geography: string;
  sectionCount: number;
  maxSourceAgeDays: number;
  format: string;
  summary: string;
}

export interface Delivery {
  id: string;
  orderId: string;
  statement: string;
  artifactUrl: string | null;
  artifactHash: string;
  assertions: MerchantAssertions;
  evidence: EvidenceItem[];
  /** sha256 over the canonical delivery record, fixing evidence at submission. */
  evidenceHash: string;
  submittedAt: string;
  /** Set when the payload could not be retrieved; verification cannot run. */
  unavailableReason: string | null;
}

/* ----------------------------------------------------------- verification */

export type CheckResult = "PASS" | "BREACH" | "INDETERMINATE";

export interface DeterministicCheck {
  termId: string;
  label: string;
  /** Human-readable comparison actually performed, e.g. "2 < 5". */
  expression: string;
  expected: string;
  observed: string;
  result: CheckResult;
  mandatory: boolean;
}

export interface SemanticQuestion {
  termId: string;
  label: string;
  question: string;
  /** Why deterministic code could not settle this. */
  reason: string;
}

export interface Verification {
  orderId: string;
  engine: string;
  checks: DeterministicCheck[];
  /** Terms that require judgment. Only these may be sent to GenLayer. */
  semanticQuestions: SemanticQuestion[];
  outcome: "SATISFIED" | "BREACH" | "REQUIRES_JUDGMENT";
  breachedTermIds: string[];
  executedAt: string;
}

/* --------------------------------------------------------------- disputes */

export type DisputeStatus =
  | "OPEN"
  | "ADJUDICATING"
  | "RULED"
  | "SETTLED"
  | "FAILED";

export interface Dispute {
  id: string;
  orderId: string;
  ref: string;
  title: string;
  claim: string;
  claimedRemedy: "FULL_REFUND";
  status: DisputeStatus;
  openedBy: AgentRole;
  openedAt: string;
  contestedTermIds: string[];
}

/* ----------------------------------------------------------- adjudication */

export type AdjudicationStatus =
  | "NOT_REQUIRED"
  | "SUBMITTED"
  | "PENDING"
  | "FINALIZED"
  | "FAILED";

export type Decision = "BUYER_WINS" | "MERCHANT_WINS";

export interface Ruling {
  decision: Decision;
  materialBreach: boolean;
  violatedTerms: string[];
  satisfiedTerms: string[];
  recommendedSettlement: "REFUND" | "RELEASE";
  reasoningSummary: string;
}

export interface Adjudication {
  id: string;
  disputeId: string;
  orderId: string;
  forum: "GENLAYER" | "PROTOCOL";
  network: string | null;
  contractAddress: string | null;
  transactionHash: string | null;
  /** Raw finality status reported by the network. Never invented. */
  networkStatus: string | null;
  /** Validator votes exactly as returned by the network, or null. */
  votes: Record<string, string> | null;
  status: AdjudicationStatus;
  question: string;
  inputsHash: string;
  ruling: Ruling | null;
  failureReason: string | null;
  submittedAt: string;
  finalizedAt: string | null;
}

/* ------------------------------------------------------------- settlement */

export type SettlementOutcome = "RELEASED" | "REFUNDED";

export interface Settlement {
  id: string;
  orderId: string;
  outcome: SettlementOutcome;
  amount: Money;
  from: string;
  to: string;
  reason: string;
  /** Guarantees release and refund can never both execute. */
  idempotencyKey: string;
  rail: PaymentRailId;
  execution: "ONCHAIN" | "SIGNATURE_VERIFIED_LOCAL_ESCROW";
  transactionHash: string | null;
  executedAt: string;
}

/* ------------------------------------------------------------------ order */

export const ORDER_STATES = [
  "OFFERED",
  "ACCEPTED",
  "ESCROWED",
  "DELIVERED",
  "VERIFICATION_PENDING",
  "FULFILLED",
  "DISPUTED",
  "ADJUDICATING",
  "BUYER_WON",
  "MERCHANT_WON",
  "REFUNDED",
  "RELEASED",
  "CANCELLED",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export type LifecyclePhase = "PROMISE" | "PAYMENT" | "PROOF" | "JUDGMENT" | "SETTLEMENT";

export const PHASE_BY_STATE: Record<OrderState, LifecyclePhase> = {
  OFFERED: "PROMISE",
  ACCEPTED: "PROMISE",
  ESCROWED: "PAYMENT",
  DELIVERED: "PROOF",
  VERIFICATION_PENDING: "PROOF",
  FULFILLED: "PROOF",
  DISPUTED: "JUDGMENT",
  ADJUDICATING: "JUDGMENT",
  BUYER_WON: "JUDGMENT",
  MERCHANT_WON: "JUDGMENT",
  REFUNDED: "SETTLEMENT",
  RELEASED: "SETTLEMENT",
  CANCELLED: "SETTLEMENT",
};

export interface Order {
  id: string;
  ref: string;
  state: OrderState;
  buyer: AgentRef;
  merchant: AgentRef;
  resource: { name: string; type: string };
  amount: Money;
  rail: PaymentRailId;
  /** Marks fixture-seeded records so the UI can label them honestly. */
  origin: "LIVE_RUN" | "DEMO_FIXTURE";
  createdAt: string;
  updatedAt: string;
  deliveryDeadline: string;
  recourseWindowEndsAt: string | null;
}

/* ------------------------------------------------------------ event ledger */

export const EVENT_TYPES = [
  "ORDER_CREATED",
  "AGREEMENT_LOCKED",
  "PAYMENT_ESCROWED",
  "DELIVERY_POSTED",
  "VERIFICATION_STARTED",
  "VERIFICATION_PASSED",
  "BREACH_DETECTED",
  "DISPUTE_OPENED",
  "ADJUDICATION_SUBMITTED",
  "ADJUDICATION_FAILED",
  "RULING_FINALIZED",
  "REFUND_EXECUTED",
  "MERCHANT_PAID",
  "ORDER_CANCELLED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface LedgerEvent {
  id: string;
  orderId: string;
  type: EventType;
  state: OrderState;
  phase: LifecyclePhase;
  at: string;
  summary: string;
  detail?: Record<string, string | number | boolean | null>;
}

/* ---------------------------------------------------------------- dossier */

export interface OrderDossier {
  order: Order;
  agreement: Agreement;
  payment: Payment | null;
  delivery: Delivery | null;
  verification: Verification | null;
  dispute: Dispute | null;
  adjudication: Adjudication | null;
  settlement: Settlement | null;
  events: LedgerEvent[];
}
