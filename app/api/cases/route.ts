import { getRuntime } from "@/server/runtime";
import { presentCase } from "@/server/presenter";
import { ok, problem } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { protocol } = getRuntime();
    const disputes = await protocol.listDisputes();
    const dossiers = await Promise.all(disputes.map((d) => protocol.dossier(d.orderId)));
    return ok({ cases: dossiers.map(presentCase).filter(Boolean) });
  } catch (error) {
    return problem(error);
  }
}
