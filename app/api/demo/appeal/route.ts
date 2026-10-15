import { z } from "zod";
import { getRuntime } from "@/server/runtime";
import { presentDossier } from "@/server/presenter";
import { demoDisabled, demoEndpointsEnabled, ok, parse, problem, tooManyRequests } from "@/server/http";
import { clientKey, POLICIES, rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({ orderId: z.string().min(3) });

/**
 * POST /api/demo/appeal — appeal the provisional ruling of a demo order.
 *
 * The demo acts as the protocol, so it appeals on behalf of the side the
 * ruling went against. Everything else is the real path: the appeal is
 * refused unless the order holds a provisional ruling, the network is asked
 * whether the decision can still be appealed, and the bond it quotes is paid
 * by the protocol's key. Disabled with the other demo endpoints.
 */
export async function POST(request: Request) {
  try {
    if (!demoEndpointsEnabled()) return demoDisabled();

    const limit = rateLimit(clientKey(request, "appeal"), POLICIES.adjudication);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const { orderId } = await parse(request, schema);
    const { protocol } = getRuntime();
    const current = await protocol.dossier(orderId);
    if (!current.dispute) {
      return ok({ dossier: presentDossier(current), done: false, waiting: false });
    }
    const dossier = await protocol.fileAppeal({
      disputeId: current.dispute.id,
      reason: "Appealed from the live demo by the side the provisional ruling went against.",
    });
    return ok({ dossier: presentDossier(dossier), done: false, waiting: true }, 202);
  } catch (error) {
    return problem(error);
  }
}
