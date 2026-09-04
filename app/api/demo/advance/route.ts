import { z } from "zod";
import { getRuntime } from "@/server/runtime";
import { presentDossier } from "@/server/presenter";
import { demoDisabled, demoEndpointsEnabled, ok, parse, problem } from "@/server/http";
import { BUYER_CLAIM, GOOD_DELIVERY, SHORT_DELIVERY } from "@/server/scenario";

export const dynamic = "force-dynamic";

const schema = z.object({
  orderId: z.string().min(3),
  path: z.enum(["SUCCESS", "DISPUTE"]),
});

/**
 * POST /api/demo/advance — take the next legal step for a demo order.
 *
 * The server decides what "next" means by reading actual order state, so the
 * client cannot skip, reorder or invent a stage. When GenLayer has not reached
 * consensus yet the response says `waiting: true` and the state does not move.
 */
export async function POST(request: Request) {
  try {
    if (!demoEndpointsEnabled()) return demoDisabled();

    const { orderId, path } = await parse(request, schema);
    const { protocol } = getRuntime();

    let dossier = await protocol.dossier(orderId);
    let waiting = false;

    switch (dossier.order.state) {
      case "ESCROWED": {
        const delivery = path === "SUCCESS" ? GOOD_DELIVERY : SHORT_DELIVERY;
        dossier = await protocol.submitDelivery({
          orderId,
          statement: delivery.statement,
          artifactUrl: delivery.artifactUrl,
          artifactHash: delivery.artifactHash,
          assertions: { ...delivery.assertions },
          evidence: delivery.evidence.map((item) => ({ ...item })),
        });
        break;
      }
      case "VERIFICATION_PENDING": {
        // Only reachable when verification found a mandatory breach.
        dossier = await protocol.openDispute({ orderId, claim: BUYER_CLAIM });
        break;
      }
      case "DISPUTED": {
        const disputeId = dossier.dispute?.id;
        if (disputeId) dossier = await protocol.submitAdjudication(disputeId);
        break;
      }
      case "ADJUDICATING": {
        const disputeId = dossier.dispute?.id;
        if (disputeId) {
          dossier = await protocol.pollAdjudication(disputeId);
          waiting = dossier.order.state === "ADJUDICATING";
        }
        break;
      }
      case "FULFILLED":
      case "BUYER_WON":
      case "MERCHANT_WON": {
        dossier = await protocol.settle(orderId);
        break;
      }
      default:
        break;
    }

    const done = ["RELEASED", "REFUNDED", "CANCELLED"].includes(dossier.order.state);
    return ok({ path, dossier: presentDossier(dossier), done, waiting });
  } catch (error) {
    return problem(error);
  }
}
