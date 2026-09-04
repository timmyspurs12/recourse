"use client";

import { useEffect, useState } from "react";
import { cx } from "@/lib/format";

export interface DossierSection {
  id: string;
  label: string;
}

/**
 * DossierIndex — anchor navigation for long transaction records, with a
 * scroll-spy so the reader always knows where they are in the trail.
 */
export function DossierIndex({
  sections,
  title = "DOSSIER",
  className,
}: {
  sections: DossierSection[];
  title?: string;
  className?: string;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 0.25] },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav aria-label="Dossier sections" className={cx("border border-line bg-panel", className)}>
      <p className="border-b border-line px-4 py-3 mono-label text-fg">{title}</p>
      <ol className="py-2">
        {sections.map((section, index) => {
          const selected = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={selected ? "true" : undefined}
                className={cx(
                  "flex items-baseline gap-3 px-4 py-2 transition-colors",
                  selected ? "text-fg" : "text-fg-dim hover:text-fg-muted",
                )}
              >
                <span
                  className={cx(
                    "font-mono text-[10px] tnum tracking-[0.12em]",
                    selected ? "text-protected" : "text-fg-faint",
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-[11px] tracking-[0.1em] uppercase">
                  {section.label}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
