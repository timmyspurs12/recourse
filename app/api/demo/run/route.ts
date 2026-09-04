import { z } from "zod";
import { getRuntime } from "@/server/runtime";
import { presentDossier } from "@/server/presenter";
import { demoDisabled, demoEndpointsEnabled, ok, parse, problem, tooManyRequests } from "@/server/http";
import { clientKey, POLICIES, rateLimit } from "@/server/rate-limit";
import { AGENTS, BRIEF, BRIEF_TERMS } from "@/server/scenario";
import { signPaymentAuthorization } from "@/integrations/x402/signer";
import { loadX402Config } from "@/integrations/x402/rail";

export const dynamic = "force-dynamic";

const schema = z.object({ path: z.enum(["SUCCESS", "DISPUTE"]) });

/**
 * POST /api/demo/run — start a live protected purchase.
 *
 * This creates a real order in the real ledger through the real state machine.
 * The demo page then advances it one legal step at a time; nothing about the
 * lifecycle is animated or pre-recorded.
 */
export async function POST(request: Request) {
  try {
    if (!demoEndpointsEnabled()) return demoDisabled();

    const limit = rateLimit(clientKey(request, "demo"), POLICIES.demoRun);
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

    const { path } = await parse(request, schema);
    const { protocol, rail } = getRuntime();

    // Create the order unfunded so the demo exercises the real x402 handshake.
    let dossier = await protocol.createProtectedPurchase({
      buyer: { handle: AGENTS.shopper.handle, operator: AGENTS.shopper.operator },
      merchant: { handle: AGENTS.merchant.handle, operator: AGENTS.merchant.operator },
      resource: { name: BRIEF.name, type: BRIEF.type },
      amount: BRIEF.price,
      terms: BRIEF_TERMS,
      origin: "LIVE_RUN",
      deferFunding: true,
    });

    const orderId = dossier.order.id;

    /*
     * The demo buyer signs for real.
     *
     * A judge should not need a wallet, so the demo generates an ephemeral key
     * and produces a genuine EIP-712 signature over an EIP-3009
     * TransferWithAuthorization. The server verifies it by recovering the
     * signer — the same code path a real buyer agent would hit. What the demo
     * does NOT do is broadcast it, and the UI says so.
     */
    if (rail.id === "x402") {
      const requirements = rail.quote({
        orderId,
        amount: dossier.order.amount,
        resourceName: dossier.order.resource.name,
        resourceUrl: `/api/resource/${orderId}`,
      });
      const { authorization } = await signPaymentAuthorization(requirements, {
        config: loadX402Config(),
      });
      dossier = await protocol.capturePayment(orderId, authorization);
    } else {
      dossier = await protocol.capturePayment(orderId);
    }

    return ok({ path, dossier: presentDossier(dossier), done: false, waiting: false }, 201);
  } catch (error) {
    return problem(error);
  }
}
