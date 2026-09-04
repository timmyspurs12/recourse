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
  | "BUYER_WON"
  | "MERCHANT_WON"
  | "REFUNDED"
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
    version: "recourse/0.1";
    terms: AgreementTerm[];
    refundPolicy: { recourseWindowHours: number };
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
  decision: "BUYER_WINS" | "MERCHANT_WINS";
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
  networkStatus: string | null;
  votes: Record<string, string> | null;
  status: "NOT_REQUIRED" | "SUBMITTED" | "PENDING" | "FINALIZED" | "FAILED";
  ruling: Ruling | null;
  failureReason: string | null;
  submittedAt: string;
  finalizedAt: string | null;
}

export interface Dispute {
  id: string;
  orderId: string;
  status: "OPEN" | "ADJUDICATING" | "RULED" | "SETTLED" | "FAILED";
  claim: string;
  contestedTermIds: string[];
  openedAt: string;
}

export interface Settlement {
  id: string;
  orderId: string;
  outcome: "RELEASED" | "REFUNDED";
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
    escrow: "NONE" | "HELD" | "RELEASED" | "REFUNDED";
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
