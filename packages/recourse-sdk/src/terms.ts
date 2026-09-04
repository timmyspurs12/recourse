import type { AgreementTerm } from "./types";

/**
 * Term builders.
 *
 * Agreements are the thing developers get wrong, so the SDK makes the right
 * shape the easy one. Every builder marks its own evaluation mode: `atLeast`,
 * `atMost`, `equals` and `matches` are settled by arithmetic in the protocol,
 * and only `judgment` can ever reach an adjudication forum.
 */

export const term = {
  /** Numeric floor, e.g. at least 5 independent sources. */
  atLeast(id: string, label: string, value: number, options?: Partial<AgreementTerm>): AgreementTerm {
    return {
      id,
      label,
      operator: "GTE",
      expected: value,
      mandatory: true,
      evaluation: "DETERMINISTIC",
      ...options,
    };
  },

  /** Numeric ceiling, e.g. no source older than 30 days. */
  atMost(id: string, label: string, value: number, options?: Partial<AgreementTerm>): AgreementTerm {
    return {
      id,
      label,
      operator: "LTE",
      expected: value,
      mandatory: true,
      evaluation: "DETERMINISTIC",
      ...options,
    };
  },

  /** Exact equality, e.g. exactly 4 sections. */
  equals(
    id: string,
    label: string,
    value: string | number,
    options?: Partial<AgreementTerm>,
  ): AgreementTerm {
    return {
      id,
      label,
      operator: "EQ",
      expected: value,
      mandatory: true,
      evaluation: "DETERMINISTIC",
      ...options,
    };
  },

  /** Case-insensitive string match, e.g. geography. */
  matches(id: string, label: string, value: string, options?: Partial<AgreementTerm>): AgreementTerm {
    return {
      id,
      label,
      operator: "MATCH",
      expected: value,
      mandatory: true,
      evaluation: "DETERMINISTIC",
      ...options,
    };
  },

  /**
   * A term no comparison can settle.
   *
   * Use this sparingly. Everything that can be checked with arithmetic should
   * be: deterministic terms are cheaper, instant, and impossible to argue with.
   */
  judgment(id: string, label: string, question: string, options?: Partial<AgreementTerm>): AgreementTerm {
    return {
      id,
      label,
      operator: "JUDGMENT",
      expected: question,
      mandatory: true,
      evaluation: "SEMANTIC",
      ...options,
    };
  },
};

/** Terms the protocol resolves without any model in the loop. */
export function deterministicTerms(terms: AgreementTerm[]): AgreementTerm[] {
  return terms.filter((entry) => entry.evaluation === "DETERMINISTIC");
}

/** Terms that may be referred to an adjudication forum. */
export function semanticTerms(terms: AgreementTerm[]): AgreementTerm[] {
  return terms.filter((entry) => entry.evaluation === "SEMANTIC");
}
