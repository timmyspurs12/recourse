import { cx } from "@/lib/format";
import type { Agent } from "@/lib/types";

/**
 * Agents are identified by handle first — the machine identity is the
 * primary key, the human label is secondary.
 */
export function AgentIdentity({
  agent,
  role,
  size = "md",
  showOperator = false,
  className,
}: {
  agent: Agent;
  /** Overrides the role label, e.g. "BUYER" instead of "SHOPPER". */
  role?: string;
  size?: "sm" | "md" | "lg";
  showOperator?: boolean;
  className?: string;
}) {
  const roleLabel = role ?? agent.role;
  const initial = agent.handle.slice(0, 2).toUpperCase();

  const avatarSize = size === "lg" ? "size-9" : size === "sm" ? "size-6" : "size-8";
  const handleSize = size === "lg" ? "text-base" : size === "sm" ? "text-xs" : "text-sm";

  return (
    <div className={cx("flex min-w-0 items-center gap-3", className)}>
      <span
        aria-hidden
        className={cx(
          "grid shrink-0 place-items-center border border-line-strong bg-raised font-mono text-[10px] tracking-[0.08em] text-fg-dim",
          avatarSize,
        )}
      >
        {initial}
      </span>
      <span className="min-w-0">
        <span className="mono-label block">{roleLabel}</span>
        <span className={cx("mt-1 block truncate font-mono text-fg", handleSize)}>
          {agent.handle}
        </span>
        {showOperator && agent.operator ? (
          <span className="mt-1 block truncate text-xs text-fg-dim">{agent.operator}</span>
        ) : null}
      </span>
    </div>
  );
}

/** Compact buyer → merchant pairing used in ledgers and headers. */
export function AgentPair({
  buyer,
  merchant,
  className,
}: {
  buyer: Agent;
  merchant: Agent;
  className?: string;
}) {
  return (
    <div className={cx("flex min-w-0 items-center gap-2 font-mono text-xs", className)}>
      <span className="truncate text-fg-muted">{buyer.handle}</span>
      <span className="shrink-0 text-fg-faint" aria-hidden>
        →
      </span>
      <span className="truncate text-fg-muted">{merchant.handle}</span>
    </div>
  );
}
