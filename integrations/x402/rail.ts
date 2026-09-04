import { recoverTypedDataAddress, isAddress, keccak256, toHex } from "viem";
import type {
  EscrowReceipt,
  PaymentAuthorization,
  PaymentRail,
  PaymentRequirementsQuote,
  PaymentVerification,
  SettlementExecution,
} from "../../domain/ports";
import type { Money } from "../../domain/model";
import { fail } from "../../domain/shared/errors";

/**
 * x402 payment rail.
 *
 * WHAT IS REAL HERE
 * -----------------
 * The message shapes are the x402 v2 "exact" scheme: PaymentRequirements as a
 * server would advertise them in a 402 response, and a PaymentPayload carrying
 * an EIP-3009 `TransferWithAuthorization` signed with EIP-712 typed data. The
 * signature check is real cryptography — we recover the signer and compare it
 * to the declared payer, and we reject reused nonces, wrong amounts, wrong
 * recipients and expired authorizations.
 *
 * WHAT IS NOT REAL HERE
 * ---------------------
 * Broadcasting. Moving USDC on Base requires a funded facilitator and a funded
 * buyer wallet, which this build does not have and does not pretend to have.
 * Unless X402_FACILITATOR_URL is configured, settlement is recorded with
 * execution = SIGNATURE_VERIFIED_LOCAL_ESCROW and a null transaction hash, and
 * every surface that displays it says so. There are no invented tx hashes.
 *
 * Escrow note: x402's exact scheme pays a single `payTo`. Recourse therefore
 * advertises the protocol escrow address as `payTo`, and release/refund are
 * separate transfers out of escrow after the promise resolves.
 */

const USDC_DECIMALS = 6;

export interface X402Config {
  network: string;
  chainId: number;
  assetAddress: `0x${string}`;
  assetName: string;
  assetVersion: string;
  escrowAddress: `0x${string}`;
  facilitatorUrl: string | null;
  maxTimeoutSeconds: number;
}

export function loadX402Config(): X402Config {
  return {
    // Base Sepolia by default: the network x402 testing standardised on.
    network: process.env.X402_NETWORK ?? "eip155:84532",
    chainId: Number(process.env.X402_CHAIN_ID ?? 84532),
    assetAddress: (process.env.X402_ASSET_ADDRESS ??
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`,
    assetName: process.env.X402_ASSET_NAME ?? "USDC",
    assetVersion: process.env.X402_ASSET_VERSION ?? "2",
    /*
     * Placeholder escrow address. It is deliberately recognisable as one
     * rather than a plausible-looking wallet: a real deployment must set
     * X402_ESCROW_ADDRESS to an address it actually controls.
     */
    escrowAddress: (process.env.X402_ESCROW_ADDRESS ??
      "0x0000000000000000000000000000000000000402") as `0x${string}`,
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? null,
    maxTimeoutSeconds: Number(process.env.X402_MAX_TIMEOUT_SECONDS ?? 300),
  };
}

/** Decimal string → atomic units, without floating point. */
export function toAtomic(amount: string, decimals = USDC_DECIMALS): string {
  const [whole, fraction = ""] = amount.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return `${BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0")}`;
}

export function fromAtomic(value: string, decimals = USDC_DECIMALS): string {
  const raw = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function eip712Domain(config: X402Config) {
  return {
    name: config.assetName,
    version: config.assetVersion,
    chainId: config.chainId,
    verifyingContract: config.assetAddress,
  } as const;
}

export class X402Rail implements PaymentRail {
  readonly id = "x402" as const;
  private readonly config: X402Config;
  private readonly seenNonces = new Set<string>();

  constructor(config: X402Config = loadX402Config()) {
    this.config = config;
  }

  get network(): string {
    return this.config.network;
  }

  get settlesOnchain(): boolean {
    return Boolean(this.config.facilitatorUrl);
  }

  quote(input: {
    orderId: string;
    amount: Money;
    resourceName: string;
    resourceUrl: string;
  }): PaymentRequirementsQuote {
    return {
      scheme: "exact",
      network: this.config.network,
      amount: toAtomic(input.amount.amount),
      asset: this.config.assetAddress,
      payTo: this.config.escrowAddress,
      maxTimeoutSeconds: this.config.maxTimeoutSeconds,
      resource: {
        url: input.resourceUrl,
        description: `${input.resourceName} (Recourse protected purchase ${input.orderId})`,
        mimeType: "application/json",
      },
      extra: { name: this.config.assetName, version: this.config.assetVersion },
    };
  }

  async verify(
    authorization: PaymentAuthorization,
    requirements: PaymentRequirementsQuote,
  ): Promise<PaymentVerification> {
    const payload = authorization.payload as {
      authorization?: Eip3009Authorization;
      signature?: `0x${string}`;
    };
    const auth = payload.authorization;
    const signature = payload.signature;

    const invalid = (reason: string): PaymentVerification => ({
      valid: false,
      payer: auth?.from ?? null,
      reference: auth?.nonce ?? "",
      invalidReason: reason,
    });

    if (!auth || !signature) return invalid("payload must contain authorization and signature");
    if (!isAddress(auth.from)) return invalid("authorization.from is not an address");
    if (!isAddress(auth.to)) return invalid("authorization.to is not an address");
    if (authorization.scheme !== requirements.scheme) return invalid("scheme mismatch");
    if (authorization.network !== requirements.network) return invalid("network mismatch");

    if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return invalid("authorization pays the wrong recipient");
    }
    if (BigInt(auth.value) !== BigInt(requirements.amount)) {
      return invalid(
        `authorization amount ${auth.value} does not equal required ${requirements.amount}`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (Number(auth.validAfter) > now) return invalid("authorization is not yet valid");
    if (Number(auth.validBefore) <= now) return invalid("authorization has expired");

    if (this.seenNonces.has(auth.nonce.toLowerCase())) {
      return invalid("authorization nonce has already been used");
    }

    let recovered: string;
    try {
      recovered = await recoverTypedDataAddress({
        domain: eip712Domain(this.config),
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: auth.from as `0x${string}`,
          to: auth.to as `0x${string}`,
          value: BigInt(auth.value),
          validAfter: BigInt(auth.validAfter),
          validBefore: BigInt(auth.validBefore),
          nonce: auth.nonce,
        },
        signature,
      });
    } catch (error) {
      return invalid(
        `signature could not be recovered: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    if (recovered.toLowerCase() !== auth.from.toLowerCase()) {
      return invalid("signature does not match the declared payer");
    }

    return { valid: true, payer: auth.from, reference: auth.nonce, invalidReason: null };
  }

  async captureToEscrow(input: {
    orderId: string;
    authorization: PaymentAuthorization;
    requirements: PaymentRequirementsQuote;
  }): Promise<EscrowReceipt> {
    const verification = await this.verify(input.authorization, input.requirements);
    if (!verification.valid || !verification.payer) {
      const reason = verification.invalidReason ?? "payment authorization is invalid";
      // A reused nonce is a replay, not a malformed payment. Say which.
      if (reason.includes("already been used")) fail("PAYMENT_REPLAYED", reason);
      fail("PAYMENT_INVALID", reason);
    }
    if (this.seenNonces.has(verification.reference.toLowerCase())) {
      fail("PAYMENT_REPLAYED", "This payment authorization has already been captured");
    }
    this.seenNonces.add(verification.reference.toLowerCase());

    if (this.config.facilitatorUrl) {
      const settled = await this.settleViaFacilitator(input.authorization, input.requirements);
      return {
        reference: verification.reference,
        payer: verification.payer,
        payee: input.requirements.payTo,
        network: this.config.network,
        transactionHash: settled.transactionHash,
        execution: "ONCHAIN",
        confirmedAt: new Date().toISOString(),
      };
    }

    return {
      reference: verification.reference,
      payer: verification.payer,
      payee: input.requirements.payTo,
      network: this.config.network,
      transactionHash: null,
      execution: "SIGNATURE_VERIFIED_LOCAL_ESCROW",
      confirmedAt: new Date().toISOString(),
    };
  }

  private async settleViaFacilitator(
    authorization: PaymentAuthorization,
    requirements: PaymentRequirementsQuote,
  ): Promise<{ transactionHash: string | null }> {
    const response = await fetch(`${this.config.facilitatorUrl}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        payload: authorization.payload,
        accepted: {
          scheme: requirements.scheme,
          network: requirements.network,
          amount: requirements.amount,
          asset: requirements.asset,
          payTo: requirements.payTo,
          maxTimeoutSeconds: requirements.maxTimeoutSeconds,
          extra: requirements.extra,
        },
        resource: requirements.resource,
      }),
    });

    if (!response.ok) {
      fail("PAYMENT_INVALID", `Facilitator rejected settlement with ${response.status}`);
    }
    const body = (await response.json()) as { success?: boolean; transaction?: string; errorReason?: string };
    if (!body.success) {
      fail("PAYMENT_INVALID", `Facilitator settlement failed: ${body.errorReason ?? "unknown"}`);
    }
    return { transactionHash: body.transaction ?? null };
  }

  /**
   * Escrow payout. On-chain payout requires a funded escrow signer; without one
   * this records the movement and labels its execution honestly rather than
   * inventing a transaction.
   */
  async release(input: { orderId: string; amount: Money; to: string }): Promise<SettlementExecution> {
    return this.payout(input);
  }

  async refund(input: { orderId: string; amount: Money; to: string }): Promise<SettlementExecution> {
    return this.payout(input);
  }

  private async payout(_input: {
    orderId: string;
    amount: Money;
    to: string;
  }): Promise<SettlementExecution> {
    return {
      transactionHash: null,
      execution: "SIGNATURE_VERIFIED_LOCAL_ESCROW",
      executedAt: new Date().toISOString(),
    };
  }

  /** Deterministic nonce helper for clients that need one. */
  static nonceFor(seed: string): `0x${string}` {
    return keccak256(toHex(seed));
  }
}
