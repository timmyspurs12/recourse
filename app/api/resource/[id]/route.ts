import { getRuntime } from "@/server/runtime";
import { problem } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/resource/:orderId — the x402 handshake, for real.
 *
 * Until the protected purchase is funded this returns 402 Payment Required
 * with a PAYMENT-REQUIRED header carrying base64 PaymentRequirements, exactly
 * as an x402 resource server does. Once escrow is held, the resource is served.
 *
 * This is the seam where Recourse wraps x402: the requirements advertised here
 * name the protocol escrow as payTo, so the payment arrives already bound to an
 * agreement rather than landing directly with the merchant.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { protocol, rail } = getRuntime();
    const order = await protocol.getOrder(id);

    if (!order) {
      return Response.json(
        { error: { code: "ORDER_NOT_FOUND", message: `No protected transaction ${id}` } },
        { status: 404 },
      );
    }

    const funded = !["OFFERED", "ACCEPTED"].includes(order.state);
    if (funded) {
      const delivery = await protocol.getDelivery(id);
      return Response.json({
        orderId: order.id,
        resource: order.resource,
        protectedBy: "recourse/0.1",
        delivered: Boolean(delivery),
        artifactUrl: delivery?.artifactUrl ?? null,
      });
    }

    const requirements = rail.quote({
      orderId: order.id,
      amount: order.amount,
      resourceName: order.resource.name,
      resourceUrl: `/api/resource/${order.id}`,
    });

    const accepts = [requirements];
    return Response.json(
      { x402Version: 2, accepts, error: "payment_required" },
      {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2, accepts })).toString("base64"),
        },
      },
    );
  } catch (error) {
    return problem(error);
  }
}
