import { createHash } from "node:crypto";
import { recoverMessageAddress } from "viem";
import type { Actor } from "../domain/identity/authorization";
import type { RecourseStore } from "../domain/ports";
import { fail } from "../domain/shared/errors";

/**
 * Agent request authentication.
 *
 * An agent proves who it is by signing a canonical description of the request
 * with its key. The server recovers the signer and compares it to the address
 * bound to that handle. There is no shared secret, no bearer token to leak, and
 * no way to act as another agent without its private key.
 *
 * Canonical signing string (newline separated, exactly this order):
 *
 *   recourse-request-v1
 *   POST
 *   /api/orders/RC-000042/disputes
 *   1757000000000
 *   <sha256 of the raw request body, hex>
 *
 * Headers:
 *
 *   x-recourse-agent:     shopper.agent
 *   x-recourse-timestamp: 1757000000000
 *   x-recourse-signature: 0x…
 *
 * KEY BINDING has two modes, and the deployment chooses:
 *
 *   REGISTERED — an operator declared the handle→key pair ahead of time
 *                (`npm run agents:register`). Nothing is taken on trust.
 *   TOFU       — the first signed request from an unknown handle binds it.
 *                Convenient, and honest about what it gives you: it does not
 *                establish who an agent is in the world, only that whoever
 *                arrived first is the only party who can keep acting as that
 *                handle.
 *
 * Set RECOURSE_STRICT_REGISTRY=1 to disable TOFU entirely, after which an
 * unregistered handle is simply refused. Bindings are persisted with the
 * ledger, so they survive a restart. A DID resolver would slot in behind
 * `AgentDirectory` without changing anything above it.
 */

export const AUTH_HEADERS = {
  agent: "x-recourse-agent",
  timestamp: "x-recourse-timestamp",
  signature: "x-recourse-signature",
} as const;

export const SIGNING_PREFIX = "recourse-request-v1";

/** Requests older than this are refused, which bounds the replay window. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function bodyDigest(body: string): string {
  return createHash("sha256").update(body ?? "").digest("hex");
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
    bodyDigest(input.body),
  ].join("\n");
}

/* --------------------------------------------------------------- directory */

export interface AgentDirectory {
  lookup(handle: string): Promise<string | null>;
  bind(handle: string, address: string, source?: "REGISTERED" | "TOFU"): Promise<void>;
}

/** Durable directory backed by the protocol store. */
export class StoreAgentDirectory implements AgentDirectory {
  constructor(private readonly store: RecourseStore) {}

  async lookup(handle: string): Promise<string | null> {
    return (await this.store.getAgentBinding(handle))?.address ?? null;
  }

  async bind(handle: string, address: string, source: "REGISTERED" | "TOFU" = "TOFU"): Promise<void> {
    await this.store.putAgentBinding({
      handle,
      address: address.toLowerCase(),
      source,
      boundAt: new Date().toISOString(),
    });
  }
}

/** In-memory directory. Bindings last for the life of the process. Tests only. */
export class MemoryAgentDirectory implements AgentDirectory {
  private readonly bindings = new Map<string, string>();

  async lookup(handle: string): Promise<string | null> {
    return this.bindings.get(handle) ?? null;
  }

  async bind(
    handle: string,
    address: string,
    _source: "REGISTERED" | "TOFU" = "TOFU",
  ): Promise<void> {
    this.bindings.set(handle, address.toLowerCase());
  }

  /** Tests and seeds. */
  clear(): void {
    this.bindings.clear();
  }
}

/* ------------------------------------------------------------ replay guard */

const seenSignatures = new Map<string, number>();

function rememberSignature(signature: string, now: number): boolean {
  // Drop anything outside the skew window so the map cannot grow unbounded.
  for (const [key, at] of seenSignatures) {
    if (now - at > MAX_CLOCK_SKEW_MS) seenSignatures.delete(key);
  }
  if (seenSignatures.has(signature)) return false;
  seenSignatures.set(signature, now);
  return true;
}

export function resetReplayGuard(): void {
  seenSignatures.clear();
}

/* ------------------------------------------------------------ verification */

export function authRequired(): boolean {
  // Enforced unless an operator deliberately opens the deployment up.
  return process.env.RECOURSE_REQUIRE_AUTH !== "0";
}

/** When strict, an unregistered handle is refused rather than bound on sight. */
export function strictRegistry(): boolean {
  return process.env.RECOURSE_STRICT_REGISTRY === "1";
}

export interface VerifyInput {
  method: string;
  path: string;
  body: string;
  headers: Headers;
  directory: AgentDirectory;
  now?: number;
}

/**
 * Verifies a signed request.
 *
 * Returns the authenticated actor, or an unauthenticated one when the
 * deployment has authentication disabled and no signature was supplied. A
 * signature that is present is ALWAYS verified, even when auth is optional —
 * a half-checked credential is worse than none.
 */
export async function authenticate(input: VerifyInput): Promise<Actor | undefined> {
  const handle = input.headers.get(AUTH_HEADERS.agent);
  const timestamp = input.headers.get(AUTH_HEADERS.timestamp);
  const signature = input.headers.get(AUTH_HEADERS.signature);
  const now = input.now ?? Date.now();

  if (!handle && !signature) {
    if (authRequired()) {
      fail(
        "UNAUTHORIZED",
        "This endpoint requires a signed agent request. Set RECOURSE_REQUIRE_AUTH=0 to run an open deployment.",
        { headers: Object.values(AUTH_HEADERS) },
      );
    }
    return undefined;
  }

  if (!handle || !timestamp || !signature) {
    fail("UNAUTHORIZED", "A signed request needs agent, timestamp and signature headers", {
      headers: Object.values(AUTH_HEADERS),
    });
  }

  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt)) {
    fail("UNAUTHORIZED", "Timestamp header must be epoch milliseconds");
  }
  if (Math.abs(now - issuedAt) > MAX_CLOCK_SKEW_MS) {
    fail("UNAUTHORIZED", "Request timestamp is outside the accepted window", {
      skewMs: now - issuedAt,
      maxSkewMs: MAX_CLOCK_SKEW_MS,
    });
  }

  if (!rememberSignature(signature, now)) {
    fail("UNAUTHORIZED", "This signature has already been used");
  }

  const message = canonicalRequest({
    method: input.method,
    path: input.path,
    timestamp,
    body: input.body,
  });

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
  } catch (error) {
    fail("UNAUTHORIZED", "Signature could not be recovered", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  const bound = await input.directory.lookup(handle);
  if (!bound) {
    if (strictRegistry()) {
      fail(
        "UNAUTHORIZED",
        `${handle} is not a registered agent on this deployment`,
        { hint: "Register it with `npm run agents:register` before signing requests." },
      );
    }
    // Trust on first use: this key now owns this handle.
    await input.directory.bind(handle, recovered, "TOFU");
  } else if (bound.toLowerCase() !== recovered.toLowerCase()) {
    fail("UNAUTHORIZED", `Signature does not match the key bound to ${handle}`, {
      expected: bound,
      recovered,
    });
  }

  return { handle, address: recovered, authenticated: true };
}
