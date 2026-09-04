import { cx } from "@/lib/format";

interface Layer {
  role: string;
  name: string;
  line: string;
  detail: string;
  emphasis?: boolean;
}

const LAYERS: Layer[] = [
  {
    role: "Payment rail",
    name: "x402",
    line: "moves the money",
    detail: "Autonomous settlement between agents. The rail does not know what was promised.",
  },
  {
    role: "Protection layer",
    name: "Recourse",
    line: "protects the transaction",
    detail:
      "Locks the promise before payment, holds the value, verifies delivery, and executes the remedy.",
    emphasis: true,
  },
  {
    role: "Adjudication",
    name: "GenLayer",
    line: "adjudicates contested fulfillment",
    detail: "Answers the semantic question the protocol cannot resolve with arithmetic.",
  },
];

/**
 * StackDiagram — how the three layers relate. Not a feature grid: each
 * column states a distinct responsibility, joined by explicit operators.
 */
export function StackDiagram({ className }: { className?: string }) {
  return (
    <div className={cx("flex flex-col lg:flex-row lg:items-stretch", className)}>
      {LAYERS.map((layer, index) => (
        <div key={layer.name} className="flex flex-1 flex-col lg:flex-row lg:items-stretch">
          <div
            className={cx(
              "flex flex-1 flex-col border bg-panel px-5 py-6 sm:px-6 sm:py-7",
              layer.emphasis ? "border-protected/40 bg-protected-dim/20" : "border-line",
            )}
          >
            <span
              className={cx(
                "font-mono text-[10px] tracking-[0.18em] uppercase",
                layer.emphasis ? "text-protected" : "text-fg-faint",
              )}
            >
              {layer.role}
            </span>
            <span className="mt-5 font-mono text-2xl tracking-[-0.01em] text-fg sm:text-[28px]">
              {layer.name}
            </span>
            <span
              className={cx(
                "mt-2 text-[15px] leading-snug",
                layer.emphasis ? "text-protected" : "text-fg-muted",
              )}
            >
              {layer.line}
            </span>
            <span className="mt-5 border-t border-line pt-4 text-sm leading-relaxed text-fg-dim">
              {layer.detail}
            </span>
          </div>

          {index < LAYERS.length - 1 ? (
            <div
              className="flex items-center justify-center py-3 lg:px-4 lg:py-0"
              aria-hidden
            >
              <span className="font-mono text-base text-fg-faint">+</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
