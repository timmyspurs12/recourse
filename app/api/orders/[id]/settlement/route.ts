import { getRuntime } from "@/server/runtime";
import { authorizeOnly, ok, problem } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/orders/:id/settlement — settlement status. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { protocol } = getRuntime();
    const settlement = await protocol.getSettlement(id);
    return ok({ settlement });
  } catch (error) {
    return problem(error);
  }
}

/**
 * POST /api/orders/:id/settlement — execute release or refund.
 *
 * Idempotent: repeat calls return the settlement that already happened rather
 * than moving money twice.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await authorizeOnly(request);
    const { protocol } = getRuntime();
    return ok(await protocol.settle(id, actor));
  } catch (error) {
    return problem(error);
  }
}
