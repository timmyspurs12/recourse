/**
 * Domain error taxonomy.
 *
 * Every failure inside the protocol is one of these. The HTTP layer maps codes
 * to status codes; the UI maps codes to protocol-specific error states.
 */
export const ERROR_CODES = [
  "AGREEMENT_INVALID",
  "AGREEMENT_LOCKED",
  "AGREEMENT_MUTATED",
  "EVIDENCE_INVALID",
  "EVIDENCE_MUTATED",
  "EVIDENCE_TOO_LARGE",
  "EVIDENCE_UNAVAILABLE",
  "ORDER_NOT_FOUND",
  "DISPUTE_NOT_FOUND",
  "DISPUTE_ALREADY_OPEN",
  "DISPUTE_WINDOW_CLOSED",
  "DELIVERY_ALREADY_SUBMITTED",
  "INVALID_STATE_TRANSITION",
  "SETTLEMENT_ALREADY_EXECUTED",
  "SETTLEMENT_UNAVAILABLE",
  "ADJUDICATION_UNAVAILABLE",
  "ADJUDICATION_PENDING",
  "ADJUDICATION_MALFORMED",
  "PAYMENT_REQUIRED",
  "PAYMENT_INVALID",
  "PAYMENT_REPLAYED",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "CONFLICT",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  AGREEMENT_INVALID: 422,
  AGREEMENT_LOCKED: 409,
  AGREEMENT_MUTATED: 409,
  EVIDENCE_INVALID: 422,
  EVIDENCE_MUTATED: 409,
  EVIDENCE_TOO_LARGE: 413,
  EVIDENCE_UNAVAILABLE: 424,
  ORDER_NOT_FOUND: 404,
  DISPUTE_NOT_FOUND: 404,
  DISPUTE_ALREADY_OPEN: 409,
  DISPUTE_WINDOW_CLOSED: 409,
  DELIVERY_ALREADY_SUBMITTED: 409,
  INVALID_STATE_TRANSITION: 409,
  SETTLEMENT_ALREADY_EXECUTED: 409,
  SETTLEMENT_UNAVAILABLE: 424,
  ADJUDICATION_UNAVAILABLE: 424,
  ADJUDICATION_PENDING: 202,
  ADJUDICATION_MALFORMED: 502,
  PAYMENT_REQUIRED: 402,
  PAYMENT_INVALID: 402,
  PAYMENT_REPLAYED: 409,
  UNAUTHORIZED: 403,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  INTERNAL: 500,
};

export class RecourseDomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: unknown;

  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "RecourseDomainError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = detail;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, detail: this.detail ?? null } };
  }
}

export function fail(code: ErrorCode, message: string, detail?: unknown): never {
  throw new RecourseDomainError(code, message, detail);
}
