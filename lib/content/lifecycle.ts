import type { LifecyclePhase } from "@/lib/types";

export interface LifecycleStep {
  id: string;
  index: string;
  title: string;
  actor: string;
  summary: string;
  detail: string;
  artifacts: string[];
  phase: LifecyclePhase;
}

/**
 * The six operations of a protected purchase. Shared by the homepage
 * lifecycle explorer and the protocol page so the language never drifts.
 */
export const LIFECYCLE: LifecycleStep[] = [
  {
    id: "pay",
    index: "01",
    title: "PAY",
    actor: "Shopper agent",
    summary: "Agent makes an autonomous payment.",
    detail:
      "The shopper agent settles the invoice over x402 without a human in the loop. The rail moves value; it does not know or care what the payment was supposed to buy.",
    artifacts: ["Payment intent", "x402 settlement", "Payer / payee handles"],
    phase: "PAYMENT",
  },
  {
    id: "protect",
    index: "02",
    title: "PROTECT",
    actor: "Recourse",
    summary: "A machine-readable purchase agreement is locked before payment.",
    detail:
      "Terms are committed and hashed before funds move, so the promise cannot be rewritten after the fact. The payment carries that protection with it, and the amount is held rather than delivered outright.",
    artifacts: ["Agreement document", "Content hash", "Escrow hold", "Recourse window"],
    phase: "PROMISE",
  },
  {
    id: "deliver",
    index: "03",
    title: "DELIVER",
    actor: "Merchant agent",
    summary: "Merchant agent submits fulfillment and evidence.",
    detail:
      "Delivery is not a claim of completion. The merchant agent submits the artifact plus the evidence that the locked terms were met — sources, ages, sections, coverage.",
    artifacts: ["Delivery record", "Artifact manifest", "Evidence items"],
    phase: "PROOF",
  },
  {
    id: "verify",
    index: "04",
    title: "VERIFY",
    actor: "Recourse",
    summary: "Deterministic conditions are evaluated first.",
    detail:
      "Counts, dates, formats and exact matches are arithmetic. The protocol resolves them itself and records each comparison. Most outcomes never need judgment at all.",
    artifacts: ["Deterministic checks", "Promise/proof comparison", "Breach severity"],
    phase: "PROOF",
  },
  {
    id: "adjudicate",
    index: "05",
    title: "ADJUDICATE",
    actor: "GenLayer",
    summary: "Contested fulfillment is referred to GenLayer.",
    detail:
      "Only genuinely semantic questions — materiality, interpretation, scope — leave the protocol. GenLayer receives the locked agreement, the evidence and one precise question.",
    artifacts: ["Adjudication question", "Submitted inputs", "Ruling", "Reasoning"],
    phase: "JUDGMENT",
  },
  {
    id: "settle",
    index: "06",
    title: "SETTLE",
    actor: "Recourse",
    summary: "Funds are released or refunded.",
    detail:
      "The ruling becomes an economic outcome. A satisfied promise releases escrow to the merchant; a material breach returns it to the buyer. Either way the transaction ends in a receipt.",
    artifacts: ["Settlement receipt", "Outcome", "Settlement transaction"],
    phase: "SETTLEMENT",
  },
];
