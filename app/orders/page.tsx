import type { Metadata } from "next";
import { api } from "@/lib/api";
import { PageContainer, PageHeader } from "@/components/layout/Footer";
import { DemoModeIndicator } from "@/components/system/Provenance";
import { EmptyState } from "@/components/system/States";
import { ActionLink } from "@/components/system/Actions";
import { OrderLedgerView } from "@/components/protocol/OrderLedgerView";

/** The ledger is mutable: demo runs write real records. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Orders",
  description: "Protocol ledger of protected purchases and their lifecycle states.",
};

export default async function OrdersPage() {
  const orders = await api.listOrders();

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Ledger / Orders"
        title="Protected purchases"
        description="Every autonomous purchase carrying a Recourse agreement, with the state it currently occupies."
        actions={
          <ActionLink href="/demo" variant="primary" size="md">
            Run demo purchase
          </ActionLink>
        }
        meta={<DemoModeIndicator />}
      />

      <div className="py-8">
        {orders.length === 0 ? (
          <EmptyState
            label="LEDGER"
            title="No protected purchases yet"
            description="Once an agent completes a purchase under a Recourse agreement, the order and its full lifecycle appear here."
            action={
              <ActionLink href="/demo" variant="secondary" size="md">
                Run a protected purchase
              </ActionLink>
            }
          />
        ) : (
          <OrderLedgerView orders={orders} />
        )}
      </div>
    </PageContainer>
  );
}
