import { cx, formatClock, orderStatusMeta, toneClasses } from "@/lib/format";
import type { RailNode } from "@/lib/selectors";

/**
 * TransactionRail — the state machine, drawn.
 *
 * Horizontal on desktop, vertical on mobile. Supports the successful path,
 * the dispute branch, and still-unresolved (projected) states.
 */
export function TransactionRail({
  nodes,
  className,
  compact = false,
}: {
  nodes: RailNode[];
  className?: string;
  compact?: boolean;
}) {
  return (
    <ol
      className={cx("flex flex-col lg:flex-row lg:items-stretch", className)}
      aria-label="Transaction state path"
    >
      {nodes.map((node, index) => {
        const meta = orderStatusMeta[node.status];
        const isLast = index === nodes.length - 1;
        const tone = toneClasses[meta.tone];

        const markerClass =
          node.state === "CURRENT"
            ? cx("border", tone.border, tone.bg)
            : node.state === "COMPLETE"
              ? "border border-line-strong bg-line-strong"
              : node.state === "PROJECTED"
                ? "border border-dashed border-line-strong bg-transparent"
                : "border border-line bg-transparent";

        const labelClass =
          node.state === "CURRENT"
            ? tone.text
            : node.state === "COMPLETE"
              ? "text-fg-muted"
              : "text-fg-faint";

        return (
          <li
            key={`${node.status}-${index}`}
            className={cx(
              "relative flex gap-3 lg:flex-1 lg:flex-col lg:gap-2",
              !isLast && "pb-5 lg:pb-0",
            )}
            aria-current={node.state === "CURRENT" ? "step" : undefined}
          >
            {/* marker row */}
            <div className="flex shrink-0 flex-col items-center lg:w-full lg:flex-row lg:items-center">
              <span
                className={cx(
                  "relative grid size-3 shrink-0 place-items-center",
                  markerClass,
                  node.branch === "DISPUTE" && node.state !== "PENDING" && "shadow-none",
                )}
                aria-hidden
              >
                {node.state === "CURRENT" ? (
                  <span className={cx("size-1 rounded-full", tone.dot, "rc-pulse")} />
                ) : null}
              </span>
              {/* vertical connector (mobile) */}
              {!isLast ? (
                <span
                  className={cx(
                    "mt-1 w-px flex-1 lg:hidden",
                    node.state === "COMPLETE" ? "bg-line-strong" : "bg-line",
                  )}
                  aria-hidden
                />
              ) : null}
              {/* horizontal connector (desktop) */}
              {!isLast ? (
                <span
                  className={cx(
                    "mx-2 hidden h-px flex-1 lg:block",
                    node.state === "COMPLETE" ? "bg-line-strong" : "bg-line",
                    node.state === "PROJECTED" && "bg-transparent bg-[repeating-linear-gradient(to_right,var(--color-line-strong)_0_4px,transparent_4px_8px)]",
                  )}
                  aria-hidden
                />
              ) : null}
            </div>

            {/* label */}
            <div className={cx("min-w-0 pb-0 lg:pr-4", compact ? "-mt-1" : "-mt-0.5")}>
              <p
                className={cx(
                  "font-mono text-[10px] leading-tight tracking-[0.14em] uppercase",
                  labelClass,
                )}
              >
                {meta.label}
              </p>
              {!compact ? (
                <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-fg-faint tnum">
                  {node.at ? formatClock(node.at) : node.state === "PROJECTED" ? "PROJECTED" : "—"}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Compact five-phase rail: PROMISE → PAYMENT → PROOF → JUDGMENT → SETTLEMENT.
 * Used on the hero object and anywhere the full state list is too much.
 */
export function PhaseRail({
  active,
  completed = [],
  orientation = "vertical",
  className,
}: {
  active?: string;
  completed?: string[];
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  const phases = ["PROMISE", "PAYMENT", "PROOF", "JUDGMENT", "SETTLEMENT"];
  return (
    <ol
      className={cx(
        "flex",
        orientation === "vertical" ? "flex-col gap-0" : "flex-row items-center gap-0",
        className,
      )}
      aria-label="Lifecycle phases"
    >
      {phases.map((phase, index) => {
        const isDone = completed.includes(phase);
        const isActive = active === phase;
        const isLast = index === phases.length - 1;
        if (orientation === "vertical") {
          return (
            <li key={phase} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cx(
                    "mt-1.5 size-1.5 shrink-0",
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
              <span
                className={cx(
                  "pb-3 font-mono text-[10px] tracking-[0.16em] uppercase",
                  isActive ? "text-protected" : isDone ? "text-fg-muted" : "text-fg-faint",
                )}
              >
                {phase}
              </span>
            </li>
          );
        }

        return (
          <li key={phase} className={cx("flex items-center gap-2", !isLast && "flex-1")}>
            <div className="flex items-center gap-2">
              <span
                className={cx(
                  "size-1.5 shrink-0",
                  isActive ? "bg-protected" : isDone ? "bg-fg-muted" : "bg-line-strong",
                )}
                aria-hidden
              />
              <span
                className={cx(
                  "font-mono text-[10px] tracking-[0.16em] whitespace-nowrap uppercase",
                  isActive ? "text-protected" : isDone ? "text-fg-muted" : "text-fg-faint",
                )}
              >
                {phase}
              </span>
            </div>
            {!isLast ? <span className="h-px flex-1 bg-line" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
