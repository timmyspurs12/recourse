import type { Metadata } from "next";
import { api } from "@/lib/api";
import { PageContainer, PageHeader } from "@/components/layout/Footer";
import { DemoModeIndicator } from "@/components/system/Provenance";
import { CaseLedger } from "@/components/protocol/Ledgers";
import { ActionLink } from "@/components/system/Actions";

/** The ledger is mutable: demo runs write real records. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cases",
  description: "Protocol case ledger: contested purchases, breached terms, outcomes and settlements.",
};

export default async function CasesPage() {
  const cases = await api.listCases();
  const settled = cases.filter((c) => c.settlement !== null).length;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Ledger / Cases"
        title="Protocol cases"
        description="Each case records what was promised, which term failed, how it was decided, and where the money ended up."
        actions={
          <ActionLink href="/disputes" variant="secondary" size="md">
            View dispute claims
          </ActionLink>
        }
        meta={<DemoModeIndicator />}
      />

      <div className="py-8">
        <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 border border-line bg-surface px-4 py-3">
          <span className="font-mono text-[10px] tracking-[0.14em] text-fg-dim uppercase">
            {cases.length} cases on record
          </span>
          <span className="font-mono text-[10px] tracking-[0.14em] text-fg-dim uppercase">
            {settled} settled
          </span>
          <span className="font-mono text-[10px] tracking-[0.14em] text-fg-faint uppercase">
            {cases.length - settled} awaiting settlement
          </span>
        </div>

        <CaseLedger cases={cases} />
      </div>
    </PageContainer>
  );
}
