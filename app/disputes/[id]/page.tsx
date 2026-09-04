import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { promiseProofRows, railNodes } from "@/lib/selectors";
import { PageContainer } from "@/components/layout/Footer";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { DemoModeIndicator } from "@/components/system/Provenance";
import { DisputeHeader } from "@/components/protocol/DisputeHeader";
import { TransactionRail } from "@/components/protocol/TransactionRail";
import { AgreementPanel } from "@/components/protocol/AgreementPanel";
import { PaymentPanel } from "@/components/protocol/PaymentPanel";
import { EvidencePanel } from "@/components/protocol/EvidencePanel";
import { VerificationPanel } from "@/components/protocol/VerificationPanel";
import { PromiseProofComparison } from "@/components/protocol/PromiseProofComparison";
import { AdjudicationPanel, RulingPanel } from "@/components/protocol/AdjudicationPanel";
import { SettlementReceipt } from "@/components/protocol/SettlementReceipt";
import { TransactionEventStream } from "@/components/protocol/TransactionEvents";
import { DossierIndex } from "@/components/protocol/DossierIndex";

/** The ledger is mutable: demo runs write real records. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/disputes/[id]">): Promise<Metadata> {
  const { id } = await params;
  const dispute = await api.getDispute(id);
  if (!dispute) return { title: "Dispute not found" };
  return {
    title: `${dispute.ref} — ${dispute.title}`,
    description: dispute.claim,
  };
}

const SECTIONS = [
  { id: "agreement", label: "Purchase agreement" },
  { id: "payment", label: "Payment" },
  { id: "delivery", label: "Delivery" },
  { id: "evidence", label: "Evidence" },
  { id: "verification", label: "Verification" },
  { id: "adjudication", label: "Adjudication" },
  { id: "ruling", label: "Ruling" },
  { id: "settlement", label: "Settlement" },
];

export default async function DisputeDetailPage({ params }: PageProps<"/disputes/[id]">) {
  const { id } = await params;
  const dossier = await api.getDisputeDossier(id);
  if (!dossier || !dossier.dispute) notFound();

  const { order, agreement, payment, delivery, verification, dispute, settlement, events } = dossier;
  const rows = promiseProofRows(dossier);
  const nodes = railNodes(dossier);
  const minimumSources = agreement.terms.find((t) => t.id === "minimum_sources");
  const maxAge = agreement.terms.find((t) => t.id === "max_source_age_days");
  const breachedTerm =
    dispute.ruling?.breachedTerms[0]?.termId ??
    verification?.checks.find((c) => c.result === "BREACH")?.termId ??
    verification?.checks.find((c) => c.result === "INDETERMINATE")?.termId ??
    null;

  return (
    <PageContainer>
      <div className="py-8 sm:py-10">
        <DisputeHeader
          dispute={dispute}
          provenance={order.provenance}
          buyer={order.buyer}
          merchant={order.merchant}
          amount={order.amount}
          orderHref={`/orders/${order.id}`}
          breachedTerm={breachedTerm}
        />

        <Panel className="mt-4">
          <PanelHeader title="STATE PATH" meta="DISPUTE BRANCH" />
          <div className="px-4 py-6 sm:px-6">
            <TransactionRail nodes={nodes} />
          </div>
        </Panel>

        <DemoModeIndicator className="mt-4" />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] lg:items-start">
          <div className="flex flex-col gap-5">
            <section id="agreement" className="scroll-mt-24">
              <AgreementPanel agreement={agreement} />
            </section>

            <section id="payment" className="scroll-mt-24">
              <PaymentPanel payment={payment} />
            </section>

            <section id="delivery" className="scroll-mt-24">
              <Panel>
                <PanelHeader
                  title="DELIVERY"
                  meta={delivery ? delivery.artifact.format : "NOT SUBMITTED"}
                />
                <div className="px-4 py-4 sm:px-5">
                  <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
                    {delivery?.statement ?? "No delivery has been recorded against this order."}
                  </p>
                </div>
              </Panel>
            </section>

            <section id="evidence" className="scroll-mt-24">
              <EvidencePanel
                delivery={delivery}
                requiredSources={
                  typeof minimumSources?.promiseValue === "number" ? minimumSources.promiseValue : null
                }
                requiredMaxAgeDays={
                  typeof maxAge?.promiseValue === "number" ? maxAge.promiseValue : null
                }
              />
            </section>

            <section id="verification" className="scroll-mt-24 flex flex-col gap-5">
              <PromiseProofComparison
                rows={rows}
                caption="The contested term is the one row that failed. Everything else held."
              />
              <VerificationPanel verification={verification} />
            </section>

            <section id="adjudication" className="scroll-mt-24">
              <AdjudicationPanel adjudication={dispute.adjudication} />
            </section>

            <section id="ruling" className="scroll-mt-24">
              <RulingPanel ruling={dispute.ruling} />
            </section>

            <section id="settlement" className="scroll-mt-24">
              <SettlementReceipt
                settlement={settlement}
                buyer={order.buyer}
                merchant={order.merchant}
                disputeRef={dispute.ref}
              />
            </section>

            <TransactionEventStream events={events} title="EVIDENCE TRAIL" />
          </div>

          <aside className="lg:sticky lg:top-20">
            <DossierIndex sections={SECTIONS} title="EVIDENCE TRAIL" />
          </aside>
        </div>
      </div>
    </PageContainer>
  );
}
