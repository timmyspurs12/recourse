import { getRuntime } from "@/server/runtime";
import { authorizeOnly, ok, problem, tooManyRequests } from "@/server/http";
import { clientKey, POLICIES, rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/disputes/:id/adjudication — poll the forum.
 *
 * Polling is a read that may advance state: once the network reports finality,
 * the ruling is recorded. Consensus is never awaited inside a request.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { protocol } = getRuntime();
    const dossier = await protocol.pollAdjudication(id);
    return ok({ adjudication: dossier.adjudication, order: dossier.order });
  } catch (error) {
    return problem(error);
  }
}

/** POST /api/disputes/:id/adjudication — submit the contested terms to GenLayer. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    // Every submission is a real transaction executed by real validators.
    const limit = rateLimit(clientKey(request, "adjudicate"), POLICIES.adjudication);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const actor = await authorizeOnly(request);
    const { protocol } = getRuntime();
    const dossier = await protocol.submitAdjudication(id, actor);
    return ok({ adjudication: dossier.adjudication, order: dossier.order }, 202);
  } catch (error) {
    return problem(error);
  }
}
