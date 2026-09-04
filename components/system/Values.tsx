import { cx, formatMoney, formatTimestamp } from "@/lib/format";
import type { Money } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Amount                                                              */
/* ------------------------------------------------------------------ */

export function Amount({
  money,
  size = "md",
  tone = "default",
  className,
}: {
  money: Money;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "default" | "muted" | "pass" | "protected" | "breach";
  className?: string;
}) {
  const sizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-2xl",
    xl: "text-3xl sm:text-4xl",
  } as const;
  const tones = {
    default: "text-fg",
    muted: "text-fg-muted",
    pass: "text-pass",
    protected: "text-protected",
    breach: "text-breach",
  } as const;
  const [value, currency] = formatMoney(money).split(" ");
  return (
    <span className={cx("font-mono tnum whitespace-nowrap", sizes[size], tones[tone], className)}>
      {value}
      <span className={cx("ml-1.5 tracking-[0.08em]", size === "xl" || size === "lg" ? "text-[0.5em] text-fg-dim" : "text-[0.85em] text-fg-dim")}>
        {currency}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Timestamp — deterministic UTC, safe for SSR hydration               */
/* ------------------------------------------------------------------ */

export function Timestamp({
  iso,
  seconds = false,
  className,
  prefix,
}: {
  iso: string;
  seconds?: boolean;
  className?: string;
  prefix?: string;
}) {
  return (
    <time
      dateTime={iso}
      className={cx("font-mono tnum text-xs text-fg-muted whitespace-nowrap", className)}
    >
      {prefix ? <span className="text-fg-faint">{prefix} </span> : null}
      {formatTimestamp(iso, { seconds })}
    </time>
  );
}

/* ------------------------------------------------------------------ */
/* Mono value                                                          */
/* ------------------------------------------------------------------ */

export function MonoValue({
  children,
  className,
  tone = "default",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "muted" | "dim";
}) {
  const tones = {
    default: "text-fg",
    muted: "text-fg-muted",
    dim: "text-fg-dim",
  } as const;
  return (
    <span className={cx("font-mono tnum text-sm break-words", tones[tone], className)}>
      {children}
    </span>
  );
}
