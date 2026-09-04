import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 border font-mono uppercase tracking-[0.14em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";

const variants: Record<Variant, string> = {
  primary:
    "border-fg bg-fg text-canvas hover:bg-white hover:border-white active:bg-fg-muted",
  secondary:
    "border-line-strong bg-transparent text-fg hover:border-fg-muted hover:bg-raised",
  ghost: "border-transparent bg-transparent text-fg-muted hover:text-fg hover:border-line",
  danger: "border-breach/40 bg-breach-dim text-breach hover:border-breach/70",
};

const sizes: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-[10px]",
  md: "px-4 py-2.5 text-[11px]",
  lg: "px-5 py-3.5 text-[12px]",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cx(base, variants[variant], sizes[size], className);
}

export function ActionButton({
  children,
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button className={buttonClass(variant, size, className)} {...props}>
      {children}
    </button>
  );
}

export function ActionLink({
  children,
  href,
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}

/** Inline text link with the protocol underline treatment. */
export function TextLink({
  children,
  href,
  className,
  ...props
}: ComponentProps<typeof Link> & { children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        "underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-fg-muted hover:text-fg",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
