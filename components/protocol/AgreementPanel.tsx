import { Lock } from "lucide-react";
import { cx, formatTimestamp } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { Tag } from "@/components/system/StateBadge";
import { HashValue } from "@/components/system/HashValue";
import { AgreementSource } from "@/components/protocol/AgreementSource";
import type { Agreement, AgreementTerm as Term } from "@/lib/types";

const remedyLabel = {
  FULL_REFUND: "Full refund",
  PARTIAL_REFUND: "Partial refund",
  NONE: "No remedy",
} as const;

/** A single promised term. Promise on the right, always monospaced. */
export function AgreementTerm({
  term,
  emphasis = false,
  className,
}: {
  term: Term;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-2 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("text-sm", emphasis ? "text-fg" : "text-fg-muted")}>{term.label}</span>
          {term.evaluation === "SEMANTIC" ? (
            <Tag size="xs" tone="pending">
              Semantic
            </Tag>
          ) : null}
          {!term.mandatory ? (
            <Tag size="xs" tone="neutral">
              Optional
            </Tag>
          ) : null}
        </div>
        {term.description ? (
          <p className="mt-1 max-w-md text-xs leading-relaxed text-fg-dim">{term.description}</p>
        ) : null}
      </div>
      <span className="shrink-0 font-mono text-sm tnum text-fg">{term.promise}</span>
    </div>
  );
}

export function AgreementPanel({
  agreement,
  title = "PURCHASE AGREEMENT",
  showSource = true,
  className,
}: {
  agreement: Agreement;
  title?: string;
  showSource?: boolean;
  className?: string;
}) {
  const locked = agreement.status === "LOCKED";

  return (
    <Panel className={className}>
      <PanelHeader
        title={title}
        meta={`V${agreement.version}`}
        actions={
          <Tag tone={locked ? "protected" : "pending"} dot size="xs">
            {locked ? "Locked" : agreement.status}
          </Tag>
        }
      />

      <div className="px-4 pt-4 pb-1 sm:px-5">
        <p className="mono-label text-fg-faint">Purchase protection</p>
        <div className="mt-2 divide-y divide-line">
          {agreement.terms.map((term) => (
            <AgreementTerm key={term.id} term={term} />
          ))}
          <div className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
            <span className="text-sm text-fg">Breach remedy</span>
            <span className="font-mono text-sm text-protected">
              {remedyLabel[agreement.breachRemedy]}
            </span>
          </div>
        </div>
      </div>

      <div
        className={cx(
          "mt-2 flex flex-col gap-3 border-t px-4 py-4 sm:px-5",
          locked ? "border-protected/25 bg-protected-dim/35" : "border-line",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Lock
            className={cx("size-3.5", locked ? "text-protected" : "text-fg-faint")}
            aria-hidden
          />
          <span
            className={cx(
              "font-mono text-[10px] tracking-[0.16em] uppercase",
              locked ? "text-protected" : "text-fg-dim",
            )}
          >
            {locked ? "Agreement locked" : "Agreement not locked"}
          </span>
          {agreement.lockedAt ? (
            <span className="font-mono text-[10px] tnum tracking-[0.08em] text-fg-faint">
              {formatTimestamp(agreement.lockedAt, { seconds: true })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="mono-label">Hash</span>
          <HashValue attested={agreement.hash} label="agreement hash" lead={12} tail={10} />
        </div>
        <p className="text-xs leading-relaxed text-fg-dim">
          The agreement is committed before any funds move. Verification and adjudication read this
          document, not a later description of it.
        </p>
      </div>

      {showSource ? <AgreementSource document={agreement.document} /> : null}
    </Panel>
  );
}
