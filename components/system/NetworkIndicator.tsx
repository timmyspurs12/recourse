"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";
import { Tag } from "@/components/system/StateBadge";
import { UnavailableValue } from "@/components/system/Provenance";
import type { NetworkStatus } from "@/lib/types";

const modeTone = {
  LIVE: "pass",
  DEMO: "neutral",
  SIMULATED: "pending",
} as const;

const modeCopy: Record<NetworkStatus["mode"], string> = {
  LIVE: "Connected to a network. Values on screen reflect real protocol state.",
  DEMO: "No network or backend is connected. Every value is a typed fixture shipped with this build.",
  SIMULATED: "A demo run is executing in your browser. Nothing is broadcast to any network.",
};

/**
 * The network indicator must never imply a fixture is a real transaction.
 * The dot colour encodes the mode, and the disclosure states it in words.
 */
export function NetworkIndicator({
  status,
  className,
}: {
  status: NetworkStatus;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dotClass =
    status.mode === "LIVE"
      ? "bg-pass"
      : status.mode === "SIMULATED"
        ? "bg-pending"
        : "bg-fg-dim";

  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 border border-line bg-surface px-2.5 py-1.5 font-mono text-[10px] tracking-[0.14em] text-fg-muted uppercase transition-colors hover:border-line-strong hover:text-fg"
      >
        <span
          className={cx("size-1.5 rounded-full", dotClass, status.mode === "SIMULATED" && "rc-pulse")}
          aria-hidden
        />
        <span className="hidden sm:inline">{status.label}</span>
        <span className="hidden text-fg-faint sm:inline">·</span>
        <span
          className={
            status.mode === "LIVE"
              ? "text-pass"
              : status.mode === "SIMULATED"
                ? "text-pending"
                : "text-fg-dim"
          }
        >
          {status.mode}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Network status"
          className="rc-reveal absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] border border-line-strong bg-panel p-4 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)]"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="mono-label text-fg">Network</span>
            <Tag tone={modeTone[status.mode]} size="xs" dot>
              {status.mode}
            </Tag>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">{modeCopy[status.mode]}</p>
          <dl className="mt-4 space-y-3 border-t border-line pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="mono-label">Chain</dt>
              <dd className="font-mono text-xs text-fg-muted">{status.chain}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="mono-label">Adapter</dt>
              <dd className="font-mono text-xs text-fg-muted">{status.adapter}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="mono-label">Block height</dt>
              <dd className="text-right">
                {status.blockHeight.value === null ? (
                  <UnavailableValue note={undefined} />
                ) : (
                  <span className="font-mono tnum text-xs text-fg">{status.blockHeight.value}</span>
                )}
              </dd>
            </div>
          </dl>
          {status.blockHeight.note ? (
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-fg-dim">
              {status.blockHeight.note}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
