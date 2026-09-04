import { z } from "zod";
import { getRuntime } from "@/server/runtime";
import { ok, problem, readSigned } from "@/server/http";
import { decodePaymentSignatureHeader } from "@/integrations/x402/signer";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    scheme: z.string().optional(),
    network: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

/**
 * POST /api/orders/:id/payment — fund an accepted order.
 *
 * Accepts either an x402 PAYMENT-SIGNATURE header (the real wire format) or an
 * equivalent JSON body. The signature is verified by recovering the EIP-712
 * signer; only then is the agreement locked and escrow created.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const header = request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("payment-signature");
    const { data: body } = await readSigned(request, schema);

    const authorization = header
      ? decodePaymentSignatureHeader(header)
      : body?.payload
        ? { scheme: body.scheme ?? "exact", network: body.network ?? "", payload: body.payload }
        : undefined;

    const { protocol } = getRuntime();
    const dossier = await protocol.capturePayment(id, authorization);

    return ok(dossier, 201);
  } catch (error) {
    return problem(error);
  }
}
