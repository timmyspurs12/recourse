"use client";

import { useState } from "react";
import { cx } from "@/lib/format";
import { StateBadge, Tag, ProtectedChip } from "@/components/system/StateBadge";
import { Amount } from "@/components/system/Values";
import type { LifecyclePhase, OrderStatus } from "@/lib/types";

interface PhaseStep {
  phase: LifecyclePhase;
  status: OrderStatus;
  note: string;
}

const STEPS: PhaseStep[] = [
  {
    phase: "PROMISE",
    status: "ACCEPTED",
    note: "Machine-readable agreement locked and hashed before any funds move.",
  },
  {
    phase: "PAYMENT",
    status: "ESCROWED",
    note: "$1.00 USDC paid over x402 and held under protection for 72 hours.",
  },
  {
    phase: "PROOF",
    status: "DELIVERED",
    note: "Merchant agent submits the artifact and the evidence behind it.",
  },
  {
    phase: "JUDGMENT",
    status: "DISPUTED",
    note: "Deterministic checks find 2 sources against a locked floor of 5.",
  },
  {
    phase: "SETTLEMENT",
    status: "REFUNDED",
    note: "Ruling finalized for the buyer. Escrow returns to shopper.agent.",
  },
];

/**
 * The hero object is a transaction, not an illustration. Selecting a phase
 * moves the same record through its states so the lifecycle is legible at a
 * glance — and it is labelled a fixture, because it is one.
 */
export function HeroTransactionObject({ className }: { className?: string }) {
  const [active, setActive] = useState(1);
  const step = STEPS[active];

  return (
    <div
      className={cx(
        "border border-line bg-panel shadow-[0_40px_80px_-60px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[13px] tracking-[0.14em] text-fg">RC / ——————</span>
          <span className="mono-label text-fg-faint">Protected purchase</span>
        </div>
        <Tag size="xs">Illustration</Tag>
      </div>

      {/* parties */}
      <div className="px-4 py-5 sm:px-5">
        <div className="relative pl-7">
          <span
            className="absolute top-2 bottom-3 left-[3px] w-px bg-line-strong"
            aria-hidden
          />
          <div className="relative">
            <span
              className="absolute top-1.5 -left-7 size-2 border border-protected bg-protected-dim"
              aria-hidden
            />
            <p className="mono-label">Shopper agent</p>
            <p className="mt-1 font-mono text-sm text-fg">shopper.agent</p>
          </div>
          <p className="mt-2 mb-2 font-mono text-[10px] tracking-[0.14em] text-fg-faint uppercase">
            pays $1.00 under protection
          </p>
          <div className="relative">
            <span
              className="absolute top-1.5 -left-7 size-2 border border-line-strong bg-panel"
              aria-hidden
            />
            <p className="mono-label">Merchant agent</p>
            <p className="mt-1 font-mono text-sm text-fg">merchant.agent</p>
          </div>
        </div>
      </div>

      {/* purchase */}
      <div className="border-y border-line bg-surface px-4 py-4 sm:px-5">
        <p className="text-sm leading-snug text-fg">Lagos Consumer Commerce Brief</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Amount money={{ amount: "1.00", currency: "USDC" }} size="lg" />
          <ProtectedChip />
        </div>
      </div>

      {/* status */}
      <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="mono-label">Status</p>
          <div className="mt-2">
            <StateBadge status={step.status} />
          </div>
          <p key={step.phase} className="rc-fade mt-3 max-w-xs text-xs leading-relaxed text-fg-dim">
            {step.note}
          </p>
        </div>
        <div className="text-right">
          <p className="mono-label">Escrow</p>
          <p
            className={cx(
              "mt-2 font-mono text-[11px] tracking-[0.14em] uppercase",
              step.status === "REFUNDED" ? "text-protected" : "text-fg-muted",
            )}
          >
            {step.status === "REFUNDED" ? "Returned" : step.status === "ACCEPTED" ? "Pending" : "Held"}
          </p>
        </div>
      </div>

      {/* lifecycle */}
      <div className="border-t border-line px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <p className="mono-label">Lifecycle</p>
          <p className="font-mono text-[9px] tracking-[0.16em] text-fg-faint uppercase">
            Select a phase
          </p>
        </div>
        <ol className="mt-3 flex flex-col">
          {STEPS.map((item, index) => {
            const isActive = index === active;
            const isDone = index < active;
            const isLast = index === STEPS.length - 1;
            return (
              <li key={item.phase} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cx(
                      "mt-2.5 size-1.5 shrink-0",
                      isActive ? "bg-protected" : isDone ? "bg-fg-muted" : "bg-line-strong",
                    )}
                    aria-hidden
                  />
                  {!isLast ? (
                    <span
                      className={cx("w-px flex-1", isDone ? "bg-line-strong" : "bg-line")}
                      aria-hidden
                    />
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  aria-pressed={isActive}
                  className={cx(
                    "-mx-2 flex-1 px-2 py-1.5 text-left font-mono text-[11px] tracking-[0.16em] uppercase transition-colors",
                    isActive
                      ? "text-protected"
                      : isDone
                        ? "text-fg-muted hover:text-fg"
                        : "text-fg-faint hover:text-fg-muted",
                  )}
                >
                  {item.phase}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
