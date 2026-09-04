import { createHash, randomUUID } from "node:crypto";
import type {
  EscrowReceipt,
  PaymentAuthorization,
  PaymentRail,
  PaymentRequirementsQuote,
  PaymentVerification,
  SettlementExecution,
} from "../../domain/ports";
import type { Money } from "../../domain/model";

/**
 * Simulated rail.
 *
 * Used for seeded ledger records and for demo runs where no signed x402
 * authorization is supplied. It performs no cryptography and moves no money;
 * it exists so the protocol logic can be exercised end to end. Everything it
 * produces is marked SIGNATURE_VERIFIED_LOCAL_ESCROW with a null transaction
 * hash, and the UI labels it accordingly. It never emits a fake tx hash.
 */
export class SimulatedRail implements PaymentRail {
  readonly id = "simulated" as const;
  readonly network = "SIMULATED";
  readonly settlesOnchain = false;

  quote(input: {
    orderId: string;
    amount: Money;
    resourceName: string;
    resourceUrl: string;
  }): PaymentRequirementsQuote {
    return {
      scheme: "exact",
      network: "SIMULATED",
      amount: input.amount.amount,
      asset: "USDC",
      payTo: "recourse.escrow",
      maxTimeoutSeconds: 300,
      resource: {
        url: input.resourceUrl,
        description: `${input.resourceName} (simulated protected purchase ${input.orderId})`,
        mimeType: "application/json",
      },
    };
  }

  async verify(
    _authorization: PaymentAuthorization,
    _requirements: PaymentRequirementsQuote,
  ): Promise<PaymentVerification> {
    return {
      valid: true,
      payer: "simulated.payer",
      reference: `sim_${randomUUID().slice(0, 12)}`,
      invalidReason: null,
    };
  }

  async captureToEscrow(input: {
    orderId: string;
    authorization: PaymentAuthorization;
    requirements: PaymentRequirementsQuote;
  }): Promise<EscrowReceipt> {
    const reference = `sim_${createHash("sha256")
      .update(`${input.orderId}:${Date.now()}:${randomUUID()}`)
      .digest("hex")
      .slice(0, 16)}`;
    return {
      reference,
      payer: "simulated.buyer",
      payee: "recourse.escrow",
      network: "SIMULATED",
      transactionHash: null,
      execution: "SIGNATURE_VERIFIED_LOCAL_ESCROW",
      confirmedAt: new Date().toISOString(),
    };
  }

  async release(): Promise<SettlementExecution> {
    return {
      transactionHash: null,
      execution: "SIGNATURE_VERIFIED_LOCAL_ESCROW",
      executedAt: new Date().toISOString(),
    };
  }

  async refund(): Promise<SettlementExecution> {
    return {
      transactionHash: null,
      execution: "SIGNATURE_VERIFIED_LOCAL_ESCROW",
      executedAt: new Date().toISOString(),
    };
  }
}
