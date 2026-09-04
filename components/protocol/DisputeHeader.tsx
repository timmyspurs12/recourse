import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cx, formatTimestamp } from "@/lib/format";
import { Amount } from "@/components/system/Values";
import { AgentIdentity } from "@/components/system/AgentIdentity";
import { DisputeStatusBadge, Tag } from "@/components/system/StateBadge";
import type { Agent, Dispute, Money, Provenance } from "@/lib/types";

/**
 * DisputeHeader — a transaction dossier header. Not a case file, not a
 * courtroom: the parties, the amount at stake, and the contested term.
 */
export function DisputeHeader({
  dispute,
  buyer,
  merchant,
  amount,
  orderHref,
  breachedTerm,
  provenance = "DEMO_FIXTURE",
  className,
}: {
  dispute: Dispute;
  buyer: Agent;
  merchant: Agent;
  amount: Money;
  orderHref: string;
  breachedTerm?: string | null;
  provenance?: Provenance;
  className?: string;
}) {
  return (
    <header className={cx("border border-line bg-panel", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="mono-label text-breach">Dispute</span>
          <span className="font-mono text-sm tracking-[0.14em] text-fg">{dispute.ref}</span>
          <Tag size="xs">{provenance === "LIVE" ? "Live run" : "Seeded run"}</Tag>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DisputeStatusBadge status={dispute.status} />
          <Link
            href={orderHref}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-fg-dim uppercase transition-colors hover:text-fg"
          >
            Order record
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="px-4 py-5 sm:px-6">
        <h1 className="text-xl leading-snug tracking-[-0.01em] text-fg sm:text-2xl">
          {dispute.title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-muted">{dispute.claim}</p>
      </div>

      <dl className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
        <div className="px-4 py-4 sm:px-6">
          <dt className="sr-only">Buyer</dt>
          <dd>
            <AgentIdentity agent={buyer} role="BUYER" size="sm" />
          </dd>
        </div>
        <div className="px-4 py-4 sm:px-6">
          <dt className="sr-only">Merchant</dt>
          <dd>
            <AgentIdentity agent={merchant} role="MERCHANT" size="sm" />
          </dd>
        </div>
        <div className="px-4 py-4 sm:px-6">
          <dt className="mono-label">Amount</dt>
          <dd className="mt-2">
            <Amount money={amount} size="md" />
          </dd>
        </div>
        <div className="px-4 py-4 sm:px-6">
          <dt className="mono-label">Contested term</dt>
          <dd className="mt-2 font-mono text-sm text-breach">{breachedTerm ?? "—"}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line bg-surface px-4 py-3 sm:px-6">
        <span className="font-mono text-[10px] tnum tracking-[0.12em] text-fg-faint uppercase">
          Opened {formatTimestamp(dispute.openedAt, { seconds: true })}
        </span>
        <span className="font-mono text-[10px] tracking-[0.12em] text-fg-faint uppercase">
          Claimed remedy: {dispute.claimedRemedy.replace(/_/g, " ").toLowerCase()}
        </span>
      </div>
    </header>
  );
}
