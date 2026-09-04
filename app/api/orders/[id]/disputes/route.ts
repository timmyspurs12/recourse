import { getRuntime } from "@/server/runtime";
import { ok, openDisputeSchema, problem, readSigned } from "@/server/http";

export const dynamic = "force-dynamic";

/** POST /api/orders/:id/disputes — open a recourse claim. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { actor, data: input } = await readSigned(request, openDisputeSchema);
    const { protocol } = getRuntime();
    return ok(
      await protocol.openDispute({
        actor,
        orderId: id,
        claim: input.claim,
        contestedTermIds: input.contestedTermIds,
        openedBy: input.openedBy,
      }),
      201,
    );
  } catch (error) {
    return problem(error);
  }
}
