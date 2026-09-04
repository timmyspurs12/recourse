import { cx, formatTimestamp, orderStatusMeta, toneClasses } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/system/Panel";
import { Tag } from "@/components/system/StateBadge";
import type { TransactionEvent as TxEvent } from "@/lib/types";

const actorTone = {
  BUYER: "text-protected",
  MERCHANT: "text-fg-muted",
  PROTOCOL: "text-fg-muted",
  GENLAYER: "text-pending",
} as const;

/** A single line in the transaction event stream. */
export function TransactionEvent({
  event,
  isLast = false,
}: {
  event: TxEvent;
  isLast?: boolean;
}) {
  const meta = orderStatusMeta[event.state];
  const tone = toneClasses[meta.tone];

  return (
    <li className="relative flex gap-4 pl-1">
      <div className="flex flex-col items-center">
        <span className={cx("mt-1.5 size-2 shrink-0 border", tone.border, tone.bg)} aria-hidden />
        {!isLast ? <span className="w-px flex-1 bg-line" aria-hidden /> : null}
      </div>
      <div className={cx("min-w-0 flex-1", isLast ? "pb-0" : "pb-6")}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <time
            dateTime={event.at}
            className="font-mono text-[11px] tnum whitespace-nowrap text-fg-faint"
          >
            {formatTimestamp(event.at, { seconds: true })}
          </time>
          <span className={cx("font-mono text-[10px] tracking-[0.16em] uppercase", actorTone[event.actor])}>
            {event.actor}
          </span>
          <span className={cx("font-mono text-[10px] tracking-[0.14em] uppercase", tone.text)}>
            {meta.label}
          </span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-fg">{event.label}</p>
        {event.detail ? (
          <p className="mt-1 font-mono text-xs leading-relaxed text-fg-dim">{event.detail}</p>
        ) : null}
      </div>
    </li>
  );
}

export function TransactionEventStream({
  events,
  title = "TRANSACTION LOG",
  className,
}: {
  events: TxEvent[];
  title?: string;
  className?: string;
}) {
  return (
    <Panel className={className}>
      <PanelHeader
        title={title}
        meta={`${events.length} EVENTS`}
        actions={<Tag size="xs">DEMO FIXTURE</Tag>}
      />
      <div className="px-4 py-5 sm:px-6">
        <ol className="flex flex-col">
          {events.map((event, index) => (
            <TransactionEvent
              key={event.id}
              event={event}
              isLast={index === events.length - 1}
            />
          ))}
        </ol>
      </div>
    </Panel>
  );
}
