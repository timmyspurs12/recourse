import { FileText } from "lucide-react";
import { cx, formatBytes, formatTimestamp } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { EvidenceStatusBadge, Tag } from "@/components/system/StateBadge";
import { HashValue } from "@/components/system/HashValue";
import { ProtocolErrorState } from "@/components/system/States";
import type { Delivery, Evidence } from "@/lib/types";

/**
 * EvidencePanel — what was actually delivered.
 *
 * Deliberately styled apart from the agreement: the agreement is a locked
 * promise (calm, bordered, monospaced values on the right), evidence is a
 * numbered forensic record (indexed, timestamped, checksummed).
 */
export function EvidenceItem({
  evidence,
  requiredMaxAgeDays,
  className,
}: {
  evidence: Evidence;
  requiredMaxAgeDays?: number | null;
  className?: string;
}) {
  const ageBreach =
    typeof requiredMaxAgeDays === "number" &&
    typeof evidence.sourceAgeDays === "number" &&
    evidence.sourceAgeDays > requiredMaxAgeDays;

  return (
    <li className={cx("grid gap-4 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-5", className)}>
      <span className="font-mono text-[11px] tnum tracking-[0.12em] text-fg-faint sm:pt-0.5">
        #{String(evidence.index).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="font-mono text-sm break-all text-fg">{evidence.source}</span>
          <EvidenceStatusBadge status={evidence.status} />
        </div>
        {evidence.title ? (
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">{evidence.title}</p>
        ) : null}
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="mono-label">Submitted</dt>
            <dd className="mt-1 font-mono text-xs tnum text-fg-muted">
              {formatTimestamp(evidence.submittedAt)}
            </dd>
          </div>
          <div>
            <dt className="mono-label">Source age</dt>
            <dd
              className={cx(
                "mt-1 font-mono text-xs tnum",
                ageBreach ? "text-breach" : "text-fg-muted",
              )}
            >
              {evidence.sourceAgeDays === null ? "—" : `${evidence.sourceAgeDays} days`}
            </dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="mono-label">Checksum</dt>
            <dd className="mt-1">
              <HashValue
                attested={evidence.checksum}
                label="evidence checksum"
                lead={8}
                tail={6}
                showProvenance={false}
              />
            </dd>
          </div>
        </dl>
        {evidence.note ? (
          <p className="mt-3 border-l-2 border-line pl-3 text-xs leading-relaxed text-fg-dim">
            {evidence.note}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function EvidencePanel({
  delivery,
  requiredSources,
  requiredMaxAgeDays,
  className,
}: {
  delivery: Delivery | null;
  requiredSources?: number | null;
  requiredMaxAgeDays?: number | null;
  className?: string;
}) {
  if (!delivery) {
    return (
      <ProtocolErrorState
        tone="neutral"
        code="NO_DELIVERY"
        title="Awaiting delivery"
        description="The merchant agent has not submitted fulfillment for this order. Evidence appears here once delivery is recorded."
        className={className}
      />
    );
  }

  if (delivery.evidenceUnavailableReason) {
    return (
      <ProtocolErrorState
        code="EVIDENCE_UNAVAILABLE"
        title="Evidence unavailable"
        description="The delivery record exists, but its evidence payload could not be retrieved."
        detail={delivery.evidenceUnavailableReason}
        className={className}
      />
    );
  }

  const count = delivery.evidence.length;
  const shortfall = typeof requiredSources === "number" && count < requiredSources;

  return (
    <Panel className={className}>
      <PanelHeader
        title="EVIDENCE"
        meta={
          typeof requiredSources === "number"
            ? `${count} SUBMITTED / ${requiredSources} REQUIRED`
            : `${count} SUBMITTED`
        }
        actions={
          shortfall ? (
            <Tag tone="breach" size="xs">
              Short by {requiredSources! - count}
            </Tag>
          ) : (
            <Tag tone="pass" size="xs">
              Count satisfied
            </Tag>
          )
        }
      />

      <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <FileText className="size-4 shrink-0 text-fg-dim" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-mono text-sm text-fg">{delivery.artifact.title}</p>
            <p className="mt-0.5 font-mono text-[10px] tracking-[0.12em] text-fg-faint uppercase">
              {delivery.artifact.format} · {delivery.artifact.sections} sections ·{" "}
              {delivery.artifact.sizeBytes === null ? "NOT AVAILABLE" : formatBytes(delivery.artifact.sizeBytes)}
            </p>
          </div>
        </div>
        <span className="font-mono text-[11px] tnum whitespace-nowrap text-fg-dim">
          {formatTimestamp(delivery.submittedAt, { seconds: true })}
        </span>
      </div>

      {delivery.statement ? (
        <p className="border-b border-line px-4 py-3 text-sm leading-relaxed text-fg-muted sm:px-5">
          {delivery.statement}
        </p>
      ) : null}

      <ul className="divide-y divide-line">
        {delivery.evidence.map((item) => (
          <EvidenceItem
            key={item.id}
            evidence={item}
            requiredMaxAgeDays={requiredMaxAgeDays}
          />
        ))}
      </ul>

      {shortfall ? (
        <p className="border-t border-breach/30 bg-breach-dim/40 px-4 py-3 font-mono text-[11px] leading-relaxed tracking-[0.06em] text-breach uppercase sm:px-5">
          Evidence count below the locked minimum. Deterministic verification records a breach.
        </p>
      ) : null}
    </Panel>
  );
}
