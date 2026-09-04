import { createHash } from "node:crypto";

/**
 * Request signing.
 *
 * Mirrors `server/auth.ts` exactly. If you change the canonical string here,
 * change it there — the two are a protocol, not an implementation detail, so
 * the format is documented rather than hidden behind a helper.
 *
 *   recourse-request-v1
 *   POST
 *   /api/orders/RC-000042/disputes
 *   1757000000000
 *   <sha256 of the raw body, hex>
 */

export const SIGNING_PREFIX = "recourse-request-v1";

export const AUTH_HEADERS = {
  agent: "x-recourse-agent",
  timestamp: "x-recourse-timestamp",
  signature: "x-recourse-signature",
} as const;

/**
 * Signs the canonical request string.
 *
 * Compatible with any EIP-191 personal_sign signer: viem's
 * `account.signMessage`, ethers' `wallet.signMessage`, or a browser wallet's
 * `personal_sign`. Recourse never sees your private key.
 */
export type MessageSigner = (message: string) => Promise<string>;

export interface AgentSigner {
  /** The agent handle this key speaks for, e.g. "shopper.agent". */
  handle: string;
  sign: MessageSigner;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input ?? "").digest("hex");
}

export function canonicalRequest(input: {
  method: string;
  path: string;
  timestamp: string;
  body: string;
}): string {
  return [
    SIGNING_PREFIX,
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    sha256Hex(input.body),
  ].join("\n");
}

/** Produces the three headers a signed Recourse request carries. */
export async function signRequest(
  signer: AgentSigner,
  input: { method: string; path: string; body: string },
): Promise<Record<string, string>> {
  const timestamp = String(Date.now());
  const message = canonicalRequest({ ...input, timestamp });
  const signature = await signer.sign(message);

  return {
    [AUTH_HEADERS.agent]: signer.handle,
    [AUTH_HEADERS.timestamp]: timestamp,
    [AUTH_HEADERS.signature]: signature,
  };
}
