"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "@/lib/format";
import { CodeBlock } from "@/components/system/CodeBlock";

/** Reveals the exact machine-readable document behind the rendered agreement. */
export function AgreementSource({
  document,
  className,
}: {
  document: Record<string, unknown>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(document, null, 2);

  return (
    <div className={cx("border-t border-line", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 font-mono text-[10px] tracking-[0.16em] text-fg-dim uppercase transition-colors hover:text-fg sm:px-5"
      >
        <ChevronRight
          className={cx("size-3.5 transition-transform duration-200", open && "rotate-90")}
          aria-hidden
        />
        {open ? "Hide machine-readable source" : "View machine-readable source"}
      </button>
      {open ? (
        <div className="rc-reveal px-4 pb-4 sm:px-5 sm:pb-5">
          <CodeBlock code={json} language="json" filename="agreement.json" />
        </div>
      ) : null}
    </div>
  );
}
