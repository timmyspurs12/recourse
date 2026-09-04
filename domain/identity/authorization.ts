import { fail } from "../shared/errors";
import type { Order } from "../model";

/**
 * Agent identity and authorization.
 *
 * Two separate questions, kept separate:
 *
 *   AUTHENTICATION — "is this really shopper.agent?"  (server/auth.ts, crypto)
 *   AUTHORIZATION  — "may shopper.agent do this?"     (here, protocol rules)
 *
 * Authorization lives in the domain because it is a protocol rule, not a
 * transport concern. A merchant must not be able to open a dispute against
 * itself and award itself a refund, whichever door it came through.
 */

export interface Actor {
  handle: string;
  /** The address that authenticated this actor, when a signature was verified. */
  address?: string;
  /**
   * True when the caller proved control of the agent's key. False means the
   * deployment is running with authentication disabled, which is a
   * configuration choice the operator has to make deliberately.
   */
  authenticated: boolean;
}

/** The protocol acting on its own behalf (seeds, demo orchestration, jobs). */
export const SYSTEM_ACTOR: Actor = { handle: "recourse.protocol", authenticated: true };

export function isSystem(actor: Actor | undefined): boolean {
  return actor?.handle === SYSTEM_ACTOR.handle;
}

export type Party = "BUYER" | "MERCHANT";

export function partyFor(order: Order, actor: Actor): Party | null {
  if (actor.handle === order.buyer.handle) return "BUYER";
  if (actor.handle === order.merchant.handle) return "MERCHANT";
  return null;
}

/**
 * Only the merchant named in the locked agreement may deliver against it.
 */
export function assertCanDeliver(order: Order, actor?: Actor): void {
  if (!actor || isSystem(actor)) return;
  if (partyFor(order, actor) !== "MERCHANT") {
    fail(
      "UNAUTHORIZED",
      `${actor.handle} is not the merchant on ${order.id} and cannot submit a delivery`,
      { expected: order.merchant.handle, actual: actor.handle },
    );
  }
}

/**
 * Either party may open a dispute, but neither may open one in the other's
 * name — the claimant is derived from the authenticated identity, never taken
 * from the request body.
 */
export function assertCanDispute(order: Order, actor?: Actor): Party {
  if (!actor || isSystem(actor)) return "BUYER";
  const party = partyFor(order, actor);
  if (!party) {
    fail("UNAUTHORIZED", `${actor.handle} is not a party to ${order.id}`, {
      buyer: order.buyer.handle,
      merchant: order.merchant.handle,
    });
  }
  return party;
}

/**
 * Settlement is authorised by protocol state, not by the caller: whoever calls
 * it, the outcome is already determined. Non-parties are still refused, because
 * a stranger has no business triggering someone else's payout.
 */
export function assertCanSettle(order: Order, actor?: Actor): void {
  if (!actor || isSystem(actor)) return;
  if (!partyFor(order, actor)) {
    fail("UNAUTHORIZED", `${actor.handle} is not a party to ${order.id}`);
  }
}

/** Referring a dispute to the forum costs money; restrict it to the parties. */
export function assertCanAdjudicate(order: Order, actor?: Actor): void {
  if (!actor || isSystem(actor)) return;
  if (!partyFor(order, actor)) {
    fail("UNAUTHORIZED", `${actor.handle} is not a party to ${order.id}`);
  }
}
