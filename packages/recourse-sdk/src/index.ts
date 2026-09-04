/**
 * @recourse/sdk — programmable chargebacks for autonomous commerce.
 *
 * Payments got autonomous. Refunds didn't. This SDK wraps a payment in an
 * agreement the buyer can enforce: if the merchant breaks a mandatory term,
 * the buyer's agent can get the money back without a human in the loop.
 */
export { RecourseClient } from "./client";
export type {
  CreateProtectedPurchaseInput,
  OpenDisputeInput,
  RecourseClientOptions,
  SubmitDeliveryInput,
} from "./client";
export { term, deterministicTerms, semanticTerms } from "./terms";
export { signRequest, canonicalRequest, AUTH_HEADERS, SIGNING_PREFIX } from "./signing";
export type { AgentSigner, MessageSigner } from "./signing";
export { RecourseError } from "./types";
export type {
  Adjudication,
  AgentRef,
  Agreement,
  AgreementTerm,
  DeterministicCheck,
  Dispute,
  Dossier,
  LedgerEvent,
  Money,
  Order,
  OrderState,
  PaymentRequirements,
  Ruling,
  Settlement,
  TermEvaluation,
  TermOperator,
  Verification,
} from "./types";
