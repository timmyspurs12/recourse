import type { ReactNode } from "react";
import { cx } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Panel — the single container primitive used across the app          */
/* ------------------------------------------------------------------ */

export function Panel({
  children,
  className,
  as: Tag = "section",
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
  tone?: "default" | "raised" | "quiet";
}) {
  const toneClass =
    tone === "raised" ? "bg-raised" : tone === "quiet" ? "bg-surface" : "bg-panel";
  return (
    <Tag className={cx("border border-line", toneClass, className)}>{children}</Tag>
  );
}

export function PanelHeader({
  title,
  meta,
  actions,
  className,
  id,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={id} className="mono-label text-fg">
          {title}
        </h2>
        {meta ? <span className="mono-label text-fg-faint">{meta}</span> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cx(padded && "px-4 py-4 sm:px-5 sm:py-5", className)}>{children}</div>
  );
}

/* ------------------------------------------------------------------ */
/* Field — label over value, the core data-display unit                */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="mono-label">{label}</div>
      <div className="mt-1.5 text-sm text-fg">{children}</div>
      {hint ? <div className="mt-1 text-xs leading-relaxed text-fg-dim">{hint}</div> : null}
    </div>
  );
}

export function FieldGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <div className={cx("grid grid-cols-1 gap-x-6 gap-y-5", cols, className)}>{children}</div>
  );
}

/* ------------------------------------------------------------------ */
/* Section — page-level rhythm                                         */
/* ------------------------------------------------------------------ */

export function SectionLabel({
  index,
  children,
  className,
}: {
  index?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center gap-3", className)}>
      {index ? <span className="mono-label text-fg-faint">{index}</span> : null}
      <span className="mono-label text-fg-muted">{children}</span>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  );
}
