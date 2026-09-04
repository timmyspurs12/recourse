import { cx } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { ResultBadge, Tag } from "@/components/system/StateBadge";
import type { PromiseProofRow } from "@/lib/types";

/**
 * PromiseProofComparison — what was promised against what was proven.
 *
 * One table in the DOM: rows collapse into stacked cards on small screens
 * rather than shrinking a desktop grid. The reasoning is always visible;
 * no term is ever summarised as a generic AI verdict.
 */
export function PromiseProofComparison({
  rows,
  title = "PROMISE VS PROOF",
  caption,
  className,
  showEvaluation = true,
}: {
  rows: PromiseProofRow[];
  title?: string;
  caption?: string;
  className?: string;
  showEvaluation?: boolean;
}) {
  const passed = rows.filter((r) => r.result === "PASS").length;
  const breached = rows.filter((r) => r.result === "BREACH").length;
  const undecided = rows.filter((r) => r.result === "INDETERMINATE").length;

  return (
    <Panel className={className}>
      <PanelHeader
        title={title}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag tone="pass" size="xs">{passed} pass</Tag>
            {breached > 0 ? (
              <Tag tone="breach" size="xs">{breached} breach</Tag>
            ) : null}
            {undecided > 0 ? (
              <Tag tone="pending" size="xs">{undecided} undecided</Tag>
            ) : null}
          </div>
        }
      />

      <div className="px-2 py-2 sm:px-3 sm:py-3 md:px-0 md:py-0">
        <table className="w-full border-collapse text-left">
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-line">
              <th scope="col" className="mono-label px-5 py-3 font-normal">
                Term
              </th>
              <th scope="col" className="mono-label px-5 py-3 font-normal">
                Promise
              </th>
              <th scope="col" className="mono-label px-5 py-3 font-normal">
                Proof
              </th>
              <th scope="col" className="mono-label px-5 py-3 text-right font-normal">
                Result
              </th>
            </tr>
          </thead>
          <tbody className="md:divide-y md:divide-line">
            {rows.map((row) => {
              const isBreach = row.result === "BREACH";
              const isUndecided = row.result === "INDETERMINATE";
              return (
                <tr
                  key={row.termId}
                  className={cx(
                    "mb-2 block border md:mb-0 md:table-row md:border-0 md:border-l-2",
                    isBreach
                      ? "border-breach/40 bg-breach-dim/40 md:border-l-breach"
                      : isUndecided
                        ? "border-pending/30 bg-pending-dim/25 md:border-l-pending"
                        : "border-line md:border-l-transparent md:bg-transparent",
                  )}
                >
                  <th
                    scope="row"
                    className="block px-4 pt-3 pb-1 text-left font-normal md:table-cell md:px-5 md:py-4 md:align-top"
                  >
                    <span className="block font-mono text-[13px] text-fg">{row.label}</span>
                    {showEvaluation ? (
                      <span className="mt-1 block font-mono text-[10px] tracking-[0.14em] text-fg-faint uppercase">
                        {row.evaluation === "SEMANTIC" ? "semantic" : "deterministic"}
                        {row.mandatory ? " · mandatory" : ""}
                      </span>
                    ) : null}
                  </th>

                  <td className="flex items-baseline justify-between gap-4 px-4 py-1 md:table-cell md:px-5 md:py-4 md:align-top">
                    <span className="mono-label md:hidden">Promise</span>
                    <span className="font-mono text-sm tnum text-fg-muted">{row.promise}</span>
                  </td>

                  <td className="flex items-baseline justify-between gap-4 px-4 py-1 md:table-cell md:px-5 md:py-4 md:align-top">
                    <span className="mono-label md:hidden">Proof</span>
                    <span
                      className={cx(
                        "font-mono text-sm tnum",
                        isBreach ? "text-breach" : isUndecided ? "text-pending" : "text-fg",
                      )}
                    >
                      {row.proof}
                    </span>
                  </td>

                  <td className="flex items-center justify-between gap-4 px-4 pt-2 pb-3 md:table-cell md:px-5 md:py-4 md:text-right md:align-top">
                    <span className="mono-label md:hidden">Result</span>
                    <ResultBadge result={row.result} size="xs" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {caption ? (
        <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-fg-dim sm:px-5">
          {caption}
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * Condensed promise/proof callout — used in the hero and demo flow where a
 * single contested term carries the story.
 */
export function PromiseProofCallout({
  label,
  promise,
  proof,
  verdict = "BREACH",
  className,
}: {
  label: string;
  promise: string;
  proof: string;
  verdict?: "BREACH" | "PASS";
  className?: string;
}) {
  const breach = verdict === "BREACH";
  return (
    <div
      className={cx(
        "grid grid-cols-2 border",
        breach ? "border-breach/35" : "border-pass/35",
        className,
      )}
    >
      <div className="border-r border-line px-4 py-4">
        <p className="mono-label">Promise</p>
        <p className="mt-2 font-mono text-lg tnum text-fg">{promise}</p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-fg-faint uppercase">
          {label}
        </p>
      </div>
      <div className={cx("px-4 py-4", breach ? "bg-breach-dim/40" : "bg-pass-dim/40")}>
        <p className="mono-label">Proof</p>
        <p className={cx("mt-2 font-mono text-lg tnum", breach ? "text-breach" : "text-pass")}>
          {proof}
        </p>
        <p
          className={cx(
            "mt-1 font-mono text-[10px] tracking-[0.14em] uppercase",
            breach ? "text-breach" : "text-pass",
          )}
        >
          {verdict}
        </p>
      </div>
    </div>
  );
}
