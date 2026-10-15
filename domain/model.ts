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

/**
 * What a breach entitles the buyer to.
 *
 * `full_refund` is all-or-nothing: the forum decides whether a breach is
 * material, and a material breach returns the whole escrow. `graduated_refund`
 * lets the forum award part of it — a SPLIT ruling with a refund in basis
 * points — when a breach is real but the delivery still carried some of the
 * value. Which one applies is part of the locked agreement, so neither party
 * can change it after payment.
 */
export const REMEDY_POLICIES = ["full_refund", "graduated_refund"] as const;
export type RemedyPolicy = (typeof REMEDY_POLICIES)[number];

export interface RefundPolicy {
  type: "mandatory_term_breach";
  settlement: RemedyPolicy;
  /** Hours after delivery during which the buyer may still open a dispute. */
  recourseWindowHours: number;
}

/**
 * Agreement document versions.
 *
 * `recourse/0.2` documents are created under finality-gated settlement and may
 * opt into graduated remedies. `recourse/0.1` documents stay valid and keep
 * verifying against the hashes they were locked with.
 */
export const AGREEMENT_VERSION = "recourse/0.2" as const;
export type AgreementVersion = "recourse/0.1" | "recourse/0.2";

export interface AgreementDocument {
  version: AgreementVersion;
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

export type EscrowState = "NONE" | "HELD" | "RELEASED" | "REFUNDED" | "SPLIT";

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
  /** What the claimant can be awarded under the locked agreement. */
  claimedRemedy: "FULL_REFUND" | "PROPORTIONAL_REFUND";
  status: DisputeStatus;
  openedBy: AgentRole;
  openedAt: string;
  contestedTermIds: string[];
}

/* ----------------------------------------------------------- adjudication */

/**
 * Where an adjudication stands.
 *
 * DECIDED and FINALIZED are deliberately different words. GenLayer reports a
 * transaction ACCEPTED when its validators reach consensus, but an accepted
 * result can still be appealed and recomputed until the finality window
 * closes. DECIDED is that provisional state; only FINALIZED moves money.
 * APPEALED means an appeal round is in progress against the provisional
 * ruling.
 */
export type AdjudicationStatus =
  | "NOT_REQUIRED"
  | "SUBMITTED"
  | "PENDING"
  | "DECIDED"
  | "APPEALED"
  | "FINALIZED"
  | "FAILED";

export type Decision = "BUYER_WINS" | "MERCHANT_WINS" | "SPLIT";

/** How the forum may remedy a breach, derived from the agreement's policy. */
export type RemedyMode = "ALL_OR_NOTHING" | "GRADUATED";

/** Whole escrow, in basis points. */
export const FULL_REFUND_BPS = 10_000;

export interface Ruling {
  decision: Decision;
  materialBreach: boolean;
  violatedTerms: string[];
  satisfiedTerms: string[];
  recommendedSettlement: "REFUND" | "RELEASE" | "SPLIT";
  /**
   * Share of the escrow owed to the buyer, in basis points: 10000 is a full
   * refund, 0 a full release. Rulings recorded before v0.2 carry no value and
   * are read through `refundBpsOf`, which derives it from the decision.
   */
  refundBps?: number;
  reasoningSummary: string;
  /** "recourse.ruling/2" for v2 contracts; absent on v1 rulings. */
  schema?: string;
  remedyMode?: RemedyMode;
  /** The inputs hash the contract recorded alongside the ruling (v2). */
  inputsHash?: string | null;
  /** The address the contract recorded as having requested the ruling (v2). */
  submitter?: string | null;
}

/** The refund a ruling awards, for rulings from either contract generation. */
export function refundBpsOf(ruling: Pick<Ruling, "decision" | "refundBps">): number {
  if (typeof ruling.refundBps === "number" && Number.isInteger(ruling.refundBps)) {
    return ruling.refundBps;
  }
  return ruling.decision === "BUYER_WINS" ? FULL_REFUND_BPS : 0;
}

/** "BUYER_WINS (full refund)", "SPLIT (60% refund)", "MERCHANT_WINS (release)". */
export function describeAward(ruling: Pick<Ruling, "decision" | "refundBps">): string {
  const bps = refundBpsOf(ruling);
  if (ruling.decision === "SPLIT") return `SPLIT (${bps / 100}% refund)`;
  return ruling.decision === "BUYER_WINS" ? "BUYER_WINS (full refund)" : "MERCHANT_WINS (release)";
}

/** Whether two rulings award the same thing. Prose is never compared. */
export function sameAward(
  a: Pick<Ruling, "decision" | "refundBps">,
  b: Pick<Ruling, "decision" | "refundBps">,
): boolean {
  return a.decision === b.decision && refundBpsOf(a) === refundBpsOf(b);
}

/** Finality of a recorded ruling. Only FINAL rulings are ever settled. */
export type RulingFinality = "PROVISIONAL" | "FINAL";

/**
 * GenLayer's view of a transaction's lifecycle, as last reported.
 *
 * `decisionId` identifies the decision an appeal is bound to;
 * `resolutionAction` of "Finalize" means the finality window has elapsed and
 * anyone may submit finalization.
 */
export interface ConsensusLifecycle {
  storedStatus: string | null;
  projectedStatus: string | null;
  resolutionAction: string | null;
  decisionId: string | null;
  decisionActive: boolean | null;
}

/** What a ruling awarded, captured for an appeal record. */
export interface RulingSnapshot {
  decision: Decision;
  refundBps: number;
  violatedTerms: string[];
}

/**
 * One appeal against a provisional ruling.
 *
 * GenLayer appeals re-evaluate the *same* transaction with a larger validator
 * committee; there is no separate appeal transaction and no new evidence. The
 * record therefore tracks the transaction it challenged, the decision it was
 * bound to, and the network signals the protocol watched to know when the
 * appeal round was over.
 */
export interface AppealRecord {
  id: string;
  requestedBy: AgentRole;
  /** The handle that asked for the appeal. */
  requestedByHandle: string;
  /** The appellant's stated reason. Recorded, not sent on-chain. */
  reason: string;
  filedAt: string;
  transactionHash: string;
  /** Bond plus appeal funding the network quoted, in wei. */
  chargeWei: string | null;
  /** Address that paid the charge. In this release, the protocol's key. */
  paidBy: string | null;
  /** The decision the appeal was bound to, when the network reported one. */
  decisionId: string | null;
  /** Network signals at filing, compared on later polls. */
  roundsAtFiling: number | null;
  failedAppealsAtFiling: number | null;
  /** Set once an appeal round has been seen in progress. */
  observedInFlight: boolean;
  rulingBefore: RulingSnapshot;
  rulingAfter: RulingSnapshot | null;
  /** UPHELD: the award stood. REVISED: the decision or the refund changed. */
  outcome: "PENDING" | "UPHELD" | "REVISED";
  resolvedAt: string | null;
}

/**
 * The fee deposit the protocol quoted and submitted for one adjudication.
 *
 * Consensus v0.6 requires a fee distribution and its quoted value on every
 * write. This is the protocol's own record of what it sent: a *deposit*, which
 * is escrowed up front and largely refunded at finalization — deliberately not
 * presented as a cost, because the two are different numbers.
 */
export interface AdjudicationFeeQuote {
  depositWei: string;
  userValueWei: string;
  totalWei: string;
  /** True when the network's fee accounting is disabled: no deposit was taken. */
  gasless: boolean;
  /** Whether the allocation came from a measured profile or network defaults. */
  source: "developer" | "network-default";
  breakdown: {
    timeUnitFeesWei: string;
    executionBudgetWei: string;
    messageFeesWei: string;
  };
  caps: {
    genPerTimeUnitWei: string;
    storagePriceWei: string;
    receiptPriceWei: string;
  };
  verification: {
    status: "verified" | "mismatch" | "unavailable";
    expectedFeeConfigHash: string | null;
    actualFeeConfigHash: string | null;
  };
  /** The measured profile this quote drew on, or null when none was usable. */
  profileFile: string | null;
  /** Why no profile was used, when one was missing or measured elsewhere. */
  profileNote: string | null;
  /** Pending transactions ahead of this one at quote time, when reported. */
  queuePosition: number | null;
  quotedAt: string;
}

/**
 * What actually happened to the deposit. Reported by the network, never
 * derived: an empty record means the receipt did not carry accounting, not that
 * nothing was consumed.
 */
export interface AdjudicationFeeAccounting {
  /** Which receipt field the numbers came from, so a reviewer can re-read it. */
  source: string;
  depositWei: string | null;
  consumedWei: string | null;
  refundedWei: string | null;
  reportedAt: string | null;
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
  /** Consensus v0.6 fee deposit quoted and submitted for this referral. */
  fees: AdjudicationFeeQuote | null;
  /** Consumption and refund, when a receipt reported them. */
  feeAccounting: AdjudicationFeeAccounting | null;
  /*
   * v0.2 fields. Optional so that records written before them stay readable;
   * the presenter labels such records for what they are.
   */
  /** Remedy mode requested in the payload. */
  remedyMode?: RemedyMode;
  /**
   * Address that signed the adjudicate transaction. v2 contracts store each
   * ruling under its submitter, so this is part of how the ruling is read.
   */
  submitter?: string | null;
  /** Contract generation the ruling is read from (1 or 2), once known. */
  contractVersion?: number | null;
  /** PROVISIONAL until the network finalizes; only FINAL is ever settled. */
  finality?: RulingFinality | null;
  /** When a ruling first became readable, provisional or not. */
  decidedAt?: string | null;
  /** Consensus rounds the receipt reported at the last poll. */
  rounds?: number | null;
  lifecycle?: ConsensusLifecycle | null;
  appeals?: AppealRecord[];
  /** Finalization transaction the protocol submitted, when it had to. */
  finalizationTx?: string | null;
  /** Set when finality of a pre-v0.2 ruling was re-confirmed on-chain. */
  finalityConfirmedAt?: string | null;
}

/* ------------------------------------------------------------- settlement */

export type SettlementOutcome = "RELEASED" | "REFUNDED" | "PARTIAL_REFUND";

/** One movement of money out of escrow. A split settlement has two. */
export interface SettlementLeg {
  party: AgentRole;
  to: string;
  amount: Money;
  execution: "ONCHAIN" | "SIGNATURE_VERIFIED_LOCAL_ESCROW";
  transactionHash: string | null;
}

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
  /** Share of the escrow returned to the buyer, in basis points (v0.2). */
  refundBps?: number;
  /** Every movement out of escrow (v0.2). */
  legs?: SettlementLeg[];
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
  "PROVISIONAL_RULING",
  "APPEALED",
  "BUYER_WON",
  "MERCHANT_WON",
  "SPLIT_AWARDED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
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
  PROVISIONAL_RULING: "JUDGMENT",
  APPEALED: "JUDGMENT",
  BUYER_WON: "JUDGMENT",
  MERCHANT_WON: "JUDGMENT",
  SPLIT_AWARDED: "JUDGMENT",
  REFUNDED: "SETTLEMENT",
  PARTIALLY_REFUNDED: "SETTLEMENT",
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
  "RULING_PROVISIONAL",
  "APPEAL_FILED",
  "APPEAL_RESOLVED",
  "FINALIZATION_SUBMITTED",
  "RULING_FINALIZED",
  "REFUND_EXECUTED",
  "PARTIAL_REFUND_EXECUTED",
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
