import { getRuntime } from "@/server/runtime";
import { ok, problem, readSigned, submitDeliverySchema } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/:id/delivery — merchant submits fulfillment.
 *
 * Evidence is sanitised, bounded and hashed on write, then verified
 * deterministically against the locked agreement.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { actor, data: input } = await readSigned(request, submitDeliverySchema);
    const { protocol } = getRuntime();
    return ok(
      await protocol.submitDelivery({
        actor,
        orderId: id,
        statement: input.statement,
        artifactUrl: input.artifactUrl ?? null,
        artifactHash: input.artifactHash,
        assertions: input.assertions,
        evidence: input.evidence,
      }),
      201,
    );
  } catch (error) {
    return problem(error);
  }
}
