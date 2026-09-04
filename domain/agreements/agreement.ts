import type {
  Agreement,
  AgreementDocument,
  AgreementTerm,
  Currency,
  RefundPolicy,
} from "../model";
import { canonicalize, documentHash, hashEquals, type Json } from "../shared/canonical";
import { newAgreementId } from "../shared/ids";
import { fail } from "../shared/errors";

export interface DraftAgreementInput {
  orderId: string;
  buyer: string;
  merchant: string;
  resource: { name: string; type: string };
  amount: string;
  currency: Currency;
  rail: string;
  terms: AgreementTerm[];
  deliveryDeadline: string;
  recourseWindowHours: number;
  createdAt: string;
}

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;

export function validateTerms(terms: AgreementTerm[]): void {
  if (terms.length === 0) {
    fail("AGREEMENT_INVALID", "An agreement must contain at least one term");
  }
  const seen = new Set<string>();
  for (const term of terms) {
    if (seen.has(term.id)) {
      fail("AGREEMENT_INVALID", `Duplicate term id: ${term.id}`);
    }
    seen.add(term.id);

    const numericOperator = term.operator === "GTE" || term.operator === "LTE";
    if (numericOperator && typeof term.expected !== "number") {
      fail(
        "AGREEMENT_INVALID",
        `Term ${term.id} uses ${term.operator} and must declare a numeric expected value`,
      );
    }
    if (term.operator === "JUDGMENT" && term.evaluation !== "SEMANTIC") {
      fail("AGREEMENT_INVALID", `Term ${term.id} uses JUDGMENT and must be SEMANTIC`);
    }
    if (term.operator !== "JUDGMENT" && term.evaluation === "SEMANTIC") {
      fail(
        "AGREEMENT_INVALID",
        `Term ${term.id} is SEMANTIC but uses the deterministic operator ${term.operator}`,
      );
    }
  }
}

/**
 * Builds the canonical agreement document and its hash.
 *
 * The document is the thing that gets hashed — not the database row — so any
 * party holding the same JSON can recompute the hash independently.
 */
export function draftAgreement(input: DraftAgreementInput): Agreement {
  if (!AMOUNT_PATTERN.test(input.amount)) {
    fail("AGREEMENT_INVALID", `Amount must be a decimal string, received "${input.amount}"`);
  }
  if (Number(input.amount) <= 0) {
    fail("AGREEMENT_INVALID", "Amount must be greater than zero");
  }
  if (input.recourseWindowHours <= 0) {
    fail("AGREEMENT_INVALID", "Recourse window must be positive");
  }
  validateTerms(input.terms);

  const refundPolicy: RefundPolicy = {
    type: "mandatory_term_breach",
    settlement: "full_refund",
    recourseWindowHours: input.recourseWindowHours,
  };

  const document: AgreementDocument = {
    version: "recourse/0.1",
    orderId: input.orderId,
    buyer: input.buyer,
    merchant: input.merchant,
    resource: input.resource,
    payment: { amount: input.amount, currency: input.currency, rail: input.rail },
    terms: input.terms,
    refundPolicy,
    deliveryDeadline: input.deliveryDeadline,
    createdAt: input.createdAt,
  };

  return {
    id: newAgreementId(),
    orderId: input.orderId,
    document,
    hash: agreementHash(document),
    lockedAt: null,
  };
}

export function agreementHash(document: AgreementDocument): string {
  return documentHash(document as unknown as Json);
}

export function canonicalAgreement(document: AgreementDocument): string {
  return canonicalize(document as unknown as Json);
}

/**
 * Locks the agreement at payment authorisation. After this point the document
 * is frozen for both parties: the merchant cannot add conditions and the buyer
 * cannot tighten them.
 */
export function lockAgreement(agreement: Agreement, at: string): Agreement {
  if (agreement.lockedAt) {
    fail("AGREEMENT_LOCKED", `Agreement ${agreement.id} was already locked at ${agreement.lockedAt}`);
  }
  return { ...agreement, lockedAt: at };
}

/**
 * Recomputes the hash and compares. Any post-lock mutation of the stored
 * document — however it happened — surfaces here rather than silently changing
 * what the parties are held to.
 */
export function assertAgreementIntegrity(agreement: Agreement): void {
  const recomputed = agreementHash(agreement.document);
  if (!hashEquals(recomputed, agreement.hash)) {
    fail(
      "AGREEMENT_MUTATED",
      "Stored agreement does not match its hash — the locked promise has been altered",
      { expected: agreement.hash, recomputed },
    );
  }
}

export function mandatoryTerms(agreement: Agreement): AgreementTerm[] {
  return agreement.document.terms.filter((term) => term.mandatory);
}

export function findTerm(agreement: Agreement, termId: string): AgreementTerm | undefined {
  return agreement.document.terms.find((term) => term.id === termId);
}
