import { cx, formatTimestamp } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { AdjudicationStatusBadge, RulingBadge, Tag } from "@/components/system/StateBadge";
import { HashValue } from "@/components/system/HashValue";
import { UnavailableValue } from "@/components/system/Provenance";
import { EmptyState } from "@/components/system/States";
import { ProvenanceTag } from "@/components/system/Provenance";
import type { Adjudication, Ruling } from "@/lib/types";

/**
 * AdjudicationPanel — the GenLayer referral, stated plainly.
 *
 * No validator avatars, no invented consensus percentages, no fabricated
 * block data. What the protocol asked, what it sent, and what came back.
 */
export function AdjudicationPanel({
  adjudication,
  className,
}: {
  adjudication: Adjudication | null;
  className?: string;
}) {
  if (!adjudication) {
    return (
      <EmptyState
        label="ADJUDICATION"
        title="No adjudication referral"
        description="Deterministic verification resolved every mandatory term, so nothing was referred to GenLayer for semantic judgment."
        className={className}
      />
    );
  }

  const inProgress =
    adjudication.status === "IN_PROGRESS" || adjudication.status === "QUEUED";

  return (
    <Panel className={className}>
      <PanelHeader
        title="GENLAYER ADJUDICATION"
        meta={adjudication.network}
        actions={<AdjudicationStatusBadge status={adjudication.status} />}
      />

      <div className="border-b border-line px-4 py-5 sm:px-5">
        <p className="mono-label">Question</p>
        <p className="mt-2.5 max-w-2xl text-base leading-relaxed text-balance text-fg">
          {adjudication.question}
        </p>
      </div>

      <div className="border-b border-line px-4 py-4 sm:px-5">
        <p className="mono-label">Evidence submitted to adjudication</p>
        {/*
          * Full digests, not truncated: a reviewer should be able to recompute
          * these from the agreement and the evidence and compare them by eye.
          */}
        <dl className="mt-3 flex flex-col gap-3">
          {adjudication.inputs.map((input) => (
            <div key={input.label} className="border-b border-line/60 pb-2">
              <dt className="mono-label text-fg-faint">{input.label}</dt>
              <dd className="mt-1 font-mono text-xs leading-relaxed break-all text-fg">
                {input.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {inProgress ? (
        <div className="relative overflow-hidden border-b border-pending/25 bg-pending-dim/25 px-4 py-3 sm:px-5">
          <div className="rc-scan absolute inset-x-0 top-0 h-px" aria-hidden />
          <p className="font-mono text-[11px] tracking-[0.14em] text-pending uppercase">
            Awaiting ruling
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
            The referral has been submitted. No outcome, transaction, or validator detail is
            reported until the ruling finalizes.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-4 sm:px-5">
          <p className="mono-label">Submitted</p>
          <p className="mt-1.5 font-mono text-xs tnum text-fg-muted">
            {adjudication.submittedAt ? formatTimestamp(adjudication.submittedAt, { seconds: true }) : "—"}
          </p>
          <p className="mono-label mt-4">Finalized</p>
          <p className="mt-1.5 font-mono text-xs tnum text-fg-muted">
            {adjudication.finalizedAt ? formatTimestamp(adjudication.finalizedAt, { seconds: true }) : "—"}
          </p>
        </div>
        <div className="px-4 py-4 sm:px-5">
          <p className="mono-label">Adjudication contract</p>
          <div className="mt-1.5">
            <HashValue attested={adjudication.contract} label="contract address" lead={10} tail={8} />
          </div>
          <p className="mono-label mt-4">Adjudication transaction</p>
          <div className="mt-1.5">
            <HashValue attested={adjudication.transaction} label="adjudication transaction" />
          </div>
        </div>
      </div>

      <div className="border-t border-line px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="mono-label">Validator set and consensus</p>
          <ProvenanceTag provenance={adjudication.consensus.provenance} />
        </div>
        <div className="mt-2">
          {adjudication.consensus.value === null ? (
            <UnavailableValue note={adjudication.consensus.note} />
          ) : (
            <>
              <p className="font-mono text-sm text-fg">
                {adjudication.consensus.value.validators} validators ·{" "}
                {adjudication.consensus.value.agreement}
                {adjudication.consensus.value.rounds === null
                  ? ""
                  : ` · ${adjudication.consensus.value.rounds} rounds`}
              </p>
              {adjudication.votes.value ? (
                <ul className="mt-3 divide-y divide-line border border-line">
                  {adjudication.votes.value.map((entry) => (
                    <li
                      key={entry.validator}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="truncate font-mono text-[11px] text-fg-dim">
                        {entry.validator}
                      </span>
                      <span
                        className={`font-mono text-[10px] tracking-[0.14em] uppercase ${
                          entry.vote === "agree"
                            ? "text-pass"
                            : entry.vote === "disagree"
                              ? "text-breach"
                              : "text-fg-faint"
                        }`}
                      >
                        {entry.vote}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
                Votes as reported by the network in the transaction receipt. Validators that did not
                participate in this round are shown as idle.
              </p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * RulingPanel — the outcome and, critically, the reasoning behind it.
 */
export function RulingPanel({
  ruling,
  className,
}: {
  ruling: Ruling | null;
  className?: string;
}) {
  if (!ruling) {
    return (
      <EmptyState
        label="RULING"
        title="No ruling yet"
        description="A ruling appears here when adjudication finalizes. Until then, the escrowed amount stays held under protection."
        className={className}
      />
    );
  }

  const buyerWins = ruling.outcome === "BUYER_WINS";

  return (
    <Panel className={className}>
      <PanelHeader title="RULING" meta={formatTimestamp(ruling.finalizedAt, { seconds: true })} />

      <div
        className={cx(
          "flex flex-wrap items-center justify-between gap-4 border-b px-4 py-5 sm:px-5",
          buyerWins ? "border-protected/25 bg-protected-dim/35" : "border-pass/25 bg-pass-dim/30",
        )}
      >
        <div>
          <p className="mono-label">Outcome</p>
          <p
            className={cx(
              "mt-2 font-mono text-2xl tracking-[0.04em] uppercase sm:text-3xl",
              buyerWins ? "text-protected" : "text-pass",
            )}
          >
            {buyerWins ? "Buyer wins" : ruling.outcome === "MERCHANT_WINS" ? "Merchant wins" : "Split remedy"}
          </p>
        </div>
        <RulingBadge outcome={ruling.outcome} />
      </div>

      {ruling.breachedTerms.length > 0 ? (
        <div className="border-b border-line">
          <div className="px-4 pt-4 sm:px-5">
            <p className="mono-label">Breached terms</p>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {ruling.breachedTerms.map((term) => (
              <li
                key={term.termId}
                className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4 sm:px-5"
              >
                <div className="col-span-2 sm:col-span-1">
                  <p className="mono-label">Term</p>
                  <p className="mt-1.5 font-mono text-sm text-fg">{term.termId}</p>
                </div>
                <div>
                  <p className="mono-label">Promised</p>
                  <p className="mt-1.5 font-mono text-sm tnum text-fg-muted">{term.promised}</p>
                </div>
                <div>
                  <p className="mono-label">Observed</p>
                  <p className="mt-1.5 font-mono text-sm tnum text-breach">{term.observed}</p>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <p className="mono-label">Severity</p>
                  <p className="mt-1.5">
                    <Tag tone={term.severity === "MATERIAL" ? "breach" : "pending"} size="xs">
                      {term.severity}
                    </Tag>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-b border-line px-4 py-4 sm:px-5">
        <p className="mono-label">Reasoning</p>
        <ol className="mt-3 space-y-3">
          {ruling.rationale.map((line, index) => (
            <li key={index} className="flex gap-3">
              <span className="font-mono text-[11px] tnum text-fg-faint">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="max-w-prose text-sm leading-relaxed text-fg-muted">{line}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <p className="mono-label">Remedy</p>
        <p
          className={cx(
            "font-mono text-sm tracking-[0.1em] uppercase",
            ruling.remedy === "NONE" ? "text-fg-muted" : "text-protected",
          )}
        >
          {ruling.remedy === "FULL_REFUND"
            ? "Full refund"
            : ruling.remedy === "PARTIAL_REFUND"
              ? "Partial refund"
              : "No remedy owed"}
        </p>
      </div>
    </Panel>
  );
}
