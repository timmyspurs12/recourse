import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { keccak256, toHex } from "viem";
import { EIP3009_TYPES, eip712Domain, type X402Config } from "./rail";
import type { PaymentAuthorization, PaymentRequirementsQuote } from "../../domain/ports";

/**
 * Buyer-side x402 signer.
 *
 * Produces a genuine EIP-712 signature over an EIP-3009
 * TransferWithAuthorization, which is exactly what an x402 "exact" scheme
 * client sends. The Recourse resource server verifies it by recovering the
 * signer — so an invalid or replayed authorization is rejected by cryptography,
 * not by a flag.
 */
export interface SignerOptions {
  config: X402Config;
  privateKey?: `0x${string}`;
  validForSeconds?: number;
}

export async function signPaymentAuthorization(
  requirements: PaymentRequirementsQuote,
  options: SignerOptions,
): Promise<{ authorization: PaymentAuthorization; payer: `0x${string}` }> {
  const account = privateKeyToAccount(options.privateKey ?? generatePrivateKey());
  const now = Math.floor(Date.now() / 1000);
  const validAfter = `${now - 60}`;
  const validBefore = `${now + (options.validForSeconds ?? requirements.maxTimeoutSeconds ?? 300)}`;
  const nonce = keccak256(toHex(`${requirements.payTo}:${requirements.amount}:${now}:${Math.random()}`));

  const message = {
    from: account.address,
    to: requirements.payTo as `0x${string}`,
    value: BigInt(requirements.amount),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce,
  };

  const signature = await account.signTypedData({
    domain: eip712Domain(options.config),
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });

  return {
    payer: account.address,
    authorization: {
      scheme: requirements.scheme,
      network: requirements.network,
      payload: {
        authorization: {
          from: account.address,
          to: requirements.payTo,
          value: requirements.amount,
          validAfter,
          validBefore,
          nonce,
        },
        signature,
      },
    },
  };
}

/** Encodes a payload for the x402 PAYMENT-SIGNATURE header. */
export function encodePaymentSignatureHeader(authorization: PaymentAuthorization): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      scheme: authorization.scheme,
      network: authorization.network,
      payload: authorization.payload,
    }),
  ).toString("base64");
}

export function decodePaymentSignatureHeader(header: string): PaymentAuthorization {
  const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8")) as {
    scheme: string;
    network: string;
    payload: Record<string, unknown>;
  };
  return { scheme: decoded.scheme, network: decoded.network, payload: decoded.payload };
}
