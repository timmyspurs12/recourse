/**
 * Rate limiting.
 *
 * Adjudication costs real network resources: every submission is a transaction
 * that multiple validators execute with a model in the loop. An endpoint that
 * expensive must not be free to hammer.
 *
 * This is a fixed-window counter held in process memory. That is honest about
 * its limits: it protects a single instance, not a cluster. A multi-instance
 * deployment needs the same policy in Redis or at the edge — the interface here
 * is deliberately narrow so swapping the backing store is a small change.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitPolicy {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export const POLICIES = {
  /** Submitting a dispute to the forum: expensive, network-bound. */
  adjudication: { limit: 10, windowMs: 60_000 },
  /** Starting a demo run: cheap, but it writes to the shared ledger. */
  demoRun: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

export function rateLimit(key: string, policy: RateLimitPolicy): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + policy.windowMs });
    return { allowed: true, remaining: policy.limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= policy.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: policy.limit - existing.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Best-effort client identity.
 *
 * There is no authentication yet, so this is an IP heuristic and nothing more.
 * It slows down accidental loops and casual abuse; it does not stop a
 * determined attacker, and it is not presented as if it does.
 */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}`;
}

/** Clears all windows. Tests only. */
export function resetRateLimits(): void {
  windows.clear();
}
