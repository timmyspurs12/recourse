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
  /*
   * Judgment, v0.2.
   *
   * A ruling first arrives PROVISIONAL: GenLayer accepted it, and it can still
   * be appealed and recomputed until the finality window closes. Nothing
   * settles from there — there is deliberately no edge from PROVISIONAL_RULING
   * or APPEALED to RELEASED, REFUNDED or PARTIALLY_REFUNDED. The ruled states
   * (BUYER_WON, MERCHANT_WON, SPLIT_AWARDED) are only entered on finality.
   *
   * ADJUDICATING may still jump straight to a ruled state, because a poll can
   * first observe a transaction after its window has already closed. The
   * provisional states can fall back to ADJUDICATING when the network fails to
   * decide, so the dispute can be resubmitted rather than stranded.
   */
  ADJUDICATING: ["PROVISIONAL_RULING", "BUYER_WON", "MERCHANT_WON", "SPLIT_AWARDED", "DISPUTED"],
  PROVISIONAL_RULING: ["APPEALED", "BUYER_WON", "MERCHANT_WON", "SPLIT_AWARDED", "ADJUDICATING"],
  APPEALED: ["PROVISIONAL_RULING", "BUYER_WON", "MERCHANT_WON", "SPLIT_AWARDED", "ADJUDICATING"],
  BUYER_WON: ["REFUNDED"],
  MERCHANT_WON: ["RELEASED"],
  SPLIT_AWARDED: ["PARTIALLY_REFUNDED"],
  // Terminal.
  REFUNDED: [],
  PARTIALLY_REFUNDED: [],
  RELEASED: [],
  CANCELLED: [],
};

export const TERMINAL_STATES: readonly OrderState[] = [
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "RELEASED",
  "CANCELLED",
];

/** States in which a ruling exists but may still change. Nothing settles here. */
export const PROVISIONAL_STATES: readonly OrderState[] = ["PROVISIONAL_RULING", "APPEALED"];

/** States entered only once a ruling is final. Settlement starts from these. */
export const RULED_STATES: readonly OrderState[] = ["BUYER_WON", "MERCHANT_WON", "SPLIT_AWARDED"];

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
    "PROVISIONAL_RULING",
    "BUYER_WON",
    "REFUNDED",
  ] as OrderState[],
  merchantWins: [
    "DISPUTED",
    "ADJUDICATING",
    "PROVISIONAL_RULING",
    "MERCHANT_WON",
    "RELEASED",
  ] as OrderState[],
  /** A graduated agreement, ruled as a partial breach. */
  split: [
    "DISPUTED",
    "ADJUDICATING",
    "PROVISIONAL_RULING",
    "SPLIT_AWARDED",
    "PARTIALLY_REFUNDED",
  ] as OrderState[],
  /** The losing side appeals; the appeal round re-runs consensus. */
  appealed: [
    "ADJUDICATING",
    "PROVISIONAL_RULING",
    "APPEALED",
    "PROVISIONAL_RULING",
  ] as OrderState[],
};
