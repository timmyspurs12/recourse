import type {
  Agreement,
  AgreementTerm,
  CheckResult,
  DeterministicCheck,
  Delivery,
  SemanticQuestion,
  Verification,
} from "../model";
import { assertAgreementIntegrity } from "../agreements/agreement";
import { assertDeliveryIntegrity } from "../evidence/evidence";
import { fail } from "../shared/errors";

export const VERIFICATION_ENGINE = "recourse/deterministic@0.4";

/**
 * Observations are derived from the delivery, never from the agreement. Two
 * independent sources of truth are what makes a comparison meaningful.
 */
function observe(term: AgreementTerm, delivery: Delivery): string | number | null {
  const a = delivery.assertions;
  switch (term.id) {
    case "minimum_sources":
      return a.sourceCount;
    case "max_source_age_days":
      return a.maxSourceAgeDays;
    case "geography":
      return a.geography;
    case "required_sections":
      return a.sectionCount;
    case "format":
      return a.format;
    default:
      return null;
  }
}

function compare(
  term: AgreementTerm,
  observed: string | number | null,
): { result: CheckResult; expression: string } {
  if (observed === null || observed === undefined) {
    return { result: "INDETERMINATE", expression: `${term.id}: no observation supplied` };
  }

  switch (term.operator) {
    case "GTE": {
      const value = Number(observed);
      const expected = Number(term.expected);
      if (!Number.isFinite(value)) {
        return { result: "INDETERMINATE", expression: `${observed} is not numeric` };
      }
      return {
        result: value >= expected ? "PASS" : "BREACH",
        expression: `${value} ${value >= expected ? "≥" : "<"} ${expected}`,
      };
    }
    case "LTE": {
      const value = Number(observed);
      const expected = Number(term.expected);
      if (!Number.isFinite(value)) {
        return { result: "INDETERMINATE", expression: `${observed} is not numeric` };
      }
      return {
        result: value <= expected ? "PASS" : "BREACH",
        expression: `${value} ${value <= expected ? "≤" : ">"} ${expected}`,
      };
    }
    case "EQ": {
      const equal = String(observed) === String(term.expected);
      return {
        result: equal ? "PASS" : "BREACH",
        expression: `${observed} ${equal ? "=" : "≠"} ${term.expected}`,
      };
    }
    case "MATCH": {
      const equal =
        String(observed).trim().toLowerCase() === String(term.expected).trim().toLowerCase();
      return {
        result: equal ? "PASS" : "BREACH",
        expression: `${observed} ${equal ? "=" : "≠"} ${term.expected}`,
      };
    }
    case "JUDGMENT":
      return { result: "INDETERMINATE", expression: "requires judgment" };
    default:
      return { result: "INDETERMINATE", expression: "unknown operator" };
  }
}

/**
 * Runs every deterministic term and collects the semantic ones.
 *
 * The single most important property of this function: it NEVER calls a model.
 * Counting sources is arithmetic. If arithmetic can settle a term, the protocol
 * settles it and GenLayer never sees it.
 */
export function verifyDelivery(
  agreement: Agreement,
  delivery: Delivery,
  executedAt: string,
): Verification {
  assertAgreementIntegrity(agreement);

  if (delivery.unavailableReason) {
    fail(
      "EVIDENCE_UNAVAILABLE",
      "Verification cannot run because the delivery evidence payload is unavailable",
      { reason: delivery.unavailableReason },
    );
  }
  assertDeliveryIntegrity(delivery);

  const checks: DeterministicCheck[] = [];
  const semanticQuestions: SemanticQuestion[] = [];

  for (const term of agreement.document.terms) {
    if (term.evaluation === "SEMANTIC") {
      semanticQuestions.push({
        termId: term.id,
        label: term.label,
        question: String(term.expected),
        reason: "No arithmetic or string comparison can settle this term.",
      });
      continue;
    }

    const observed = observe(term, delivery);
    const { result, expression } = compare(term, observed);
    checks.push({
      termId: term.id,
      label: term.label,
      expression,
      expected: `${term.expected}${term.unit ? ` ${term.unit}` : ""}`,
      observed: observed === null ? "—" : `${observed}${term.unit ? ` ${term.unit}` : ""}`,
      result,
      mandatory: term.mandatory,
    });
  }

  const breachedTermIds = checks
    .filter((check) => check.result === "BREACH" && check.mandatory)
    .map((check) => check.termId);

  const indeterminate = checks.some(
    (check) => check.result === "INDETERMINATE" && check.mandatory,
  );

  let outcome: Verification["outcome"];
  if (breachedTermIds.length > 0) {
    outcome = "BREACH";
  } else if (indeterminate || semanticQuestions.length > 0) {
    // A semantic term only escalates if the buyer contests it; on its own it
    // does not block fulfillment. Indeterminate mandatory checks always do.
    outcome = indeterminate ? "REQUIRES_JUDGMENT" : "SATISFIED";
  } else {
    outcome = "SATISFIED";
  }

  return {
    orderId: agreement.orderId,
    engine: VERIFICATION_ENGINE,
    checks,
    semanticQuestions,
    outcome,
    breachedTermIds,
    executedAt,
  };
}

/**
 * A deterministic breach of a mandatory term is material by construction: the
 * parties agreed in advance that it was. Judgment is only needed when the
 * question itself is semantic.
 */
export function isMaterialBreach(verification: Verification): boolean {
  return verification.breachedTermIds.length > 0;
}
