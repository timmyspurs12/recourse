import { PageContainer } from "@/components/layout/Footer";
import { ProtocolErrorState } from "@/components/system/States";
import { ActionLink } from "@/components/system/Actions";

export default function OrderNotFound() {
  return (
    <PageContainer>
      <div className="py-20">
        <ProtocolErrorState
          tone="neutral"
          code="ORDER_NOT_FOUND"
          title="Order not found"
          description="No protected purchase with this reference exists in the current data adapter. Order references look like RC-000042."
          action={
            <ActionLink href="/orders" variant="primary" size="md">
              Open the order ledger
            </ActionLink>
          }
        />
      </div>
    </PageContainer>
  );
}
