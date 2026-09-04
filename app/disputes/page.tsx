import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";
import { provenanceSummary } from "@/lib/selectors";
import { formatDate, formatMoney } from "@/lib/format";
import { PageContainer, PageHeader } from "@/components/layout/Footer";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { DemoModeIndicator } from "@/components/system/Provenance";
import { DisputeStatusBadge, Tag } from "@/components/system/StateBadge";
import { EmptyState } from "@/components/system/States";
import { ActionLink } from "@/components/system/Actions";

/** The ledger is mutable: demo runs write real records. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Disputes",
  description: "Open and settled recourse claims against protected purchases.",
};

export default async function DisputesPage() {
  const [disputes, orders] = await Promise.all([api.listDisputes(), api.listOrders()]);
  const orderById = new Map(orders.map((order) => [order.id, order]));

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Ledger / Disputes"
        title="Recourse claims"
        description="A dispute exists when a locked term was not met. Each claim cites the term, the promise, and the observed value."
        actions={
          <ActionLink href="/cases" variant="secondary" size="md">
            View case ledger
          </ActionLink>
        }
        meta={<DemoModeIndicator />}
      />

      <div className="py-8">
        {disputes.length === 0 ? (
          <EmptyState
            label="DISPUTES"
            title="No open claims"
            description="Nothing is contested right now. Disputes appear here the moment a protected purchase fails a mandatory term."
            action={
              <ActionLink href="/orders" variant="secondary" size="md">
                Open the order ledger
              </ActionLink>
            }
          />
        ) : (
          <Panel>
            <PanelHeader
              title="DISPUTES"
              meta={`${disputes.length} RECORDS`}
              actions={<Tag size="xs">{provenanceSummary(orders)}</Tag>}
            />
            <ul className="divide-y divide-line">
              {disputes.map((dispute) => {
                const order = orderById.get(dispute.orderId);
                return (
                  <li key={dispute.id}>
                    <Link
                      href={`/disputes/${dispute.id}`}
                      className="group flex flex-col gap-3 px-4 py-5 transition-colors hover:bg-raised/60 sm:px-6"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <span className="font-mono text-sm tracking-[0.1em] text-fg">
                            {dispute.ref}
                          </span>
                          <span className="text-sm text-fg-muted">{dispute.title}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <DisputeStatusBadge status={dispute.status} />
                          <ArrowUpRight
                            className="size-3.5 text-fg-faint transition-colors group-hover:text-protected"
                            aria-hidden
                          />
                        </div>
                      </div>
                      <p className="max-w-3xl text-sm leading-relaxed text-fg-dim">{dispute.claim}</p>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <span className="font-mono text-[10px] tracking-[0.12em] text-fg-faint uppercase">
                          Opened {formatDate(dispute.openedAt)}
                        </span>
                        {order ? (
                          <span className="font-mono text-[10px] tracking-[0.12em] text-fg-faint uppercase">
                            {order.buyer.handle} → {order.merchant.handle}
                          </span>
                        ) : null}
                        {order ? (
                          <span className="font-mono text-xs tnum text-fg-muted">
                            {formatMoney(order.amount)}
                          </span>
                        ) : null}
                        {dispute.ruling ? (
                          <Tag
                            tone={dispute.ruling.outcome === "BUYER_WINS" ? "protected" : "pass"}
                            size="xs"
                          >
                            {dispute.ruling.outcome.replace(/_/g, " ")}
                          </Tag>
                        ) : (
                          <Tag tone="pending" size="xs" dot>
                            Awaiting ruling
                          </Tag>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>
    </PageContainer>
  );
}
