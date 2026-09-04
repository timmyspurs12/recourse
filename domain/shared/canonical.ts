import { createHash } from "node:crypto";

/**
 * Canonicalisation.
 *
 * An agreement is only meaningful if both parties can independently derive the
 * same hash from it. That requires a canonical byte representation: object keys
 * sorted, no insignificant whitespace, arrays order-preserving, and no
 * floating-point ambiguity (amounts are strings by construction).
 *
 * This is JCS-style (RFC 8785) canonicalisation restricted to the JSON subset
 * the protocol actually uses.
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export function canonicalize(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Non-finite numbers cannot be canonicalised");
    }
    // Integers only inside agreements; anything fractional must be a string.
    if (!Number.isInteger(value)) {
      throw new TypeError(
        `Fractional number ${value} cannot be canonicalised — use a decimal string`,
      );
    }
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as Json)}`)
    .join(",");
  return `{${body}}`;
}

export function sha256Hex(input: string | Uint8Array): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

/** Canonical hash of any protocol document. */
export function documentHash(value: Json): string {
  return sha256Hex(canonicalize(value));
}

/** Constant-time-ish equality for hash comparison. */
export function hashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
