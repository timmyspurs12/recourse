import { PageContainer } from "@/components/layout/Footer";
import { ProtocolErrorState } from "@/components/system/States";
import { ActionLink } from "@/components/system/Actions";

export default function DisputeNotFound() {
  return (
    <PageContainer>
      <div className="py-20">
        <ProtocolErrorState
          tone="neutral"
          code="DISPUTE_NOT_FOUND"
          title="Dispute not found"
          description="No recourse claim with this reference exists in the current data adapter. Not every order has a dispute — a satisfied promise never becomes one."
          action={
            <div className="flex flex-wrap gap-3">
              <ActionLink href="/disputes" variant="primary" size="md">
                Open dispute ledger
              </ActionLink>
              <ActionLink href="/cases" variant="secondary" size="md">
                View cases
              </ActionLink>
            </div>
          }
        />
      </div>
    </PageContainer>
  );
}
