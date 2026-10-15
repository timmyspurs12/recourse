import { getRuntime } from "@/server/runtime";
import { appealSchema, ok, problem, readSigned, tooManyRequests } from "@/server/http";
import { clientKey, POLICIES, rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/disputes/:id/appeal — appeal a provisional ruling.
 *
 * GenLayer re-evaluates the adjudication transaction with a larger validator
 * committee; if its majority disagrees, the ruling is recomputed. Only the
 * side a ruling went against may appeal, once per party, and only while the
 * network still allows it. The appellant is the signer of this request — never
 * a field in the body.
 *
 * Appeals cost a bond on the network, so they share the adjudication rate
 * limit.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    const limit = rateLimit(clientKey(request, "appeal"), POLICIES.adjudication);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const { actor, data } = await readSigned(request, appealSchema);
    const { protocol } = getRuntime();
    const dossier = await protocol.fileAppeal({ disputeId: id, actor, reason: data.reason });
    return ok({ adjudication: dossier.adjudication, order: dossier.order }, 202);
  } catch (error) {
    return problem(error);
  }
}
