import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/layout/Footer";
import { DemoModeIndicator } from "@/components/system/Provenance";
import { DemoConsole } from "@/components/demo/DemoConsole";
import { getRuntime } from "@/server/runtime";

/** Demo runs write real records, so nothing here may be cached. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Execute a protected purchase end to end: promise, payment, proof, judgment, settlement.",
};

export default async function DemoPage() {
  const { info } = getRuntime();

  const detail = info.adjudication.available
    ? `Adjudication is real: contested terms are submitted to the RecourseAdjudicator Intelligent Contract on ${info.adjudication.network} and ruled on by live validators. ${info.payment.note}`
    : `No adjudication forum is configured, so the dispute path will stop at ADJUDICATING. ${info.payment.note}`;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Demo / Protected purchase"
        title="Run an autonomous purchase with a refund path."
        description="Two agents, one machine-readable agreement, and $1.00 USDC held under protection. Choose whether the merchant keeps its promise."
        meta={
          <DemoModeIndicator
            mode={info.mode}
            tone={info.adjudication.available ? "pass" : "pending"}
            label={info.adjudication.available ? "LIVE ADJUDICATION" : "NO FORUM CONFIGURED"}
            detail={detail}
          />
        }
      />
      <div className="mt-8">
        <DemoConsole
          forumAvailable={info.adjudication.available}
          forumDescription={info.adjudication.description}
        />
      </div>
    </PageContainer>
  );
}
