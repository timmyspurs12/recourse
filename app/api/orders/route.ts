import { getRuntime } from "@/server/runtime";
import { createPurchaseSchema, ok, problem, readSigned } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/orders — the protocol transaction ledger. */
export async function GET() {
  try {
    const { protocol } = getRuntime();
    return ok({ orders: await protocol.listOrders() });
  } catch (error) {
    return problem(error);
  }
}

/**
 * POST /api/orders — create a protected purchase.
 *
 * The agreement is hashed and locked as part of this call; payment is captured
 * against it. Supply `payment` with a signed x402 authorization to have it
 * cryptographically verified.
 */
export async function POST(request: Request) {
  try {
    const { data: input } = await readSigned(request, createPurchaseSchema);
    const { protocol } = getRuntime();
    const dossier = await protocol.createProtectedPurchase({
      buyer: input.buyer,
      merchant: input.merchant,
      resource: input.resource,
      amount: input.amount,
      currency: input.currency ?? "USDC",
      terms: input.terms,
      deliveryDeadlineHours: input.deliveryDeadlineHours,
      recourseWindowHours: input.recourseWindowHours,
      deferFunding: input.deferFunding,
      authorization: input.payment,
    });
    return ok(dossier, 201);
  } catch (error) {
    return problem(error);
  }
}
