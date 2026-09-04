import type { ReactNode } from "react";
import { cx, provenanceLabel, provenanceTone } from "@/lib/format";
import { Tag } from "@/components/system/StateBadge";
import type { Attested, Provenance } from "@/lib/types";

/**
 * Provenance is a first-class UI concern in Recourse: a value is either
 * live protocol data, a labelled demo fixture, a simulated run, or absent.
 * It is never presented ambiguously.
 */

export function ProvenanceTag({
  provenance,
  size = "xs",
  className,
  title,
}: {
  provenance: Provenance;
  size?: "xs" | "sm";
  className?: string;
  title?: string;
}) {
  return (
    <Tag
      tone={provenanceTone[provenance]}
      size={size}
      className={cx(provenance === "LIVE" && "border-pass/40", className)}
      title={title ?? provenanceDescription[provenance]}
      dot={provenance === "LIVE"}
    >
      {provenanceLabel[provenance]}
    </Tag>
  );
}

export const provenanceDescription: Record<Provenance, string> = {
  LIVE: "Read from a connected network or backend.",
  DEMO_FIXTURE: "Produced by a seeded protocol run on this deployment, not by a live counterparty.",
  SIMULATED: "Produced by the in-browser demo run. Nothing was broadcast.",
  NOT_AVAILABLE: "No backend or node currently provides this value.",
};

/** Renders an attested value, or an explicit unavailable state. */
export function AttestedValue<T>({
  attested,
  render,
  showTag = true,
  className,
}: {
  attested: Attested<T>;
  render: (value: T) => ReactNode;
  showTag?: boolean;
  className?: string;
}) {
  if (attested.value === null) {
    return <UnavailableValue note={attested.note} className={className} />;
  }
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-2", className)}>
      {render(attested.value)}
      {showTag ? <ProvenanceTag provenance={attested.provenance} /> : null}
    </span>
  );
}

export function UnavailableValue({
  note,
  label = "NOT YET AVAILABLE",
  className,
}: {
  note?: string;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex flex-col gap-1", className)}>
      <span className="inline-flex items-center gap-2">
        <span
          className="h-px w-4 bg-line-strong"
          aria-hidden
        />
        <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint uppercase">
          {label}
        </span>
      </span>
      {note ? <span className="max-w-prose text-xs leading-relaxed text-fg-dim">{note}</span> : null}
    </span>
  );
}

/** Sits under the header on any screen that is not showing live data. */
export function DemoModeIndicator({
  mode = "DEMO",
  detail,
  label,
  tone: toneOverride,
  className,
}: {
  mode?: "DEMO" | "SIMULATED" | "LIVE";
  detail?: string;
  /** Overrides the tag text when the mode alone would be misleading. */
  label?: string;
  tone?: "pass" | "pending" | "neutral";
  className?: string;
}) {
  const tone = toneOverride ?? (mode === "LIVE" ? "pass" : mode === "SIMULATED" ? "pending" : "neutral");
  const copy =
    detail ??
    (mode === "SIMULATED"
      ? "This run executes in your browser. No payment, chain call, or adjudication is broadcast."
      : "These records were seeded into the local ledger by running real protocol transactions. Values labelled LIVE were produced by a real network call.");
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 border border-line bg-surface px-3 py-2",
        className,
      )}
      role="note"
    >
      <Tag tone={tone} size="xs">
        {label ?? (mode === "DEMO" ? "DEMO FIXTURE" : mode)}
      </Tag>
      <span className="text-xs leading-relaxed text-fg-dim">{copy}</span>
    </div>
  );
}
