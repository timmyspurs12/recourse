"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, RotateCcw } from "lucide-react";
import type { OrderDossier } from "@/lib/types";
import { promiseProofRows, railNodes } from "@/lib/selectors";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { StateBadge } from "@/components/system/StateBadge";
import { Amount, Timestamp } from "@/components/system/Values";
import { HashValue } from "@/components/system/HashValue";
import { AgentIdentity } from "@/components/system/AgentIdentity";
import { ActionButton } from "@/components/system/Actions";
import { AgreementPanel } from "@/components/protocol/AgreementPanel";
import { PromiseProofComparison } from "@/components/protocol/PromiseProofComparison";
import { VerificationPanel } from "@/components/protocol/VerificationPanel";
import { AdjudicationPanel, RulingPanel } from "@/components/protocol/AdjudicationPanel";
import { SettlementReceipt } from "@/components/protocol/SettlementReceipt";
import { TransactionRail } from "@/components/protocol/TransactionRail";
import { TransactionEventStream } from "@/components/protocol/TransactionEvents";
import { EvidencePanel } from "@/components/protocol/EvidencePanel";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

type Path = "SUCCESS" | "DISPUTE";

interface RunResponse {
  path: Path;
  dossier: OrderDossier;
  done: boolean;
  waiting: boolean;
}

interface ApiError {
  error: { code: string; message: string };
}

const PATHS: Array<{ id: Path; label: string; note: string }> = [
  {
    id: "DISPUTE",
    label: "Promise breached",
    note: "Merchant delivers 2 of 5 required sources",
  },
  {
    id: "SUCCESS",
    label: "Promise satisfied",
    note: "Merchant meets every mandatory term",
  },
];

/** Mirrors server/scenario.ts — shown before a run so the promise is legible up front. */
const PREVIEW_TERMS = [
  { label: "Minimum sources", promise: "\u2265 5", mode: "deterministic" },
  { label: "Maximum source age", promise: "\u2264 30 days", mode: "deterministic" },
  { label: "Geographic scope", promise: "Lagos, Nigeria", mode: "deterministic" },
  { label: "Required sections", promise: "4", mode: "deterministic" },
  { label: "Material accuracy", promise: "No material misstatement", mode: "semantic" },
];

/** Poll cadence while GenLayer validators reach consensus. */
const WAIT_INTERVAL_MS = 4_000;
const STEP_INTERVAL_MS = 900;
const MAX_WAIT_MS = 300_000;

/**
 * DemoConsole — a live protected purchase.
 *
 * Every stage on screen is real application state. The client asks the server
 * to take the next legal step and re-renders whatever the protocol reports; it
 * cannot skip ahead, and it has no scripted timeline to fall back on. When the
 * dispute path reaches GenLayer, the wait is a genuine wait for consensus.
 */
export function DemoConsole({
  forumAvailable,
  forumDescription,
}: {
  forumAvailable: boolean;
  forumDescription: string;
}) {
  const [path, setPath] = useState<Path>("DISPUTE");
  const [dossier, setDossier] = useState<OrderDossier | null>(null);
  const [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const cancelled = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const post = useCallback(async (url: string, body: unknown): Promise<RunResponse> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as RunResponse | ApiError;
    if (!response.ok) {
      const failure = payload as ApiError;
      throw Object.assign(new Error(failure.error?.message ?? "Protocol error"), {
        code: failure.error?.code ?? "INTERNAL",
      });
    }
    return payload as RunResponse;
  }, []);

  const run = useCallback(async () => {
    cancelled.current = false;
    setRunning(true);
    setDone(false);
    setError(null);
    setDossier(null);
    setWaiting(false);

    try {
      let state = await post("/api/demo/run", { path });
      setDossier(state.dossier);
      const orderId = state.dossier.order.id;
      const startedAt = Date.now();

      while (!state.done && !cancelled.current) {
        if (Date.now() - startedAt > MAX_WAIT_MS) {
          setError({
            code: "ADJUDICATION_PENDING",
            message:
              "Adjudication has not reached consensus within the demo window. The order remains ADJUDICATING; escrow stays held.",
          });
          break;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, state.waiting ? WAIT_INTERVAL_MS : STEP_INTERVAL_MS),
        );
        if (cancelled.current) return;

        state = await post("/api/demo/advance", { orderId, path });
        setDossier(state.dossier);
        setWaiting(state.waiting);
      }

      if (!cancelled.current) setDone(state.done);
    } catch (caught) {
      const failure = caught as Error & { code?: string };
      if (!cancelled.current) {
        setError({ code: failure.code ?? "INTERNAL", message: failure.message });
      }
    } finally {
      if (!cancelled.current) {
        setRunning(false);
        setWaiting(false);
      }
    }
  }, [path, post]);

  const reset = useCallback(() => {
    cancelled.current = true;
    setDossier(null);
    setRunning(false);
    setWaiting(false);
    setDone(false);
    setError(null);
    // Allow a subsequent run to proceed.
    window.setTimeout(() => {
      cancelled.current = false;
    }, 0);
  }, []);

  const rows = dossier ? promiseProofRows(dossier) : [];
  /*
   * The headline number of this whole protocol: how much was settled by
   * arithmetic versus how little needed judgment. It is the difference between
   * this and "ask an LLM to read the evidence", so it should not require
   * reading three panels to notice.
   */
  const localChecks = dossier?.verification?.checks.length ?? 0;
  const referred =
    dossier?.dispute && dossier.verification ? 1 : 0;
  const nodes = dossier ? railNodes(dossier) : [];
  const adjudication = dossier?.dispute?.adjudication ?? null;
  const requiredSources = dossier?.agreement.terms.find((t) => t.id === "minimum_sources");
  const requiredAge = dossier?.agreement.terms.find((t) => t.id === "max_source_age_days");

  return (
    <div className="flex flex-col gap-6">
      {/* ------------------------------------------------------ control bar */}
      <div className="sticky top-14 z-30 -mx-4 border-y border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:border-x">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="flex flex-col overflow-hidden border border-line sm:flex-row"
            role="radiogroup"
            aria-label="Demonstration path"
          >
            {PATHS.map((option) => {
              const active = option.id === path;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={running}
                  onClick={() => setPath(option.id)}
                  className={`px-4 py-2 text-left transition-colors disabled:opacity-50 ${
                    active ? "bg-raised" : "bg-transparent hover:bg-surface"
                  }`}
                >
                  <span
                    className={`mono-label block ${active ? "text-fg" : "text-fg-dim"}`}
                  >
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs text-fg-faint">{option.note}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <ActionButton variant="primary" onClick={run} disabled={running}>
              {running ? (
                <>
                  <Loader2
                    className={`h-3.5 w-3.5 ${reducedMotion ? "" : "animate-spin"}`}
                    aria-hidden
                  />
                  Running
                </>
              ) : (
                <>
                  Run protected purchase
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </>
              )}
            </ActionButton>
            <ActionButton variant="secondary" onClick={reset} disabled={running}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Reset
            </ActionButton>
          </div>
        </div>

        {nodes.length > 0 ? <TransactionRail nodes={nodes} className="mt-4" compact /> : null}

        {localChecks > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3">
            <span className="mono-label text-fg-faint">Verification split</span>
            <span className="font-mono text-xs text-pass">
              {localChecks} resolved locally
              <span className="ml-2 text-fg-faint">no model involved</span>
            </span>
            <span className="font-mono text-xs text-pending">
              {referred} referred to GenLayer
              <span className="ml-2 text-fg-faint">
                {referred === 0 ? "arithmetic settled every term" : "materiality only"}
              </span>
            </span>
          </div>
        ) : null}
      </div>

      {/* ---------------------------------------------------------- notices */}
      {!forumAvailable ? (
        <div className="border border-pending/40 bg-pending-dim px-4 py-3">
          <p className="mono-label text-pending">Adjudication forum unavailable</p>
          <p className="mt-2 text-sm text-fg-muted">
            {forumDescription} The dispute path will stop at ADJUDICATING and the escrow will stay
            held — which is exactly what the protocol should do when no forum can rule.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="border border-breach/40 bg-breach-dim px-4 py-3">
          <p className="mono-label text-breach">{error.code}</p>
          <p className="mt-2 text-sm text-fg-muted">{error.message}</p>
        </div>
      ) : null}

      {!dossier ? (
        <Panel>
          <PanelHeader title="LIVE RUN" />
          <div className="px-5 py-10 sm:px-6">
            <p className="max-w-2xl text-[15px] leading-relaxed text-fg-muted">
              This executes a real protected purchase against the running protocol: the agreement is
              hashed and locked before payment, the delivery is verified deterministically, and a
              contested term is referred to GenLayer for adjudication. Nothing on this page is a
              scripted animation.
            </p>
            <dl className="mt-6 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="mono-label">Resource</dt>
                <dd className="mt-1 text-sm text-fg">Lagos Consumer Commerce Brief</dd>
              </div>
              <div>
                <dt className="mono-label">Value</dt>
                <dd className="mt-1 font-mono text-sm text-fg tnum">$1.00 USDC</dd>
              </div>
              <div>
                <dt className="mono-label">Adjudication</dt>
                <dd className="mt-1 text-sm text-fg">{forumDescription}</dd>
              </div>
            </dl>

            <div className="mt-8 border-t border-line pt-6">
              <p className="mono-label">The agreement that will be enforced</p>
              <ul className="mt-3 flex flex-col divide-y divide-line border border-line">
                {PREVIEW_TERMS.map((entry) => (
                  <li
                    key={entry.label}
                    className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-2.5"
                  >
                    <span className="text-sm text-fg-muted">
                      {entry.label}
                      <span className="mono-label ml-3 text-fg-faint">{entry.mode}</span>
                    </span>
                    <span className="font-mono text-sm tnum text-fg">{entry.promise}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 max-w-2xl text-xs leading-relaxed text-fg-dim">
                Four of these are settled by arithmetic inside the protocol. Only the last one can
                ever reach GenLayer, and only when a party contests it.
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      {/* ----------------------------------------------------------- output */}
      {dossier ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
          <div className="flex flex-col gap-4 lg:sticky lg:top-44">
            <Panel>
              <PanelHeader
                title={dossier.order.ref}
                actions={<StateBadge status={dossier.order.status} />}
              />
              <div className="grid-field px-5 py-4 sm:px-6">
                <AgentIdentity agent={dossier.order.buyer} />
                <AgentIdentity agent={dossier.order.merchant} className="mt-3" />
              </div>
              <div className="border-t border-line px-5 py-4 sm:px-6">
                <Amount money={dossier.order.amount} size="lg" />
                <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                  {dossier.order.description}
                </p>
              </div>
              <div className="border-t border-line px-5 py-4 sm:px-6">
                <p className="mono-label">Escrow</p>
                <p className="mt-1 font-mono text-sm text-fg">{dossier.payment.escrow}</p>
                {dossier.settlement?.settledAt ? (
                  <p className="mt-3 font-mono text-xs text-fg-dim">
                    <Timestamp iso={dossier.settlement.settledAt} prefix="Settled" />
                  </p>
                ) : null}
              </div>
              {waiting ? (
                <div className="border-t border-line bg-pending-dim px-5 py-4 sm:px-6">
                  <p className="mono-label text-pending">Awaiting consensus</p>
                  <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                    The adjudication transaction is on the network. Validators are ruling
                    independently; this panel updates when the receipt finalizes.
                  </p>
                </div>
              ) : null}
              {done ? (
                <div className="border-t border-line px-5 py-4 sm:px-6">
                  <p className="mono-label text-fg-dim">Run complete</p>
                  <a
                    href={`/orders/${dossier.order.id}`}
                    className="mt-2 inline-flex items-center gap-2 font-mono text-xs text-protected underline-offset-4 hover:underline"
                  >
                    Open the full dossier
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </a>
                </div>
              ) : null}
            </Panel>
          </div>

          <div className="flex flex-col gap-6">
            <AgreementPanel agreement={dossier.agreement} />

            {dossier.delivery ? (
              <EvidencePanel
                delivery={dossier.delivery}
                requiredSources={
                  typeof requiredSources?.promiseValue === "number"
                    ? requiredSources.promiseValue
                    : null
                }
                requiredMaxAgeDays={
                  typeof requiredAge?.promiseValue === "number" ? requiredAge.promiseValue : null
                }
              />
            ) : null}

            {rows.length > 0 ? <PromiseProofComparison rows={rows} /> : null}

            {dossier.verification ? (
              <VerificationPanel verification={dossier.verification} />
            ) : null}

            {dossier.dispute ? (
              <>
                <AdjudicationPanel adjudication={adjudication} />
                <RulingPanel ruling={dossier.dispute.ruling} />
              </>
            ) : null}

            {dossier.settlement ? (
              <SettlementReceipt
                settlement={dossier.settlement}
                buyer={dossier.order.buyer}
                merchant={dossier.order.merchant}
                disputeRef={dossier.dispute?.ref ?? null}
              />
            ) : null}

            {done && dossier.settlement ? (
              <Panel>
                <div className="px-5 py-6 sm:px-6">
                  <p className="mono-label text-fg-dim">
                    {dossier.settlement.outcome === "REFUNDED"
                      ? "Promise breached"
                      : "Promise satisfied"}
                  </p>
                  <p className="mt-3 text-lg leading-snug text-fg">
                    {dossier.settlement.outcome === "REFUNDED"
                      ? "The buyer got their money back without a support ticket, a human reviewer or a card network."
                      : "The merchant was paid the moment the promise was proven. Recourse is not a tax on honest sellers."}
                  </p>
                  {adjudication?.transaction.value ? (
                    <div className="mt-4">
                      <p className="mono-label">Adjudication transaction</p>
                      <HashValue attested={adjudication.transaction} className="mt-1" />
                    </div>
                  ) : null}
                </div>
              </Panel>
            ) : null}

            <TransactionEventStream events={dossier.events} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
