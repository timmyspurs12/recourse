import type {
  Adjudication,
  Agreement,
  Delivery,
  Dispute,
  LedgerEvent,
  Money,
  Order,
  Payment,
  Ruling,
  Settlement,
  Verification,
} from "./model";

/**
 * Ports.
 *
 * The domain depends on these interfaces and nothing else. Storage, GenLayer
 * and the payment rail are all replaceable without touching protocol logic —
 * which is the whole point of "one dispute API across rails".
 */

/**
 * A handle bound to a signing key.
 *
 * `REGISTERED` bindings were declared by an operator ahead of time.
 * `TOFU` bindings were established by the first signed request from a handle.
 * The distinction matters: only the former proves anything about who an agent
 * is before it first spoke.
 */
export interface AgentBinding {
  handle: string;
  address: string;
  source: "REGISTERED" | "TOFU";
  boundAt: string;
}

export interface RecourseStore {
  nextOrderSequence(): Promise<number>;

  getAgentBinding(handle: string): Promise<AgentBinding | null>;
  putAgentBinding(binding: AgentBinding): Promise<void>;
  listAgentBindings(): Promise<AgentBinding[]>;

  putOrder(order: Order): Promise<void>;
  getOrder(orderId: string): Promise<Order | null>;
  listOrders(): Promise<Order[]>;

  putAgreement(agreement: Agreement): Promise<void>;
  getAgreement(orderId: string): Promise<Agreement | null>;

  putPayment(payment: Payment): Promise<void>;
  getPayment(orderId: string): Promise<Payment | null>;
  /** Replay protection: rail references are globally unique. */
  hasPaymentReference(reference: string): Promise<boolean>;

  putDelivery(delivery: Delivery): Promise<void>;
  getDelivery(orderId: string): Promise<Delivery | null>;

  putVerification(verification: Verification): Promise<void>;
  getVerification(orderId: string): Promise<Verification | null>;

  putDispute(dispute: Dispute): Promise<void>;
  getDispute(disputeId: string): Promise<Dispute | null>;
  getDisputeByOrder(orderId: string): Promise<Dispute | null>;
  listDisputes(): Promise<Dispute[]>;

  putAdjudication(adjudication: Adjudication): Promise<void>;
  getAdjudication(disputeId: string): Promise<Adjudication | null>;
  getAdjudicationByOrder(orderId: string): Promise<Adjudication | null>;

  putSettlement(settlement: Settlement): Promise<void>;
  getSettlement(orderId: string): Promise<Settlement | null>;

  appendEvent(event: LedgerEvent): Promise<void>;
  listEvents(orderId: string): Promise<LedgerEvent[]>;

  /**
   * Serialises all mutations for one order. Without this, two concurrent
   * settlements could both read "not settled yet" and both execute.
   */
  withOrderLock<T>(orderId: string, fn: () => Promise<T>): Promise<T>;
}

/* ------------------------------------------------------- adjudication port */

export interface AdjudicationRequest {
  disputeId: string;
  orderId: string;
  question: string;
  /** Canonical, sanitised payload sent to the forum. */
  payload: AdjudicationPayload;
}

export interface AdjudicationPayload {
  agreementHash: string;
  evidenceHash: string;
  /** Only the terms genuinely in contention. */
  contestedTerms: Array<{
    id: string;
    label: string;
    operator: string;
    expected: string;
    mandatory: boolean;
  }>;
  /** Results the protocol already established. GenLayer does not redo these. */
  deterministicFindings: Array<{
    termId: string;
    expression: string;
    result: string;
  }>;
  /** Untrusted merchant text, clearly framed as data. */
  merchantStatement: string;
  buyerClaim: string;
}

export interface AdjudicationOutcome {
  status: Adjudication["status"];
  network: string | null;
  contractAddress: string | null;
  transactionHash: string | null;
  networkStatus: string | null;
  votes: Record<string, string> | null;
  ruling: Ruling | null;
  failureReason: string | null;
  finalizedAt: string | null;
}

export interface AdjudicationForum {
  readonly id: string;
  readonly available: boolean;
  /** Human description of what this forum actually is, shown in the UI. */
  readonly description: string;
  /**
   * Broadcasts the adjudication. Returns as soon as the network accepts the
   * transaction — consensus takes tens of seconds and must not block a request.
   */
  submit(request: AdjudicationRequest): Promise<AdjudicationOutcome>;
  /** Polls a submitted adjudication for finality. Never fabricates progress. */
  poll(input: {
    disputeId: string;
    transactionHash: string;
  }): Promise<AdjudicationOutcome>;
}

/* ------------------------------------------------------------ payment port */

export interface PaymentRequirementsQuote {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource: { url: string; description: string; mimeType: string };
  extra?: Record<string, string>;
}

export interface PaymentAuthorization {
  /** x402 payload, rail-specific. */
  payload: Record<string, unknown>;
  scheme: string;
  network: string;
}

export interface PaymentVerification {
  valid: boolean;
  payer: string | null;
  reference: string;
  invalidReason: string | null;
}

export interface EscrowReceipt {
  reference: string;
  payer: string;
  payee: string;
  network: string;
  transactionHash: string | null;
  execution: Payment["execution"];
  confirmedAt: string;
}

export interface SettlementExecution {
  transactionHash: string | null;
  execution: Settlement["execution"];
  executedAt: string;
}

export interface PaymentRail {
  readonly id: Payment["rail"];
  readonly network: string;
  readonly settlesOnchain: boolean;
  quote(input: {
    orderId: string;
    amount: Money;
    resourceName: string;
    resourceUrl: string;
  }): PaymentRequirementsQuote;
  verify(
    authorization: PaymentAuthorization,
    requirements: PaymentRequirementsQuote,
  ): Promise<PaymentVerification>;
  captureToEscrow(input: {
    orderId: string;
    authorization: PaymentAuthorization;
    requirements: PaymentRequirementsQuote;
  }): Promise<EscrowReceipt>;
  release(input: { orderId: string; amount: Money; to: string }): Promise<SettlementExecution>;
  refund(input: { orderId: string; amount: Money; to: string }): Promise<SettlementExecution>;
}
