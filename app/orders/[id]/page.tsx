import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { promiseProofRows, railNodes } from "@/lib/selectors";
import { PageContainer } from "@/components/layout/Footer";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { DemoModeIndicator } from "@/components/system/Provenance";
import { ActionLink } from "@/components/system/Actions";
import { TransactionHeader } from "@/components/protocol/TransactionHeader";
import { TransactionRail } from "@/components/protocol/TransactionRail";
import { AgreementPanel } from "@/components/protocol/AgreementPanel";
import { PaymentPanel } from "@/components/protocol/PaymentPanel";
import { EvidencePanel } from "@/components/protocol/EvidencePanel";
import { VerificationPanel } from "@/components/protocol/VerificationPanel";
import { PromiseProofComparison } from "@/components/protocol/PromiseProofComparison";
import { SettlementReceipt } from "@/components/protocol/SettlementReceipt";
import { TransactionEventStream } from "@/components/protocol/TransactionEvents";
import { DossierIndex } from "@/components/protocol/DossierIndex";

/** The ledger is mutable: demo runs write real records. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/orders/[id]">): Promise<Metadata> {
  const { id } = await params;
  const order = await api.getOrder(id);
  if (!order) return { title: "Order not found" };
  return {
    title: `${order.ref} — ${order.title}`,
    description: `${order.title}. Status ${order.status}.`,
  };
}

const SECTIONS = [
  { id: "agreement", label: "Purchase agreement" },
  { id: "payment", label: "Payment" },
  { id: "delivery", label: "Delivery & evidence" },
  { id: "verification", label: "Verification" },
  { id: "settlement", label: "Settlement" },
  { id: "log", label: "Transaction log" },
];

export default async function OrderDetailPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const dossier = await api.getOrderDossier(id);
  if (!dossier) notFound();

  const { order, agreement, payment, delivery, verification, dispute, settlement, events } = dossier;
  const rows = promiseProofRows(dossier);
  const nodes = railNodes(dossier);
  const minimumSources = agreement.terms.find((t) => t.id === "minimum_sources");
  const maxAge = agreement.terms.find((t) => t.id === "max_source_age_days");

  return (
    <PageContainer>
      <div className="py-8 sm:py-10">
        <TransactionHeader
          order={order}
          disputeHref={dispute ? `/disputes/${dispute.id}` : undefined}
        />

        <Panel className="mt-4">
          <PanelHeader
            title="STATE PATH"
            meta={dispute ? "DISPUTE BRANCH" : "DIRECT PATH"}
            actions={
              dispute ? (
                <ActionLink href={`/disputes/${dispute.id}`} variant="secondary" size="sm">
                  Dispute dossier
                </ActionLink>
              ) : null
            }
          />
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
                caption={
                  verification
                    ? undefined
                    : "Delivery has not been verified against these terms yet, so no proof values exist. Nothing is inferred in the meantime."
                }
              />
              <VerificationPanel verification={verification} />
            </section>

            <section id="settlement" className="scroll-mt-24">
              <SettlementReceipt
                settlement={settlement}
                buyer={order.buyer}
                merchant={order.merchant}
                disputeRef={dispute?.ref ?? null}
              />
            </section>

            <section id="log" className="scroll-mt-24">
              <TransactionEventStream events={events} />
            </section>
          </div>

          <aside className="lg:sticky lg:top-20">
            <DossierIndex sections={SECTIONS} />
          </aside>
        </div>
      </div>
    </PageContainer>
  );
}
