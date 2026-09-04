import { NextResponse } from "next/server";
import { z } from "zod";
import { RecourseDomainError } from "@/domain/shared/errors";
import type { Actor } from "@/domain/identity/authorization";
import { authenticate } from "@/server/auth";
import { getRuntime } from "@/server/runtime";

/**
 * HTTP boundary helpers.
 *
 * Domain errors carry their own protocol-specific code and status, so routes
 * never invent a generic 500. A client always learns which invariant it hit.
 */

export function ok<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Duck-typed rather than `instanceof`: bundlers can load the error class from
 * more than one module instance, and a mis-identified domain error would leak
 * a 500 where the client deserves a precise protocol code.
 */
function asDomainError(error: unknown): RecourseDomainError | null {
  if (error instanceof RecourseDomainError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "status" in error &&
    (error as { name?: string }).name === "RecourseDomainError"
  ) {
    return error as RecourseDomainError;
  }
  return null;
}

/**
 * The demo endpoints act as the protocol itself, so they bypass agent
 * authentication. That is what lets a judge run the full flow with no keys —
 * and exactly why a real deployment turns them off.
 */
export function demoEndpointsEnabled(): boolean {
  return process.env.RECOURSE_DEMO_ENDPOINTS !== "0";
}

export function demoDisabled() {
  return NextResponse.json(
    {
      error: {
        code: "NOT_FOUND",
        message:
          "Demo endpoints are disabled on this deployment. Use the signed API with @recourse/sdk.",
        detail: null,
      },
    },
    { status: 404 },
  );
}

/** 429 with a Retry-After the client can actually act on. */
export function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: `Too many requests. Retry in ${retryAfterSeconds}s.`,
        detail: { retryAfterSeconds },
      },
    },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

export function problem(error: unknown) {
  const domainError = asDomainError(error);
  if (domainError) {
    return NextResponse.json(
      {
        error: {
          code: domainError.code,
          message: domainError.message,
          detail: domainError.detail ?? null,
        },
      },
      { status: domainError.status },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Request body failed validation",
          detail: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 422 },
    );
  }
  console.error("[recourse] unhandled error", error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL",
        message: error instanceof Error ? error.message : "Unexpected protocol error",
        detail: null,
      },
    },
    { status: 500 },
  );
}

export async function parse<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return schema.parse(body);
}

/**
 * Reads a mutating request: verify the signature over the raw bytes first,
 * then parse. The body has to be consumed exactly once, and the digest must
 * cover what was actually sent rather than a re-serialised copy of it.
 */
export async function readSigned<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ actor: Actor | undefined; data: z.infer<T> }> {
  const raw = await request.text();
  const { directory } = getRuntime();

  const actor = await authenticate({
    method: request.method,
    path: new URL(request.url).pathname,
    body: raw,
    headers: request.headers,
    directory,
  });

  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }
  return { actor, data: schema.parse(body) };
}

/** Same, for mutating routes that take no body. */
export async function authorizeOnly(request: Request): Promise<Actor | undefined> {
  const raw = await request.text();
  const { directory } = getRuntime();
  return authenticate({
    method: request.method,
    path: new URL(request.url).pathname,
    body: raw,
    headers: request.headers,
    directory,
  });
}

/* ------------------------------------------------------------- schemas */

export const agentSchema = z.object({
  handle: z.string().regex(/^[a-z0-9.-]+$/, "Expected an agent handle, e.g. shopper.agent"),
  operator: z.string().max(120).optional(),
  address: z.string().max(120).optional(),
});

export const termSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  operator: z.enum(["GTE", "LTE", "EQ", "MATCH", "JUDGMENT"]),
  expected: z.union([z.string().max(500), z.number()]),
  unit: z.string().max(20).optional(),
  mandatory: z.boolean(),
  evaluation: z.enum(["DETERMINISTIC", "SEMANTIC"]),
  description: z.string().max(400).optional(),
});

export const createPurchaseSchema = z.object({
  buyer: agentSchema,
  merchant: agentSchema,
  resource: z.object({ name: z.string().min(2).max(200), type: z.string().min(2).max(60) }),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, "Expected a decimal amount, e.g. 1.00"),
  currency: z.literal("USDC").optional(),
  terms: z.array(termSchema).min(1).max(32),
  deliveryDeadlineHours: z.number().int().positive().max(8760).optional(),
  /** Stop at ACCEPTED and require a separate x402 payment call. */
  deferFunding: z.boolean().optional(),
  recourseWindowHours: z.number().int().positive().max(8760).optional(),
  payment: z
    .object({
      scheme: z.string(),
      network: z.string(),
      payload: z.record(z.string(), z.unknown()),
    })
    .optional(),
});

export const submitDeliverySchema = z.object({
  statement: z.string().min(1).max(2000),
  artifactUrl: z.string().url().max(2000).nullable().optional(),
  artifactHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte hex digest"),
  assertions: z.object({
    sourceCount: z.number().int().min(0).max(100000),
    geography: z.string().max(120),
    sectionCount: z.number().int().min(0).max(1000),
    maxSourceAgeDays: z.number().int().min(0).max(100000),
    format: z.string().max(40),
    summary: z.string().max(4000),
  }),
  evidence: z
    .array(
      z.object({
        kind: z.string().max(60),
        source: z.string().max(400),
        sourceAgeDays: z.number().int().min(0).max(100000).nullable().optional(),
      }),
    )
    .max(64),
});

export const openDisputeSchema = z.object({
  claim: z.string().min(10).max(1200),
  contestedTermIds: z.array(z.string().max(60)).max(32).optional(),
  openedBy: z.enum(["BUYER", "MERCHANT"]).optional(),
});
