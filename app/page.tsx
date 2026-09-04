import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";
import { promiseProofRows } from "@/lib/selectors";
import { FLAGSHIP_DISPUTE_ORDER_ID } from "@/lib/protocol-constants";
import { PageContainer } from "@/components/layout/Footer";
import { ActionLink } from "@/components/system/Actions";
import { SectionLabel } from "@/components/system/Panel";
import { HeroTransactionObject } from "@/components/protocol/HeroTransactionObject";
import { StackDiagram } from "@/components/protocol/StackDiagram";
import { LifecycleExplorer } from "@/components/protocol/LifecycleExplorer";
import { PromiseProofComparison } from "@/components/protocol/PromiseProofComparison";
import { OrderLedger } from "@/components/protocol/Ledgers";

/** The ledger is mutable: demo runs write real records. */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [dossier, orders] = await Promise.all([
    api.getOrderDossier(FLAGSHIP_DISPUTE_ORDER_ID),
    api.listOrders(),
  ]);
  const rows = dossier ? promiseProofRows(dossier) : [];

  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="relative border-b border-line">
        <div className="grid-field pointer-events-none absolute inset-0" aria-hidden />
        <PageContainer className="relative">
          <div className="grid grid-cols-1 items-start gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16 lg:py-20 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
            <div>
              <p className="mono-label text-protected">
                Recourse / Agent commerce infrastructure
              </p>
              <h1 className="mt-6 text-[clamp(2.5rem,7vw,4.5rem)] leading-[0.98] tracking-[-0.035em] text-balance">
                Payments got autonomous.
                <br />
                <span className="text-fg-dim">Refunds didn&rsquo;t.</span>
              </h1>
              <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-fg-muted">
                Recourse gives autonomous purchases a programmable chargeback path — from
                machine-readable promises to evidence-backed adjudication and settlement.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <ActionLink href="/demo" variant="primary" size="lg">
                  Run protected purchase
                  <ArrowRight className="size-3.5" aria-hidden />
                </ActionLink>
                <ActionLink href="/protocol" variant="secondary" size="lg">
                  View protocol
                </ActionLink>
              </div>

              <div className="mt-12 border-t border-line pt-6">
                <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {["PROMISE", "PAYMENT", "PROOF", "JUDGMENT", "SETTLEMENT"].map((phase, index) => (
                    <li key={phase} className="flex items-center gap-3">
                      {index > 0 ? (
                        <span className="font-mono text-[10px] text-fg-faint" aria-hidden>
                          →
                        </span>
                      ) : null}
                      <span className="font-mono text-[10px] tracking-[0.18em] text-fg-dim uppercase">
                        {phase}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 max-w-lg text-sm leading-relaxed text-fg-dim">
                  A protected transaction ends one of two ways: the promise is satisfied and funds
                  release, or the promise is breached and funds return.
                </p>
              </div>
            </div>

            <HeroTransactionObject />
          </div>
        </PageContainer>
      </section>

      {/* ------------------------------------------- autonomous payment */}
      <section className="border-b border-line py-16 sm:py-20">
        <PageContainer>
          <SectionLabel index="01">The gap</SectionLabel>
          <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
            <div>
              <h2 className="text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.05] tracking-[-0.02em] text-balance">
                Autonomous payment is not enough.
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-fg-muted">
                An agent can now pay a merchant in seconds, without a human, across a rail that
                settles instantly and irreversibly. That is exactly the problem: the moment value
                moves, the buyer&rsquo;s only recourse is a conversation nobody is having.
              </p>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-fg-muted">
                Human commerce solved this decades ago with chargebacks. Autonomous commerce has no
                equivalent — until the promise itself becomes machine-readable.
              </p>
            </div>
            <StackDiagram />
          </div>
        </PageContainer>
      </section>

      {/* ------------------------------------------------------ lifecycle */}
      <section className="border-b border-line py-16 sm:py-20">
        <PageContainer>
          <SectionLabel index="02">Protocol lifecycle</SectionLabel>
          <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <h2 className="max-w-xl text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.05] tracking-[-0.02em] text-balance">
              Six operations between payment and settlement.
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-fg-muted">
              Most transactions never leave the deterministic path. Adjudication exists for the ones
              that do.
            </p>
          </div>
          <LifecycleExplorer className="mt-8" />
        </PageContainer>
      </section>

      {/* --------------------------------------------- promise vs proof */}
      <section className="border-b border-line py-16 sm:py-20">
        <PageContainer>
          <SectionLabel index="03">Promise vs proof</SectionLabel>
          <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-14">
            <div>
              <h2 className="text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.05] tracking-[-0.02em] text-balance">
                A dispute is a diff.
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-fg-muted">
                Recourse never asks you to trust a verdict. Every contested transaction is presented
                as a row-by-row comparison between what was promised and what was proven.
              </p>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-fg-muted">
                In case{" "}
                <Link
                  href={`/disputes/dsp_${FLAGSHIP_DISPUTE_ORDER_ID.toLowerCase()}`}
                  className="font-mono text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg-muted"
                >
                  RC / 000042
                </Link>
                , three terms passed and one failed. The failure is arithmetic. Whether it was
                material is the only question that needed judgment.
              </p>
              <ActionLink
                href={`/disputes/dsp_${FLAGSHIP_DISPUTE_ORDER_ID.toLowerCase()}`}
                variant="secondary"
                size="md"
                className="mt-8"
              >
                Open the dossier
                <ArrowUpRight className="size-3.5" aria-hidden />
              </ActionLink>
            </div>

            <PromiseProofComparison
              rows={rows}
              caption="Deterministic terms are resolved by the protocol. Only the semantic term is eligible for adjudication."
            />
          </div>
        </PageContainer>
      </section>

      {/* --------------------------------------------------- two outcomes */}
      <section className="border-b border-line py-16 sm:py-20">
        <PageContainer>
          <SectionLabel index="04">Terminal states</SectionLabel>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            <article className="border border-pass/30 bg-pass-dim/20 p-6 sm:p-8">
              <p className="mono-label text-pass">Promise satisfied</p>
              <h3 className="mt-5 font-mono text-2xl tracking-[0.02em] text-fg uppercase">
                Release
              </h3>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-fg-muted">
                Every mandatory term passed deterministic verification. Escrow settles to the
                merchant agent, and nothing is referred anywhere.
              </p>
              <p className="mt-6 border-t border-pass/20 pt-4 font-mono text-[10px] tracking-[0.14em] text-pass uppercase">
                Fulfilled → Released
              </p>
            </article>

            <article className="border border-protected/30 bg-protected-dim/20 p-6 sm:p-8">
              <p className="mono-label text-protected">Promise breached</p>
              <h3 className="mt-5 font-mono text-2xl tracking-[0.02em] text-fg uppercase">
                Refund
              </h3>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-fg-muted">
                A mandatory term failed and the breach was ruled material. The remedy written into
                the agreement executes: escrow returns to the buyer agent.
              </p>
              <p className="mt-6 border-t border-protected/20 pt-4 font-mono text-[10px] tracking-[0.14em] text-protected uppercase">
                Disputed → Adjudicating → Buyer won → Refunded
              </p>
            </article>
          </div>
        </PageContainer>
      </section>

      {/* ------------------------------------------------------- ledger */}
      <section className="border-b border-line py-16 sm:py-20">
        <PageContainer>
          <SectionLabel index="05">Transaction ledger</SectionLabel>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="max-w-xl text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.05] tracking-[-0.02em] text-balance">
              Every protected purchase, on the record.
            </h2>
            <ActionLink href="/orders" variant="secondary" size="md">
              Open ledger
              <ArrowUpRight className="size-3.5" aria-hidden />
            </ActionLink>
          </div>
          <OrderLedger orders={orders.slice(0, 5)} title="RECENT ORDERS" className="mt-8" />
        </PageContainer>
      </section>

      {/* -------------------------------------------------------- closing */}
      <section className="py-20 sm:py-28">
        <PageContainer>
          <div className="border border-line bg-panel px-6 py-12 sm:px-12 sm:py-16">
            <p className="font-mono text-[10px] tracking-[0.2em] text-fg-faint uppercase">
              Promise → Payment → Proof → Judgment → Settlement
            </p>
            <p className="mt-6 max-w-3xl text-[clamp(1.5rem,4vw,2.5rem)] leading-[1.1] tracking-[-0.02em] text-balance">
              Autonomous commerce needs more than autonomous payments. It needs autonomous recourse.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <ActionLink href="/demo" variant="primary" size="lg">
                Run protected purchase
                <ArrowRight className="size-3.5" aria-hidden />
              </ActionLink>
              <ActionLink href="/developers" variant="secondary" size="lg">
                Read developer docs
              </ActionLink>
            </div>
          </div>
        </PageContainer>
      </section>
    </>
  );
}
