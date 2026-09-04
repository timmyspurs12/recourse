import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import { Panel } from "@/components/system/Panel";

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  label,
  title,
  description,
  action,
  className,
}: {
  label: string;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-start gap-3 border border-dashed border-line px-5 py-8 sm:px-8 sm:py-12",
        className,
      )}
    >
      <span className="mono-label text-fg-faint">{label}</span>
      <h3 className="font-mono text-sm tracking-[0.08em] text-fg uppercase">{title}</h3>
      <p className="max-w-prose text-sm leading-relaxed text-fg-muted">{description}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Protocol-specific error state                                       */
/* ------------------------------------------------------------------ */

export function ProtocolErrorState({
  code,
  title,
  description,
  detail,
  action,
  className,
  tone = "breach",
}: {
  code?: string;
  title: string;
  description: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
  tone?: "breach" | "pending" | "neutral";
}) {
  const accent =
    tone === "breach" ? "border-l-breach" : tone === "pending" ? "border-l-pending" : "border-l-line-strong";
  return (
    <Panel className={cx("border-l-2", accent, className)}>
      <div className="px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-mono text-sm tracking-[0.12em] text-fg uppercase">{title}</h3>
          {code ? <span className="mono-label text-fg-faint">{code}</span> : null}
        </div>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-fg-muted">{description}</p>
        {detail ? (
          <p className="mt-3 max-w-prose border-t border-line pt-3 font-mono text-xs leading-relaxed text-fg-dim">
            {detail}
          </p>
        ) : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeletons                                                   */
/* ------------------------------------------------------------------ */

export function SkeletonLine({ width = "100%", className }: { width?: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width }}
      className={cx("block h-3 animate-pulse bg-raised", className)}
    />
  );
}

export function SkeletonPanel({
  lines = 3,
  label = "LOADING",
  className,
}: {
  lines?: number;
  label?: string;
  className?: string;
}) {
  return (
    <Panel className={cx("", className)}>
      <div className="border-b border-line px-5 py-3">
        <span className="mono-label text-fg-faint">{label}</span>
      </div>
      <div className="space-y-3 px-5 py-5">
        {Array.from({ length: lines }, (_, i) => (
          <SkeletonLine key={i} width={`${100 - i * 12}%`} />
        ))}
      </div>
    </Panel>
  );
}

export function LedgerSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Panel>
      <div className="border-b border-line px-5 py-3">
        <span className="mono-label text-fg-faint">LOADING LEDGER</span>
      </div>
      <ul className="divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-6 px-5 py-4">
            <SkeletonLine width="6rem" />
            <SkeletonLine width="30%" className="hidden sm:block" />
            <SkeletonLine width="4rem" className="ml-auto" />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
