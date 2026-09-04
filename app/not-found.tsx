import { PageContainer } from "@/components/layout/Footer";
import { ProtocolErrorState } from "@/components/system/States";
import { ActionLink } from "@/components/system/Actions";

export default function NotFound() {
  return (
    <PageContainer>
      <div className="py-20">
        <ProtocolErrorState
          tone="neutral"
          code="NO_SUCH_RECORD"
          title="No record at this address"
          description="This path does not correspond to an order, dispute, case or protocol document in the current adapter."
          action={
            <div className="flex flex-wrap gap-3">
              <ActionLink href="/orders" variant="primary" size="md">
                Open the order ledger
              </ActionLink>
              <ActionLink href="/" variant="secondary" size="md">
                Back to overview
              </ActionLink>
            </div>
          }
        />
      </div>
    </PageContainer>
  );
}
