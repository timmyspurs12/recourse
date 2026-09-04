"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx, truncateHash } from "@/lib/format";
import { ProvenanceTag, UnavailableValue } from "@/components/system/Provenance";
import type { Attested } from "@/lib/types";

/**
 * Hashes, transaction ids and addresses. Truncates intelligently on small
 * screens, always copyable in full, always labelled with its provenance.
 */
export function HashValue({
  attested,
  label,
  lead = 10,
  tail = 8,
  className,
  showProvenance = true,
}: {
  attested: Attested<string>;
  label?: string;
  lead?: number;
  tail?: number;
  className?: string;
  showProvenance?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const value = attested.value;

  const copy = useCallback(() => {
    if (!value) return;
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }, [value]);

  if (!value) {
    return <UnavailableValue note={attested.note} className={className} />;
  }

  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-2 gap-y-1.5", className)}>
      <button
        type="button"
        onClick={copy}
        title={value}
        aria-label={`Copy ${label ?? "value"}: ${value}`}
        className="group inline-flex items-center gap-2 border border-line bg-surface px-2 py-1 font-mono text-xs text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
      >
        <span className="tnum">
          <span className="hidden sm:inline">{truncateHash(value, lead, tail)}</span>
          <span className="sm:hidden">{truncateHash(value, 6, 4)}</span>
        </span>
        {copied ? (
          <Check className="size-3 text-pass" aria-hidden />
        ) : (
          <Copy className="size-3 text-fg-faint transition-colors group-hover:text-fg-muted" aria-hidden />
        )}
        <span className="sr-only">{copied ? "Copied" : "Copy to clipboard"}</span>
      </button>
      {showProvenance ? <ProvenanceTag provenance={attested.provenance} /> : null}
    </span>
  );
}
