import type {
  LifecyclePhase,
  OrderDossier,
  OrderStatus,
  PromiseProofRow,
  Provenance,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Promise vs Proof                                                    */
/* ------------------------------------------------------------------ */

/**
 * Joins the locked agreement (what was promised) with verification output
 * (what was proven). Terms with no corresponding check are reported as
 * indeterminate rather than silently dropped.
 */
export function promiseProofRows(dossier: OrderDossier): PromiseProofRow[] {
  const { agreement, verification } = dossier;
  const checks = new Map((verification?.checks ?? []).map((c) => [c.termId, c]));

  const rows: PromiseProofRow[] = agreement.terms.map((term) => {
    const check = checks.get(term.id);
    return {
      termId: term.id,
      label: term.label,
      promise: term.promise,
      proof: check?.observed ?? "—",
      result: check?.result ?? "INDETERMINATE",
      mandatory: term.mandatory,
      evaluation: term.evaluation,
    };
  });

  // Checks the engine produced that are not 1:1 with a written term
  // (e.g. derived distinctness checks) still belong in the comparison.
  for (const check of checks.values()) {
    if (!rows.some((row) => row.termId === check.termId)) {
      rows.push({
        termId: check.termId,
        label: check.label,
        promise: check.promise,
        proof: check.observed,
        result: check.result,
        mandatory: true,
        evaluation: "DETERMINISTIC",
      });
    }
  }

  return rows;
}

export function breachedRows(rows: PromiseProofRow[]): PromiseProofRow[] {
  return rows.filter((row) => row.result === "BREACH");
}

/* ------------------------------------------------------------------ */
/* State rail                                                          */
/* ------------------------------------------------------------------ */

export type RailNodeState = "COMPLETE" | "CURRENT" | "PENDING" | "PROJECTED";

export interface RailNode {
  status: OrderStatus;
  state: RailNodeState;
  at: string | null;
  branch: "MAIN" | "DISPUTE";
}

const BASE_PATH: OrderStatus[] = [
  "OFFERED",
  "ACCEPTED",
  "ESCROWED",
  "DELIVERED",
  "VERIFICATION_PENDING",
];

const SUCCESS_TAIL: OrderStatus[] = ["FULFILLED", "RELEASED"];
const DISPUTE_TAIL: OrderStatus[] = ["DISPUTED", "ADJUDICATING"];

/**
 * Builds the state path actually taken by this order, including the
 * still-unresolved branch when adjudication has not finalized.
 */
export function railNodes(dossier: OrderDossier): RailNode[] {
  const reached = new Map<OrderStatus, string>();
  for (const evt of dossier.events) {
    if (!reached.has(evt.state)) reached.set(evt.state, evt.at);
  }

  const disputed = Boolean(dossier.dispute);
  const outcome = dossier.dispute?.ruling?.outcome ?? null;

  const path: OrderStatus[] = [...BASE_PATH];
  if (disputed) {
    path.push(...DISPUTE_TAIL);
    if (outcome === "MERCHANT_WINS") path.push("MERCHANT_WON", "RELEASED");
    else if (outcome === "BUYER_WINS") path.push("BUYER_WON", "REFUNDED");
    else path.push("BUYER_WON", "REFUNDED");
  } else {
    path.push(...SUCCESS_TAIL);
  }

  const current = dossier.order.status;
  const currentIndex = path.indexOf(current);

  return path.map((status, index) => {
    const at = reached.get(status) ?? null;
    let state: RailNodeState;
    if (status === current) state = "CURRENT";
    else if (at) state = "COMPLETE";
    else if (disputed && !outcome && index > currentIndex) state = "PROJECTED";
    else state = currentIndex >= 0 && index < currentIndex ? "COMPLETE" : "PENDING";
    return {
      status,
      state,
      at,
      branch: index >= BASE_PATH.length && disputed ? "DISPUTE" : "MAIN",
    };
  });
}

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

export const LIFECYCLE_PHASES: LifecyclePhase[] = [
  "PROMISE",
  "PAYMENT",
  "PROOF",
  "JUDGMENT",
  "SETTLEMENT",
];

export function phaseProgress(dossier: OrderDossier): Record<LifecyclePhase, boolean> {
  const done = new Set(dossier.events.map((e) => e.phase));
  return {
    PROMISE: done.has("PROMISE"),
    PAYMENT: done.has("PAYMENT"),
    PROOF: done.has("PROOF"),
    JUDGMENT: done.has("JUDGMENT"),
    SETTLEMENT: done.has("SETTLEMENT"),
  };
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function countedEvidence(dossier: OrderDossier): {
  submitted: number;
  required: number | null;
} {
  const requiredTerm = dossier.agreement.terms.find((t) => t.id === "minimum_sources");
  return {
    submitted: dossier.delivery?.evidence.length ?? 0,
    required: typeof requiredTerm?.promiseValue === "number" ? requiredTerm.promiseValue : null,
  };
}

export function isTerminal(status: OrderStatus): boolean {
  return status === "RELEASED" || status === "REFUNDED";
}

/**
 * Summarises where a set of records came from.
 *
 * The ledger mixes seeded runs with orders produced by live demo executions,
 * so the label has to follow the data rather than being hardcoded.
 */
export function provenanceSummary(items: Array<{ provenance: Provenance }>): string {
  if (items.length === 0) return "No records";
  const kinds = new Set(items.map((item) => item.provenance));
  if (kinds.size === 1) {
    const [only] = [...kinds];
    if (only === "LIVE") return "Live runs";
    if (only === "DEMO_FIXTURE") return "Seeded runs";
    if (only === "SIMULATED") return "Simulated";
    return "Not available";
  }
  return "Seeded + live runs";
}
