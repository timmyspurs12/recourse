import { z } from "zod";
import { getRuntime } from "@/server/runtime";
import { presentDossier } from "@/server/presenter";
import { demoDisabled, demoEndpointsEnabled, ok, parse, problem } from "@/server/http";
import {
  BUYER_CLAIM,
  GOOD_DELIVERY,
  PARTIAL_CLAIM,
  PARTIAL_DELIVERY,
  SHORT_DELIVERY,
} from "@/server/scenario";

export const dynamic = "force-dynamic";

const schema = z.object({
  orderId: z.string().min(3),
  path: z.enum(["SUCCESS", "DISPUTE", "PARTIAL"]),
});

/**
 * POST /api/demo/advance — take the next legal step for a demo order.
 *
 * The server decides what "next" means by reading actual order state, so the
 * client cannot skip, reorder or invent a stage. When GenLayer has not reached
 * consensus yet the response says `waiting: true` and the state does not move.
 *
 * v0.2: a provisional ruling is a wait too. The demo keeps polling through
 * PROVISIONAL_RULING (and APPEALED, if someone appeals) until GenLayer
 * finalizes the ruling, and only then settles.
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
        const delivery =
          path === "SUCCESS" ? GOOD_DELIVERY : path === "PARTIAL" ? PARTIAL_DELIVERY : SHORT_DELIVERY;
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
        dossier = await protocol.openDispute({
          orderId,
          claim: path === "PARTIAL" ? PARTIAL_CLAIM : BUYER_CLAIM,
        });
        break;
      }
      case "DISPUTED": {
        const disputeId = dossier.dispute?.id;
        if (disputeId) dossier = await protocol.submitAdjudication(disputeId);
        break;
      }
      case "ADJUDICATING":
      case "PROVISIONAL_RULING":
      case "APPEALED": {
        const disputeId = dossier.dispute?.id;
        if (disputeId) {
          dossier = await protocol.pollAdjudication(disputeId);
          // Consensus, a finality window and an appeal round are all waits:
          // nothing settles until the ruling is final.
          waiting = ["ADJUDICATING", "PROVISIONAL_RULING", "APPEALED"].includes(dossier.order.state);
        }
        break;
      }
      case "FULFILLED":
      case "BUYER_WON":
      case "MERCHANT_WON":
      case "SPLIT_AWARDED": {
        dossier = await protocol.settle(orderId);
        break;
      }
      default:
        break;
    }

    const done = ["RELEASED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"].includes(dossier.order.state);
    return ok({ path, dossier: presentDossier(dossier), done, waiting });
  } catch (error) {
    return problem(error);
  }
}
