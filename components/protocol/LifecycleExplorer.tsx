"use client";

import { useCallback, useId, useRef, useState } from "react";
import { cx } from "@/lib/format";
import { LIFECYCLE } from "@/lib/content/lifecycle";

/**
 * LifecycleExplorer — the six protocol operations, revealed one at a time.
 * Vertical tablist on desktop, horizontally scrollable on mobile.
 */
export function LifecycleExplorer({ className }: { className?: string }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const last = LIFECYCLE.length - 1;
      let next: number | null = null;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") next = active === last ? 0 : active + 1;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = active === 0 ? last : active - 1;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = last;
      if (next !== null) {
        event.preventDefault();
        setActive(next);
        tabsRef.current[next]?.focus();
      }
    },
    [active],
  );

  const step = LIFECYCLE[active];

  return (
    <div className={cx("grid grid-cols-1 border border-line lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]", className)}>
      <div
        role="tablist"
        aria-label="Protocol lifecycle"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="flex overflow-x-auto border-b border-line lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0"
      >
        {LIFECYCLE.map((item, index) => {
          const selected = index === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                tabsRef.current[index] = el;
              }}
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              className={cx(
                "group relative flex min-w-[9.5rem] shrink-0 flex-col items-start gap-1 border-r border-line px-4 py-4 text-left transition-colors last:border-r-0 lg:min-w-0 lg:w-full lg:flex-row lg:items-center lg:gap-4 lg:border-r-0 lg:border-b lg:px-5 lg:py-4 lg:last:border-b-0",
                selected ? "bg-raised" : "hover:bg-surface",
              )}
            >
              <span
                className={cx(
                  "font-mono text-[10px] tracking-[0.16em] tnum",
                  selected ? "text-protected" : "text-fg-faint",
                )}
              >
                {item.index}
              </span>
              <span className="min-w-0 lg:flex-1">
                <span
                  className={cx(
                    "block font-mono text-[12px] tracking-[0.16em] uppercase",
                    selected ? "text-fg" : "text-fg-muted group-hover:text-fg",
                  )}
                >
                  {item.title}
                </span>
                <span className="mt-1 hidden truncate text-xs text-fg-dim lg:block">
                  {item.actor}
                </span>
              </span>
              {selected ? (
                <span
                  className="absolute inset-x-0 bottom-0 h-px bg-protected lg:inset-x-auto lg:top-0 lg:bottom-0 lg:left-0 lg:h-auto lg:w-px"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${step.id}`}
        aria-labelledby={`${baseId}-tab-${step.id}`}
        tabIndex={0}
        className="flex flex-col justify-between gap-8 px-5 py-6 sm:px-8 sm:py-8"
      >
        <div key={step.id} className="rc-fade">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] tracking-[0.18em] text-protected tnum">
              {step.index}
            </span>
            <h3 className="font-mono text-lg tracking-[0.14em] text-fg uppercase">{step.title}</h3>
            <span className="mono-label ml-auto text-fg-faint">{step.actor}</span>
          </div>
          <p className="mt-5 max-w-xl text-lg leading-snug text-balance text-fg">{step.summary}</p>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-fg-muted">{step.detail}</p>
        </div>

        <div className="border-t border-line pt-5">
          <p className="mono-label">Produces</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {step.artifacts.map((artifact) => (
              <li
                key={artifact}
                className="border border-line bg-surface px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] text-fg-muted uppercase"
              >
                {artifact}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
