import type { Metadata } from "next";
import { api } from "@/lib/api";
import { FLAGSHIP_DISPUTE_ORDER_ID, FLAGSHIP_SUCCESS_ORDER_ID } from "@/lib/protocol-constants";
import { railNodes } from "@/lib/selectors";
import { PageContainer, PageHeader } from "@/components/layout/Footer";
import { Panel, PanelHeader, SectionLabel } from "@/components/system/Panel";
import { ActionLink } from "@/components/system/Actions";
import { StackDiagram } from "@/components/protocol/StackDiagram";
import { LifecycleExplorer } from "@/components/protocol/LifecycleExplorer";
import { TransactionRail } from "@/components/protocol/TransactionRail";
import { LIFECYCLE } from "@/lib/content/lifecycle";

/** The ledger is mutable: demo runs write real records. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Protocol",
  description:
    "How Recourse works: x402 moves the payment, Recourse defines the protection it carries, GenLayer adjudicates contested fulfillment, and the final state becomes settlement.",
};

export default async function ProtocolPage() {
  const [success, dispute] = await Promise.all([
    api.getOrderDossier(FLAGSHIP_SUCCESS_ORDER_ID),
    api.getOrderDossier(FLAGSHIP_DISPUTE_ORDER_ID),
  ]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Protocol"
        title="A payment that still means something after it settles."
        description="Recourse sits between an autonomous payment and its final settlement. It holds the value, holds the promise, and executes whichever outcome the evidence supports."
        actions={
          <ActionLink href="/demo" variant="primary" size="md">
            Run the demo
          </ActionLink>
        }
      />

      {/* ------------------------------------------------ why recourse */}
      <section className="py-14 sm:py-16">
        <SectionLabel index="01">Why Recourse</SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.1] tracking-[-0.02em] text-balance">
              Agents can pay. They cannot argue.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-fg-muted">
              Card networks made consumer commerce safe with a mechanism most people never think
              about: the chargeback. If the promise attached to a payment is broken, the money can
              come back. That mechanism assumes a human will notice, complain, and be believed.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">
              Autonomous agents break all three assumptions. They transact continuously, in amounts
              too small to be worth a human complaint, on rails that settle instantly. Without a
              programmable equivalent, every agent-to-agent purchase is final regardless of what was
              delivered.
            </p>
          </div>

          <Panel>
            <PanelHeader title="THE SHIFT" />
            <dl className="divide-y divide-line">
              {[
                {
                  term: "Human commerce",
                  detail: "Promise in prose · dispute by complaint · refund by institution",
                },
                {
                  term: "Agent commerce today",
                  detail: "Promise in prose · payment autonomous · no dispute path at all",
                },
                {
                  term: "Agent commerce with Recourse",
                  detail: "Promise in code · verification deterministic · remedy programmable",
                },
              ].map((row, index) => (
                <div key={row.term} className="px-5 py-5">
                  <dt className="flex items-center gap-3">
                    <span className="font-mono text-[10px] tnum text-fg-faint">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-[11px] tracking-[0.14em] text-fg uppercase">
                      {row.term}
                    </span>
                  </dt>
                  <dd className="mt-2 pl-7 font-mono text-xs leading-relaxed text-fg-dim">
                    {row.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </section>

      {/* ------------------------------------------------- how it works */}
      <section className="border-t border-line py-14 sm:py-16">
        <SectionLabel index="02">How it works</SectionLabel>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-14">
          <StackDiagram />
          <div className="space-y-5 border-l border-line pl-6 lg:pl-8">
            <p className="text-[15px] leading-relaxed text-fg-muted">
              <span className="font-mono text-fg">x402</span> moves the payment.
            </p>
            <p className="text-[15px] leading-relaxed text-fg-muted">
              <span className="font-mono text-fg">Recourse</span> defines what protection the
              payment carries.
            </p>
            <p className="text-[15px] leading-relaxed text-fg-muted">
              <span className="font-mono text-fg">GenLayer</span> adjudicates contested fulfillment
              when semantic judgment is required.
            </p>
            <p className="text-[15px] leading-relaxed text-fg-muted">
              The final state becomes economic settlement.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 border border-line bg-panel px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="mono-label">Settlement</p>
            <p className="mt-2 font-mono text-xl text-fg">Release / Refund</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="border border-pass/35 bg-pass-dim px-3 py-2 font-mono text-[10px] tracking-[0.14em] text-pass uppercase">
              Promise satisfied → escrow to merchant
            </span>
            <span className="border border-protected/35 bg-protected-dim px-3 py-2 font-mono text-[10px] tracking-[0.14em] text-protected uppercase">
              Promise breached → escrow to buyer
            </span>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- lifecycle */}
      <section className="border-t border-line py-14 sm:py-16">
        <SectionLabel index="03">Lifecycle</SectionLabel>
        <LifecycleExplorer className="mt-8" />
        <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {LIFECYCLE.map((step) => (
            <li key={step.id} className="border border-line bg-surface px-3 py-3">
              <span className="font-mono text-[10px] tnum tracking-[0.14em] text-fg-faint">
                {step.index}
              </span>
              <span className="mt-1.5 block font-mono text-[11px] tracking-[0.14em] text-fg uppercase">
                {step.title}
              </span>
              <span className="mt-1.5 block text-[11px] leading-relaxed text-fg-dim">
                {step.summary}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* -------------------------------------- deterministic vs semantic */}
      <section className="border-t border-line py-14 sm:py-16">
        <SectionLabel index="04">Division of labour</SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="DETERMINISTIC — RESOLVED BY THE PROTOCOL" />
            <div className="px-5 py-5">
              <ul className="space-y-3 font-mono text-sm text-fg-muted">
                <li>2 &lt; 5 → breach</li>
                <li>12 ≤ 30 → pass</li>
                <li>4 = 4 → pass</li>
                <li>&quot;Lagos&quot; = &quot;Lagos&quot; → pass</li>
              </ul>
              <p className="mt-5 border-t border-line pt-4 text-sm leading-relaxed text-fg-dim">
                Counting sources is not judgment. Recourse resolves these itself, records the
                comparison, and never spends adjudication on arithmetic.
              </p>
            </div>
          </Panel>

          <Panel className="border-pending/25">
            <PanelHeader title="SEMANTIC — REFERRED TO GENLAYER" />
            <div className="px-5 py-5">
              <ul className="space-y-3 text-sm text-fg-muted">
                <li>Was the shortfall material to what the buyer paid for?</li>
                <li>Do two runs from one publisher count as distinct sources?</li>
                <li>Does the delivered scope match the accepted scope?</li>
              </ul>
              <p className="mt-5 border-t border-line pt-4 text-sm leading-relaxed text-fg-dim">
                These questions have no arithmetic answer. They are the only reason a decentralised
                adjudication layer is in the stack at all.
              </p>
            </div>
          </Panel>
        </div>
      </section>

      {/* ------------------------------------------------ state machine */}
      <section className="border-t border-line py-14 sm:py-16">
        <SectionLabel index="05">State machine</SectionLabel>
        <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-fg-muted">
          A protected transaction has two terminal states. Both are first-class: the protocol is not
          designed around the assumption that merchants cheat, nor that buyers are always right.
        </p>

        <div className="mt-8 flex flex-col gap-4">
          {success ? (
            <Panel>
              <PanelHeader title="PATH A — PROMISE SATISFIED" meta={success.order.ref} />
              <div className="px-4 py-6 sm:px-6">
                <TransactionRail nodes={railNodes(success)} />
              </div>
            </Panel>
          ) : null}

          {dispute ? (
            <Panel>
              <PanelHeader title="PATH B — PROMISE BREACHED" meta={dispute.order.ref} />
              <div className="px-4 py-6 sm:px-6">
                <TransactionRail nodes={railNodes(dispute)} />
              </div>
            </Panel>
          ) : null}

          <Panel tone="quiet">
            <PanelHeader title="PATH C — CONTESTED, MERCHANT UPHELD" />
            <div className="px-4 py-6 sm:px-6">
              <p className="font-mono text-xs leading-relaxed tracking-[0.1em] text-fg-muted uppercase">
                Adjudicating → Merchant won → Released
              </p>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-dim">
                When a claim is not supported by the locked agreement, escrow releases to the
                merchant. Opening recourse is not a refund button.
              </p>
            </div>
          </Panel>
        </div>
      </section>

      {/* ---------------------------------------------------- closing */}
      <section className="border-t border-line py-14 sm:py-20">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-[clamp(1.25rem,2.5vw,1.75rem)] leading-snug tracking-[-0.01em] text-balance">
            The promise is the contract. The evidence is the argument. The settlement is the verdict.
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionLink href="/demo" variant="primary" size="md">
              Run the demo
            </ActionLink>
            <ActionLink href="/developers" variant="secondary" size="md">
              Integrate
            </ActionLink>
          </div>
        </div>
      </section>
    </PageContainer>
  );
}
