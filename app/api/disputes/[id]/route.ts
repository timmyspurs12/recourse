import { getRuntime } from "@/server/runtime";
import { ok, problem } from "@/server/http";
import { fail } from "@/domain/shared/errors";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { protocol } = getRuntime();
    const dossier = await protocol.dossierByDispute(id);
    if (!dossier) fail("DISPUTE_NOT_FOUND", `No dispute with id ${id}`);
    return ok(dossier);
  } catch (error) {
    return problem(error);
  }
}
