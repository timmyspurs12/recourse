import type {
  Adjudication as DomainAdjudication,
  Agreement as DomainAgreement,
  Delivery as DomainDelivery,
  Dispute as DomainDispute,
  LedgerEvent,
  Order as DomainOrder,
  OrderDossier as DomainDossier,
  Payment as DomainPayment,
  Settlement as DomainSettlement,
  Verification as DomainVerification,
  AgentRef,
} from "../domain/model";
import type {
  Adjudication,
  Agent,
  Agreement,
  AgreementTerm,
  Attested,
  CaseRecord,
  Delivery,
  Dispute,
  Evidence,
  Order,
  OrderDossier,
  OrderStatus,
  Payment,
  Provenance,
  Ruling,
  Settlement,
  TransactionEvent,
  Verification,
} from "../lib/types";
import { parseOrderSequence } from "../domain/shared/ids";

/**
 * Domain → view model.
 *
 * The UI's job is to tell the truth about protocol state, so this layer's job
 * is to carry provenance faithfully across the boundary. Anything the protocol
 * does not know becomes an Attested value with `NOT_AVAILABLE` and a reason —
 * never a plausible-looking placeholder.
 */

function attest<T>(value: T | null | undefined, provenance: Provenance, note?: string): Attested<T> {
  return value === null || value === undefined
    ? { value: null, provenance: "NOT_AVAILABLE", note }
    : { value, provenance, note };
}

function originProvenance(order: DomainOrder): Provenance {
  return order.origin === "DEMO_FIXTURE" ? "DEMO_FIXTURE" : "LIVE";
}

function agent(
  ref: AgentRef,
  role: "SHOPPER" | "MERCHANT",
  provenance: Provenance = "LIVE",
): Agent {
  return {
    id: ref.handle,
    handle: ref.handle,
    label: role === "SHOPPER" ? "Shopper agent" : "Merchant agent",
    role,
    operator: ref.operator,
    address: attest(
      ref.address ?? null,
      provenance,
      "This agent has not published a settlement address.",
    ),
  };
}

function renderPromise(term: { operator: string; expected: string | number; unit?: string }): string {
  const unit = term.unit ? ` ${term.unit}` : "";
  switch (term.operator) {
    case "GTE":
      return `\u2265 ${term.expected}${unit}`;
    case "LTE":
      return `\u2264 ${term.expected}${unit}`;
    case "EQ":
      return `${term.expected}${unit}`;
    default:
      return `${term.expected}${unit}`;
  }
}

export function presentOrder(order: DomainOrder, description: string): Order {
  const sequence = parseOrderSequence(order.id);
  return {
    id: order.id,
    ref: order.ref.replace("RC/", "RC / "),
    sequence: sequence === null ? order.id : String(sequence).padStart(6, "0"),
    title: order.resource.name,
    description,
    buyer: agent(order.buyer, "SHOPPER", originProvenance(order)),
    merchant: agent(order.merchant, "MERCHANT", originProvenance(order)),
    amount: order.amount,
    status: order.state as OrderStatus,
    protected: true,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    provenance: originProvenance(order),
  };
}

export function presentAgreement(agreement: DomainAgreement, order: DomainOrder): Agreement {
  const terms: AgreementTerm[] = agreement.document.terms.map((term) => ({
    id: term.id,
    label: term.label,
    operator: term.operator,
    promise: renderPromise(term),
    promiseValue: term.expected,
    unit: term.unit,
    mandatory: term.mandatory,
    evaluation: term.evaluation,
    description: term.description,
  }));

  return {
    id: agreement.id,
    orderId: agreement.orderId,
    version: agreement.document.version,
    title: order.resource.name,
    status: agreement.lockedAt ? "LOCKED" : "OFFERED",
    terms,
    breachRemedy: "FULL_REFUND",
    refundOnMaterialBreach: true,
    document: agreement.document as unknown as Record<string, unknown>,
    createdAt: agreement.document.createdAt,
    lockedAt: agreement.lockedAt,
    // A real sha256 over the canonical document, recomputable by either party.
    hash: attest(agreement.hash, "LIVE"),
  };
}

export function presentPayment(
  payment: DomainPayment | null,
  order: DomainOrder,
  recourseWindowHours: number,
): Payment {
  if (!payment) {
    return {
      id: `pay_none_${order.id}`,
      orderId: order.id,
      rail: "x402",
      amount: order.amount,
      payerId: order.buyer.handle,
      payeeId: order.merchant.handle,
      escrow: "NONE",
      recourseWindowHours,
      initiatedAt: order.createdAt,
      confirmedAt: null,
      reference: attest<string>(null, "NOT_AVAILABLE", "No payment has been captured for this order."),
    };
  }

  const onchain = payment.execution === "ONCHAIN";
  return {
    id: payment.id,
    orderId: payment.orderId,
    rail: "x402",
    amount: payment.amount,
    payerId: order.buyer.handle,
    payeeId: order.merchant.handle,
    escrow: payment.escrow,
    recourseWindowHours,
    initiatedAt: payment.initiatedAt,
    confirmedAt: payment.confirmedAt,
    reference: attest(
      payment.reference,
      payment.rail === "simulated" ? "SIMULATED" : onchain ? "LIVE" : "SIMULATED",
      onchain
        ? undefined
        : "x402 authorization reference. Settlement was not broadcast in this environment.",
    ),
  };
}

const EVIDENCE_KIND: Record<string, Evidence["kind"]> = {
  registry: "ATTESTATION",
  attestation: "ATTESTATION",
  document: "DOCUMENT",
  report: "DOCUMENT",
};

export function presentDelivery(
  delivery: DomainDelivery | null,
  order: DomainOrder,
): Delivery | null {
  if (!delivery) return null;

  const evidence: Evidence[] = delivery.evidence.map((item) => ({
    id: item.id,
    index: item.index,
    kind: EVIDENCE_KIND[item.kind.toLowerCase()] ?? "SOURCE",
    source: item.source,
    title: item.kind,
    submittedAt: item.submittedAt,
    sourceAgeDays: item.sourceAgeDays,
    // The protocol verifies the checksum, not the truth of the source.
    status: "UNVERIFIED",
    checksum: attest(item.checksum, "LIVE"),
    note: "Checksum verified. Source content is not independently attested.",
  }));

  return {
    id: delivery.id,
    orderId: delivery.orderId,
    merchantId: order.merchant.handle,
    submittedAt: delivery.submittedAt,
    statement: delivery.statement,
    artifact: {
      title: order.resource.name,
      format: delivery.assertions.format,
      sections: delivery.assertions.sectionCount,
      sizeBytes: null,
      hash: delivery.artifactHash,
    },
    evidence,
    evidenceUnavailableReason: delivery.unavailableReason ?? undefined,
  };
}

export function presentVerification(
  verification: DomainVerification | null,
  adjudication: DomainAdjudication | null,
  dispute: DomainDispute | null,
): Verification | null {
  if (!verification) return null;

  const outcome =
    verification.outcome === "BREACH"
      ? "BREACH"
      : verification.outcome === "SATISFIED"
        ? "PASS"
        : "INDETERMINATE";

  let status: Verification["semanticReview"]["status"] = "NOT_REQUIRED";
  let rationale: string | null = null;

  if (adjudication?.status === "FINALIZED" && adjudication.ruling) {
    status = "COMPLETE";
    rationale = adjudication.ruling.reasoningSummary;
  } else if (adjudication && (adjudication.status === "SUBMITTED" || adjudication.status === "PENDING")) {
    status = "IN_ADJUDICATION";
  } else if (dispute) {
    status = "ADJUDICATION_REQUIRED";
  } else if (verification.semanticQuestions.length > 0 && verification.outcome !== "SATISFIED") {
    status = "ADJUDICATION_REQUIRED";
  }

  return {
    id: `ver_${verification.orderId}`,
    orderId: verification.orderId,
    executedAt: verification.executedAt,
    engine: verification.engine,
    checks: verification.checks.map((check) => ({
      termId: check.termId,
      label: check.label,
      expression: check.expression,
      promise: check.expected,
      observed: check.observed,
      result: check.result,
      severity: check.result === "BREACH" ? (check.mandatory ? "MATERIAL" : "MINOR") : null,
    })),
    outcome,
    semanticReview: {
      status,
      question: verification.semanticQuestions[0]?.question ?? null,
      rationale,
    },
  };
}

function presentAdjudication(
  adjudication: DomainAdjudication | null,
  disputeId: string,
  agreementHash: string,
  evidenceHash: string | null,
): Adjudication | null {
  if (!adjudication) return null;

  const statusMap: Record<DomainAdjudication["status"], Adjudication["status"]> = {
    NOT_REQUIRED: "NOT_SUBMITTED",
    SUBMITTED: "QUEUED",
    PENDING: "IN_PROGRESS",
    FINALIZED: "FINALIZED",
    FAILED: "UNAVAILABLE",
  };

  const voteEntries = adjudication.votes
    ? Object.entries(adjudication.votes).map(([validator, vote]) => ({ validator, vote }))
    : null;

  const agreeing = voteEntries?.filter((entry) => entry.vote === "agree").length ?? 0;

  return {
    id: adjudication.id,
    disputeId,
    forum: "GENLAYER",
    network: adjudication.network ?? "NOT CONNECTED",
    question: adjudication.question,
    inputs: [
      { label: "Agreement hash", value: agreementHash },
      { label: "Evidence hash", value: evidenceHash ?? "unavailable" },
      { label: "Inputs hash", value: adjudication.inputsHash },
    ],
    status: statusMap[adjudication.status],
    submittedAt: adjudication.submittedAt,
    finalizedAt: adjudication.finalizedAt,
    contract: attest(
      adjudication.contractAddress,
      "LIVE",
      "No adjudication contract is deployed for this environment.",
    ),
    transaction: attest(
      adjudication.transactionHash,
      "LIVE",
      adjudication.failureReason ?? "No adjudication transaction has been broadcast.",
    ),
    consensus: voteEntries
      ? {
          value: {
            validators: voteEntries.length,
            agreement: `${agreeing} of ${voteEntries.length} agree`,
            // The receipt does not expose a round count; do not invent one.
            rounds: null,
          },
          provenance: "LIVE",
        }
      : {
          value: null,
          provenance: "NOT_AVAILABLE",
          note: "The network has not reported validator detail for this transaction yet.",
        },
    votes: voteEntries
      ? { value: voteEntries, provenance: "LIVE" }
      : {
          value: null,
          provenance: "NOT_AVAILABLE",
          note: "Validator votes are published with the transaction receipt once consensus completes.",
        },
  };
}

function presentRuling(
  adjudication: DomainAdjudication | null,
  verification: DomainVerification | null,
  agreement: DomainAgreement,
): Ruling | null {
  if (!adjudication?.ruling || adjudication.status !== "FINALIZED") return null;
  const ruling = adjudication.ruling;

  return {
    id: `rul_${adjudication.id}`,
    disputeId: adjudication.disputeId,
    outcome: ruling.decision,
    breachedTerms: ruling.violatedTerms.map((termId) => {
      const check = verification?.checks.find((entry) => entry.termId === termId);
      const term = agreement.document.terms.find((entry) => entry.id === termId);
      return {
        termId,
        label: term?.label ?? termId,
        promised: check?.expected ?? String(term?.expected ?? ""),
        observed: check?.observed ?? "\u2014",
        severity: "MATERIAL" as const,
      };
    }),
    rationale: [ruling.reasoningSummary],
    remedy: ruling.recommendedSettlement === "REFUND" ? "FULL_REFUND" : "NONE",
    finalizedAt: adjudication.finalizedAt ?? adjudication.submittedAt,
    provenance: "LIVE",
  };
}

export function presentDispute(
  dispute: DomainDispute | null,
  adjudication: DomainAdjudication | null,
  verification: DomainVerification | null,
  agreement: DomainAgreement,
  evidenceHash: string | null,
): Dispute | null {
  if (!dispute) return null;

  const statusMap: Record<DomainDispute["status"], Dispute["status"]> = {
    OPEN: "OPEN",
    ADJUDICATING: "ADJUDICATING",
    RULED: "RULED",
    SETTLED: "SETTLED",
    FAILED: "EVIDENCE_REVIEW",
  };

  return {
    id: dispute.id,
    ref: dispute.ref.replace("RC/", "RC / "),
    orderId: dispute.orderId,
    title: dispute.title,
    openedById: dispute.openedBy === "BUYER" ? "shopper" : "merchant",
    openedAt: dispute.openedAt,
    status: statusMap[dispute.status],
    claim: dispute.claim,
    claimedRemedy: "FULL_REFUND",
    adjudication: presentAdjudication(adjudication, dispute.id, agreement.hash, evidenceHash),
    ruling: presentRuling(adjudication, verification, agreement),
  };
}

export function presentSettlement(
  settlement: DomainSettlement | null,
  order: DomainOrder,
  dispute: DomainDispute | null,
  adjudication: DomainAdjudication | null,
): Settlement | null {
  if (!settlement) {
    // A ruling exists but the money has not moved yet. That is a real protocol
    // state and gets its own honest surface rather than a blank panel.
    if (adjudication?.status === "FINALIZED" && adjudication.ruling) {
      return {
        id: `stl_pending_${order.id}`,
        orderId: order.id,
        disputeId: dispute?.id ?? null,
        outcome: adjudication.ruling.recommendedSettlement === "REFUND" ? "REFUNDED" : "RELEASED",
        status: "UNAVAILABLE",
        amount: order.amount,
        buyerId: order.buyer.handle,
        merchantId: order.merchant.handle,
        reason: adjudication.ruling.reasoningSummary,
        settledAt: null,
        transaction: attest<string>(null, "NOT_AVAILABLE", "Settlement has not been executed."),
        unavailableReason:
          "The ruling is final but settlement has not been executed for this order yet.",
      };
    }
    return null;
  }

  return {
    id: settlement.id,
    orderId: settlement.orderId,
    disputeId: dispute?.id ?? null,
    outcome: settlement.outcome,
    status: "CONFIRMED",
    amount: settlement.amount,
    buyerId: order.buyer.handle,
    merchantId: order.merchant.handle,
    reason: settlement.reason,
    settledAt: settlement.executedAt,
    transaction: attest(
      settlement.transactionHash,
      "LIVE",
      "Escrow movement was recorded by the protocol. No chain transaction was broadcast in this environment.",
    ),
  };
}

const ACTOR_BY_EVENT: Record<string, TransactionEvent["actor"]> = {
  ORDER_CREATED: "BUYER",
  AGREEMENT_LOCKED: "PROTOCOL",
  PAYMENT_ESCROWED: "BUYER",
  DELIVERY_POSTED: "MERCHANT",
  VERIFICATION_STARTED: "PROTOCOL",
  VERIFICATION_PASSED: "PROTOCOL",
  BREACH_DETECTED: "PROTOCOL",
  DISPUTE_OPENED: "BUYER",
  ADJUDICATION_SUBMITTED: "GENLAYER",
  ADJUDICATION_FAILED: "GENLAYER",
  RULING_FINALIZED: "GENLAYER",
  REFUND_EXECUTED: "PROTOCOL",
  MERCHANT_PAID: "PROTOCOL",
  ORDER_CANCELLED: "PROTOCOL",
};

export function presentEvents(events: LedgerEvent[], provenance: Provenance): TransactionEvent[] {
  return events.map((event) => ({
    id: event.id,
    orderId: event.orderId,
    at: event.at,
    state: event.state as OrderStatus,
    phase: event.phase,
    label: event.summary,
    actor: ACTOR_BY_EVENT[event.type] ?? "PROTOCOL",
    detail: event.detail
      ? Object.entries(event.detail)
          .filter(([, value]) => value !== null && value !== "")
          .map(([key, value]) => `${key}: ${value}`)
          .join(" · ")
      : undefined,
    provenance,
  }));
}

export function presentDossier(dossier: DomainDossier): OrderDossier {
  const { order, agreement } = dossier;
  const provenance = originProvenance(order);
  const description = describeState(dossier);

  return {
    order: presentOrder(order, description),
    agreement: presentAgreement(agreement, order),
    payment: presentPayment(
      dossier.payment,
      order,
      agreement.document.refundPolicy.recourseWindowHours,
    ),
    delivery: presentDelivery(dossier.delivery, order),
    verification: presentVerification(dossier.verification, dossier.adjudication, dossier.dispute),
    dispute: presentDispute(
      dossier.dispute,
      dossier.adjudication,
      dossier.verification,
      agreement,
      dossier.delivery?.evidenceHash ?? null,
    ),
    settlement: presentSettlement(
      dossier.settlement,
      order,
      dossier.dispute,
      dossier.adjudication,
    ),
    events: presentEvents(dossier.events, provenance),
  };
}

export function describeState(dossier: DomainDossier): string {
  const { order, amount } = { order: dossier.order, amount: dossier.order.amount };
  const value = `$${amount.amount} ${amount.currency}`;
  switch (order.state) {
    case "OFFERED":
    case "ACCEPTED":
      return `${value} offered under a machine-readable agreement. Payment has not been captured.`;
    case "ESCROWED":
      return `${value} captured over ${dossier.payment?.rail ?? "x402"} and held under protection.`;
    case "DELIVERED":
    case "VERIFICATION_PENDING":
      return dossier.verification?.breachedTermIds.length
        ? `Delivery verified against the locked terms. Mandatory term breached: ${dossier.verification.breachedTermIds.join(", ")}.`
        : "Delivery received. Deterministic verification is running against the locked terms.";
    case "FULFILLED":
      return "All mandatory terms satisfied. Escrow is ready for release to the merchant.";
    case "DISPUTED":
      return "The buyer opened a recourse claim. Escrow remains held.";
    case "ADJUDICATING":
      return "Contested terms were submitted to GenLayer. Escrow remains held pending consensus.";
    case "BUYER_WON":
      return "Adjudication found a material breach. Refund authorised.";
    case "MERCHANT_WON":
      return "Adjudication found no material breach. Release authorised.";
    case "REFUNDED":
      return `${value} returned to the buyer agent.`;
    case "RELEASED":
      return `${value} released to the merchant agent.`;
    case "CANCELLED":
      return "This protected purchase was cancelled before delivery.";
    default:
      return "";
  }
}

export function presentCase(dossier: DomainDossier): CaseRecord | null {
  if (!dossier.dispute) return null;
  const ruling = dossier.adjudication?.ruling ?? null;

  const statusMap: Record<string, CaseRecord["status"]> = {
    OPEN: "OPEN",
    ADJUDICATING: "ADJUDICATING",
    RULED: "RULED",
    SETTLED: "SETTLED",
    FAILED: "EVIDENCE_REVIEW",
  };

  return {
    ref: dossier.order.ref.replace("RC/", "RC / "),
    disputeId: dossier.dispute.id,
    orderId: dossier.order.id,
    status: statusMap[dossier.dispute.status] ?? "OPEN",
    title: dossier.order.resource.name,
    buyerHandle: dossier.order.buyer.handle,
    merchantHandle: dossier.order.merchant.handle,
    breachedTermId: dossier.verification?.breachedTermIds[0] ?? null,
    outcome: ruling ? ruling.decision : null,
    settlement: dossier.settlement?.outcome ?? null,
    openedAt: dossier.dispute.openedAt,
    amount: dossier.order.amount,
    provenance: originProvenance(dossier.order),
  };
}
