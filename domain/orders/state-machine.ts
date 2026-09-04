import type { OrderState } from "../model";
import { fail } from "../shared/errors";

/**
 * The protected-transaction state machine.
 *
 * This is the spine of the protocol. Nothing may change an order's state except
 * `transition`, and every legal edge is enumerated here. Illegal edges are not
 * "unlikely" — they are impossible, which is what makes double-settlement and
 * replay structurally unreachable rather than merely guarded against.
 */
export const TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  OFFERED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["ESCROWED", "CANCELLED"],
  ESCROWED: ["DELIVERED", "DISPUTED", "CANCELLED"],
  DELIVERED: ["VERIFICATION_PENDING", "DISPUTED"],
  VERIFICATION_PENDING: ["FULFILLED", "DISPUTED"],
  FULFILLED: ["RELEASED", "DISPUTED"],
  DISPUTED: ["ADJUDICATING"],
  ADJUDICATING: ["BUYER_WON", "MERCHANT_WON", "DISPUTED"],
  BUYER_WON: ["REFUNDED"],
  MERCHANT_WON: ["RELEASED"],
  // Terminal.
  REFUNDED: [],
  RELEASED: [],
  CANCELLED: [],
};

export const TERMINAL_STATES: readonly OrderState[] = ["REFUNDED", "RELEASED", "CANCELLED"];

export function isTerminal(state: OrderState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Returns `to` when the edge is legal, otherwise throws INVALID_STATE_TRANSITION.
 * Callers should treat the return value as the new state.
 */
export function transition(from: OrderState, to: OrderState): OrderState {
  if (!canTransition(from, to)) {
    fail(
      "INVALID_STATE_TRANSITION",
      `Illegal transition ${from} → ${to}. Allowed: ${TRANSITIONS[from].join(", ") || "none (terminal)"}`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
  return to;
}

/** All states reachable from `from`, for UI rails and documentation. */
export function reachableFrom(from: OrderState): OrderState[] {
  const seen = new Set<OrderState>();
  const queue: OrderState[] = [from];
  while (queue.length) {
    const current = queue.shift() as OrderState;
    for (const next of TRANSITIONS[current]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

/** The happy path and the dispute path, used by the protocol page. */
export const CANONICAL_PATHS = {
  fulfilled: [
    "OFFERED",
    "ACCEPTED",
    "ESCROWED",
    "DELIVERED",
    "VERIFICATION_PENDING",
    "FULFILLED",
    "RELEASED",
  ] as OrderState[],
  disputed: [
    "OFFERED",
    "ACCEPTED",
    "ESCROWED",
    "DELIVERED",
    "VERIFICATION_PENDING",
    "DISPUTED",
    "ADJUDICATING",
    "BUYER_WON",
    "REFUNDED",
  ] as OrderState[],
  merchantWins: [
    "DISPUTED",
    "ADJUDICATING",
    "MERCHANT_WON",
    "RELEASED",
  ] as OrderState[],
};
