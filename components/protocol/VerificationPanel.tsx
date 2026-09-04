import { cx, formatTimestamp } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { ResultBadge, Tag } from "@/components/system/StateBadge";
import { EmptyState } from "@/components/system/States";
import type { SemanticReviewStatus, Verification } from "@/lib/types";

const semanticTone: Record<SemanticReviewStatus, "neutral" | "pending" | "protected"> = {
  NOT_REQUIRED: "neutral",
  ADJUDICATION_REQUIRED: "pending",
  IN_ADJUDICATION: "pending",
  COMPLETE: "protected",
};

const semanticLabel: Record<SemanticReviewStatus, string> = {
  NOT_REQUIRED: "Not required",
  ADJUDICATION_REQUIRED: "Adjudication required",
  IN_ADJUDICATION: "In adjudication",
  COMPLETE: "Complete",
};

/**
 * VerificationPanel — arithmetic is not judgment.
 *
 * Deterministic checks are resolved by the protocol itself and shown as raw
 * comparisons. Only genuinely semantic questions are handed to GenLayer, and
 * the split is stated explicitly.
 */
export function VerificationPanel({
  verification,
  className,
}: {
  verification: Verification | null;
  className?: string;
}) {
  if (!verification) {
    return (
      <EmptyState
        label="VERIFICATION"
        title="Verification not executed"
        description="Deterministic conditions run once a delivery is recorded against this order. Nothing has been evaluated yet."
        className={className}
      />
    );
  }

  const breaches = verification.checks.filter((c) => c.result === "BREACH");

  return (
    <Panel className={className}>
      <PanelHeader
        title="VERIFICATION"
        meta={verification.engine}
        actions={<ResultBadge result={verification.outcome} size="xs" />}
      />

      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="mono-label text-fg">Deterministic checks</p>
          <span className="font-mono text-[10px] tnum tracking-[0.12em] text-fg-faint">
            {formatTimestamp(verification.executedAt, { seconds: true })}
          </span>
        </div>

        <ul className="mt-3 divide-y divide-line border-y border-line">
          {verification.checks.map((check) => {
            const isBreach = check.result === "BREACH";
            const isUndecided = check.result === "INDETERMINATE";
            return (
              <li
                key={check.termId}
                className={cx(
                  "flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
                  isBreach && "-mx-4 border-l-2 border-l-breach bg-breach-dim/35 px-4 sm:-mx-5 sm:px-5",
                  isUndecided && "-mx-4 border-l-2 border-l-pending bg-pending-dim/25 px-4 sm:-mx-5 sm:px-5",
                )}
              >
                <div className="min-w-0">
                  <p className="font-mono text-[13px] text-fg">{check.label}</p>
                  <p
                    className={cx(
                      "mt-1 font-mono text-xs tnum",
                      isBreach ? "text-breach" : isUndecided ? "text-pending" : "text-fg-muted",
                    )}
                  >
                    {check.expression}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {check.severity ? (
                    <Tag tone={check.severity === "MATERIAL" ? "breach" : "pending"} size="xs">
                      {check.severity}
                    </Tag>
                  ) : null}
                  <ResultBadge result={check.result} size="xs" />
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-xs leading-relaxed text-fg-dim">
          These comparisons are executed by the protocol. No model, validator, or third party is
          involved in resolving them.
        </p>
      </div>

      <div
        className={cx(
          "border-t px-4 py-4 sm:px-5",
          verification.semanticReview.status === "NOT_REQUIRED"
            ? "border-line"
            : "border-pending/25 bg-pending-dim/25",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="mono-label text-fg">Semantic review</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] tracking-[0.16em] text-fg-dim uppercase">
              GenLayer
            </span>
            <Tag tone={semanticTone[verification.semanticReview.status]} size="xs" dot>
              {semanticLabel[verification.semanticReview.status]}
            </Tag>
          </div>
        </div>

        {verification.semanticReview.question ? (
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-fg">
            {verification.semanticReview.question}
          </p>
        ) : null}
        {verification.semanticReview.rationale ? (
          <p className="mt-2 max-w-prose text-xs leading-relaxed text-fg-dim">
            {verification.semanticReview.rationale}
          </p>
        ) : null}

        {breaches.length > 0 && verification.semanticReview.status !== "NOT_REQUIRED" ? (
          <p className="mt-3 border-t border-line pt-3 font-mono text-[10px] leading-relaxed tracking-[0.12em] text-fg-faint uppercase">
            Contested term{breaches.length > 1 ? "s" : ""}:{" "}
            {breaches.map((b) => b.label).join(", ")}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
