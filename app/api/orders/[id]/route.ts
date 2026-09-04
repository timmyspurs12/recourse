import { getRuntime } from "@/server/runtime";
import { ok, problem } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/orders/:id — the full transaction dossier. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { protocol } = getRuntime();
    return ok(await protocol.dossier(id));
  } catch (error) {
    return problem(error);
  }
}
