import type {
  Adjudication,
  Agreement,
  AgreementTerm,
  AgentRef,
  AgentRole,
  AppealRecord,
  Currency,
  Delivery,
  Dispute,
  LedgerEvent,
  Money,
  Order,
  OrderDossier,
  OrderState,
  Payment,
  RemedyPolicy,
  Ruling,
  RulingSnapshot,
  Settlement,
  SettlementLeg,
  Verification,
  EventType,
} from "../model";
import { FULL_REFUND_BPS, PHASE_BY_STATE, describeAward, refundBpsOf, sameAward } from "../model";

export { describeAward };
import type {
  AdjudicationForum,
  PaymentAuthorization,
  PaymentRail,
  RecourseStore,
} from "../ports";
import { PROVISIONAL_STATES, RULED_STATES, transition } from "./state-machine";
import {
  assertAgreementIntegrity,
  draftAgreement,
  lockAgreement,
  remedyModeFor,
} from "../agreements/agreement";
import { buildDelivery, sanitizeUntrusted, type EvidenceDraft } from "../evidence/evidence";
import { isMaterialBreach, verifyDelivery } from "../verification/engine";
import { documentHash, type Json } from "../shared/canonical";
import {
  formatOrderId,
  newAdjudicationId,
  newAppealId,
  newDisputeId,
  newEventId,
  newPaymentId,
  newSettlementId,
  orderRef,
} from "../shared/ids";
import { addHours, type Clock, systemClock } from "../shared/clock";
import {
  assertCanAdjudicate,
  assertCanAppeal,
  assertCanDeliver,
  assertCanDispute,
  assertCanSettle,
  isSystem,
  type Actor,
  type Party,
} from "../identity/authorization";
import { fail } from "../shared/errors";
import { formatGen, splitByBps, toMicros } from "../shared/money";
import type { MerchantAssertions } from "../model";

export interface CreatePurchaseInput {
  buyer: AgentRef;
  merchant: AgentRef;
  resource: { name: string; type: string };
  amount: string;
  currency?: Currency;
  terms: AgreementTerm[];
  deliveryDeadlineHours?: number;
  recourseWindowHours?: number;
  /**
   * What a breach entitles the buyer to. `graduated_refund` lets the forum
   * award part of the escrow; it is fixed in the agreement before payment.
   */
  remedy?: RemedyPolicy;
  /** Signed x402 authorization. Omitted only by the simulated rail. */
  authorization?: PaymentAuthorization;
  /**
   * When true the order stops at ACCEPTED and the caller must fund it with
   * `capturePayment`. This is the real x402 shape: the resource answers 402,
   * the buyer signs, and only then does escrow exist.
   */
  deferFunding?: boolean;
  origin?: Order["origin"];
}

export interface SubmitDeliveryInput {
  /** The authenticated caller, when the deployment enforces identity. */
  actor?: Actor;
  orderId: string;
  statement: string;
  artifactUrl?: string | null;
  artifactHash: string;
  assertions: MerchantAssertions;
  evidence: EvidenceDraft[];
}

export interface OpenDisputeInput {
  actor?: Actor;
  orderId: string;
  claim: string;
  contestedTermIds?: string[];
  openedBy?: "BUYER" | "MERCHANT";
}

export interface FileAppealInput {
  disputeId: string;
  actor?: Actor;
  /** Why the appellant thinks the ruling is wrong. Recorded, not sent on-chain. */
  reason?: string;
  /** Required when the protocol itself files the appeal (the demo). */
  onBehalfOf?: Party;
}

/** The ruled state a final ruling leads to. */
function ruledStateFor(ruling: Ruling): OrderState {
  switch (ruling.decision) {
    case "BUYER_WINS":
      return "BUYER_WON";
    case "MERCHANT_WINS":
      return "MERCHANT_WON";
    default:
      return "SPLIT_AWARDED";
  }
}

/** The parties a ruling went against. A split leaves both short of their claim. */
function losingParties(ruling: Ruling): Party[] {
  switch (ruling.decision) {
    case "BUYER_WINS":
      return ["MERCHANT"];
    case "MERCHANT_WINS":
      return ["BUYER"];
    default:
      return ["BUYER", "MERCHANT"];
  }
}

function snapshotOf(ruling: Ruling): RulingSnapshot {
  return {
    decision: ruling.decision,
    refundBps: refundBpsOf(ruling),
    violatedTerms: [...ruling.violatedTerms],
  };
}

export interface ProtocolDeps {
  store: RecourseStore;
  rail: PaymentRail;
  forum: AdjudicationForum;
  clock?: Clock;
  /** Resource URL advertised in x402 payment requirements. */
  resourceBaseUrl?: string;
}

/**
 * The Recourse protocol.
 *
 * Every state change in the system goes through this class. Routes, the SDK and
 * the demo are all thin callers — none of them may mutate an order directly.
 */
export class RecourseProtocol {
  private readonly store: RecourseStore;
  private readonly rail: PaymentRail;
  private readonly forum: AdjudicationForum;
  private readonly clock: Clock;
  private readonly resourceBaseUrl: string;

  constructor(deps: ProtocolDeps) {
    this.store = deps.store;
    this.rail = deps.rail;
    this.forum = deps.forum;
    this.clock = deps.clock ?? systemClock;
    this.resourceBaseUrl = deps.resourceBaseUrl ?? "https://recourse.local/resource";
  }

  /* ---------------------------------------------------------------- events */

  private async emit(
    order: Order,
    type: EventType,
    summary: string,
    detail?: LedgerEvent["detail"],
  ): Promise<void> {
    const event: LedgerEvent = {
      id: newEventId(),
      orderId: order.id,
      type,
      state: order.state,
      phase: PHASE_BY_STATE[order.state],
      at: this.clock.isoNow(),
      summary,
      detail,
    };
    await this.store.appendEvent(event);
  }

  private async moveTo(order: Order, next: OrderState): Promise<Order> {
    const state = transition(order.state, next);
    const updated: Order = { ...order, state, updatedAt: this.clock.isoNow() };
    await this.store.putOrder(updated);
    return updated;
  }

  private async requireOrder(orderId: string): Promise<Order> {
    const order = await this.store.getOrder(orderId);
    if (!order) fail("ORDER_NOT_FOUND", `No protected transaction with id ${orderId}`);
    return order;
  }

  private async requireAgreement(orderId: string): Promise<Agreement> {
    const agreement = await this.store.getAgreement(orderId);
    if (!agreement) fail("NOT_FOUND", `Order ${orderId} has no agreement`);
    assertAgreementIntegrity(agreement);
    return agreement;
  }

  /* ------------------------------------------------------------- purchase */

  /**
   * PROMISE → PAYMENT.
   *
   * The agreement is drafted and hashed BEFORE the payment is captured, then
   * locked at the moment of capture. That ordering is the product: money never
   * moves until the conditions it is subject to are fixed.
   */
  async createProtectedPurchase(input: CreatePurchaseInput): Promise<OrderDossier> {
    const sequence = await this.store.nextOrderSequence();
    const orderId = formatOrderId(sequence);
    const now = this.clock.isoNow();
    const amount: Money = { amount: input.amount, currency: input.currency ?? "USDC" };
    const deadline = addHours(
      this.clock.now(),
      input.deliveryDeadlineHours ?? 24,
    ).toISOString();
    const recourseWindowHours = input.recourseWindowHours ?? 72;

    const order: Order = {
      id: orderId,
      ref: orderRef(orderId),
      state: "OFFERED",
      buyer: input.buyer,
      merchant: input.merchant,
      resource: input.resource,
      amount,
      rail: this.rail.id,
      origin: input.origin ?? "LIVE_RUN",
      createdAt: now,
      updatedAt: now,
      deliveryDeadline: deadline,
      recourseWindowEndsAt: null,
    };
    await this.store.putOrder(order);
    await this.emit(order, "ORDER_CREATED", `Protected purchase ${order.ref} offered`, {
      resource: input.resource.name,
      amount: `${amount.amount} ${amount.currency}`,
    });

    const agreement = draftAgreement({
      orderId,
      buyer: input.buyer.handle,
      merchant: input.merchant.handle,
      resource: input.resource,
      amount: amount.amount,
      currency: amount.currency,
      rail: this.rail.id,
      terms: input.terms,
      deliveryDeadline: deadline,
      recourseWindowHours,
      remedy: input.remedy,
      createdAt: now,
    });
    await this.store.putAgreement(agreement);

    await this.store.withOrderLock(orderId, async () => {
      // OFFERED → ACCEPTED: the buyer agent accepts the machine-readable terms.
      await this.moveTo(order, "ACCEPTED");
    });

    if (input.deferFunding) return this.dossier(orderId);
    return this.capturePayment(orderId, input.authorization);
  }

  /**
   * PAYMENT.
   *
   * Captures a signed x402 authorization against an accepted order and locks
   * the agreement in the same critical section. Money and terms become
   * immutable together or not at all.
   */
  async capturePayment(
    orderId: string,
    authorizationInput?: PaymentAuthorization,
  ): Promise<OrderDossier> {
    return this.store.withOrderLock(orderId, async () => {
      let current = await this.requireOrder(orderId);
      const agreement = await this.requireAgreement(orderId);
      const amount = current.amount;
      const now = this.clock.isoNow();
      const recourseWindowHours = agreement.document.refundPolicy.recourseWindowHours;
      const input = { authorization: authorizationInput, resource: current.resource };

      if (await this.store.getPayment(orderId)) {
        fail("SETTLEMENT_ALREADY_EXECUTED", `Order ${orderId} is already funded`);
      }

      const requirements = this.rail.quote({
        orderId,
        amount,
        resourceName: input.resource.name,
        resourceUrl: `${this.resourceBaseUrl}/${orderId}`,
      });

      const authorization: PaymentAuthorization = input.authorization ?? {
        scheme: requirements.scheme,
        network: requirements.network,
        payload: {},
      };

      const receipt = await this.rail.captureToEscrow({
        orderId,
        authorization,
        requirements,
      });

      if (await this.store.hasPaymentReference(receipt.reference)) {
        fail("PAYMENT_REPLAYED", "This payment authorization has already funded another order");
      }

      const locked = lockAgreement(agreement, this.clock.isoNow());
      await this.store.putAgreement(locked);
      await this.emit(current, "AGREEMENT_LOCKED", "Agreement locked before settlement", {
        agreementHash: locked.hash,
        terms: locked.document.terms.length,
      });

      const payment: Payment = {
        id: newPaymentId(),
        orderId,
        rail: this.rail.id,
        amount,
        escrow: "HELD",
        reference: receipt.reference,
        authorizationVerified: Boolean(input.authorization),
        payer: receipt.payer,
        payee: receipt.payee,
        network: receipt.network,
        transactionHash: receipt.transactionHash,
        execution: receipt.execution,
        initiatedAt: now,
        confirmedAt: receipt.confirmedAt,
      };
      await this.store.putPayment(payment);

      current = await this.moveTo(current, "ESCROWED");
      current = {
        ...current,
        recourseWindowEndsAt: addHours(this.clock.now(), recourseWindowHours).toISOString(),
      };
      await this.store.putOrder(current);

      await this.emit(current, "PAYMENT_ESCROWED", "Payment captured and held under protection", {
        rail: this.rail.id,
        amount: `${amount.amount} ${amount.currency}`,
        execution: receipt.execution,
      });

      return this.dossier(orderId);
    });
  }

  /* ------------------------------------------------------------- delivery */

  /**
   * PROOF.
   *
   * Delivery is recorded, hashed, then verified deterministically. A mandatory
   * breach does not automatically take the money back — it opens the buyer's
   * right to recourse.
   */
  async submitDelivery(input: SubmitDeliveryInput): Promise<OrderDossier> {
    return this.store.withOrderLock(input.orderId, async () => {
      const order = await this.requireOrder(input.orderId);
      assertCanDeliver(order, input.actor);
      const agreement = await this.requireAgreement(input.orderId);

      if (await this.store.getDelivery(input.orderId)) {
        fail("DELIVERY_ALREADY_SUBMITTED", `Order ${input.orderId} already has a delivery`);
      }

      const delivery = buildDelivery({
        orderId: input.orderId,
        statement: input.statement,
        artifactUrl: input.artifactUrl ?? null,
        artifactHash: input.artifactHash,
        assertions: input.assertions,
        evidence: input.evidence,
        submittedAt: this.clock.isoNow(),
      });
      await this.store.putDelivery(delivery);

      let current = await this.moveTo(order, "DELIVERED");
      await this.emit(current, "DELIVERY_POSTED", "Merchant submitted delivery and evidence", {
        evidenceItems: delivery.evidence.length,
        evidenceHash: delivery.evidenceHash,
      });

      current = await this.moveTo(current, "VERIFICATION_PENDING");
      await this.emit(current, "VERIFICATION_STARTED", "Deterministic verification started", {
        engine: "recourse/deterministic@0.4",
      });

      const verification = verifyDelivery(agreement, delivery, this.clock.isoNow());
      await this.store.putVerification(verification);

      if (isMaterialBreach(verification)) {
        await this.emit(
          current,
          "BREACH_DETECTED",
          `Mandatory term breached: ${verification.breachedTermIds.join(", ")}`,
          {
            breachedTerms: verification.breachedTermIds.join(", "),
            // The protocol states the arithmetic plainly. No model was involved.
            finding:
              verification.checks.find((check) => check.result === "BREACH")?.expression ?? "",
          },
        );
      } else if (verification.outcome === "SATISFIED") {
        current = await this.moveTo(current, "FULFILLED");
        await this.emit(current, "VERIFICATION_PASSED", "All mandatory terms satisfied", {
          checks: verification.checks.length,
        });
      }

      return this.dossier(input.orderId);
    });
  }

  /* -------------------------------------------------------------- dispute */

  async openDispute(input: OpenDisputeInput): Promise<OrderDossier> {
    return this.store.withOrderLock(input.orderId, async () => {
      const order = await this.requireOrder(input.orderId);
      const claimant = assertCanDispute(order, input.actor);
      const agreement = await this.requireAgreement(input.orderId);

      const existing = await this.store.getDisputeByOrder(input.orderId);
      if (existing) {
        fail("DISPUTE_ALREADY_OPEN", `Order ${input.orderId} already has dispute ${existing.id}`);
      }

      if (order.recourseWindowEndsAt && this.clock.now() > new Date(order.recourseWindowEndsAt)) {
        fail(
          "DISPUTE_WINDOW_CLOSED",
          `The recourse window for ${input.orderId} closed at ${order.recourseWindowEndsAt}`,
        );
      }

      const verification = await this.store.getVerification(input.orderId);
      const contested =
        input.contestedTermIds && input.contestedTermIds.length > 0
          ? input.contestedTermIds
          : (verification?.breachedTermIds ?? []);

      if (contested.length === 0) {
        fail("VALIDATION_FAILED", "A dispute must contest at least one term");
      }

      const dispute: Dispute = {
        id: newDisputeId(input.orderId),
        orderId: input.orderId,
        ref: order.ref,
        title: order.resource.name,
        claim: sanitizeUntrusted(input.claim, 1_200),
        claimedRemedy:
          remedyModeFor(agreement) === "GRADUATED" ? "PROPORTIONAL_REFUND" : "FULL_REFUND",
        status: "OPEN",
        // Derived from the authenticated caller when there is one: a merchant
        // cannot file a claim as the buyer.
        openedBy: input.actor ? claimant : (input.openedBy ?? "BUYER"),
        openedAt: this.clock.isoNow(),
        contestedTermIds: contested,
      };
      await this.store.putDispute(dispute);

      const current = await this.moveTo(order, "DISPUTED");
      await this.emit(current, "DISPUTE_OPENED", `Recourse claim opened for ${order.ref}`, {
        disputeId: dispute.id,
        contested: contested.join(", "),
      });

      return this.dossier(input.orderId);
    });
  }

  /* ---------------------------------------------------------- adjudication */

  /**
   * JUDGMENT.
   *
   * Submits the contested terms to the adjudication forum. Deterministic
   * findings travel as established facts; the forum is asked only what code
   * cannot decide. Returns immediately — consensus is polled, never awaited
   * inside a request.
   */
  async submitAdjudication(disputeId: string, actor?: Actor): Promise<OrderDossier> {
    const dispute = await this.store.getDispute(disputeId);
    if (!dispute) fail("DISPUTE_NOT_FOUND", `No dispute with id ${disputeId}`);

    return this.store.withOrderLock(dispute.orderId, async () => {
      const order = await this.requireOrder(dispute.orderId);
      assertCanAdjudicate(order, actor);
      const agreement = await this.requireAgreement(dispute.orderId);
      const delivery = await this.store.getDelivery(dispute.orderId);
      const verification = await this.store.getVerification(dispute.orderId);

      const existing = await this.store.getAdjudication(disputeId);
      if (
        existing &&
        ["SUBMITTED", "PENDING", "DECIDED", "APPEALED", "FINALIZED"].includes(existing.status)
      ) {
        // In flight, ruled or final: a second submission would only cost money.
        return this.dossier(dispute.orderId);
      }

      const contestedTerms = agreement.document.terms
        .filter((term) => dispute.contestedTermIds.includes(term.id))
        .map((term) => ({
          id: term.id,
          label: term.label,
          operator: term.operator,
          expected: `${term.expected}${term.unit ? ` ${term.unit}` : ""}`,
          mandatory: term.mandatory,
        }));

      if (contestedTerms.length === 0) {
        fail("VALIDATION_FAILED", "No contested terms resolve against the locked agreement");
      }

      const payload = {
        agreementHash: agreement.hash,
        evidenceHash: delivery?.evidenceHash ?? "unavailable",
        contestedTerms,
        deterministicFindings: (verification?.checks ?? []).map((check) => ({
          termId: check.termId,
          expression: check.expression,
          result: check.result,
        })),
        merchantStatement: delivery?.statement ?? "No merchant statement was submitted.",
        buyerClaim: dispute.claim,
        // From the locked agreement, never from the request.
        remedyMode: remedyModeFor(agreement),
      };

      const question =
        payload.remedyMode === "GRADUATED"
          ? "Given the deterministic findings, is the shortfall a material breach of the mandatory terms in contention, and what share of the price was not delivered?"
          : "Given the deterministic findings, is the shortfall a material breach of the mandatory terms in contention?";

      /*
       * A previous attempt may have failed transiently, leaving the order in
       * ADJUDICATING already. Re-entering the same state is not a legal edge,
       * so only transition when there is somewhere to go — otherwise a retry
       * would throw and the dispute would be stranded permanently.
       */
      const current =
        order.state === "ADJUDICATING" ? order : await this.moveTo(order, "ADJUDICATING");
      await this.store.putDispute({ ...dispute, status: "ADJUDICATING" });

      const outcome = await this.forum.submit({
        disputeId,
        orderId: dispute.orderId,
        question,
        payload,
      });

      const adjudication: Adjudication = {
        id: existing?.id ?? newAdjudicationId(),
        disputeId,
        orderId: dispute.orderId,
        forum: "GENLAYER",
        network: outcome.network,
        contractAddress: outcome.contractAddress,
        transactionHash: outcome.transactionHash,
        networkStatus: outcome.networkStatus,
        votes: outcome.votes,
        status: outcome.status,
        question,
        inputsHash: documentHash(payload as unknown as Json),
        ruling: outcome.ruling,
        failureReason: outcome.failureReason,
        submittedAt: this.clock.isoNow(),
        finalizedAt: outcome.finalizedAt,
        fees: outcome.fees ?? null,
        feeAccounting: outcome.feeAccounting ?? null,
        remedyMode: payload.remedyMode,
        submitter: outcome.submitter ?? null,
        contractVersion: outcome.contractVersion ?? null,
        finality: null,
        decidedAt: null,
        rounds: null,
        lifecycle: null,
        appeals: [],
        finalizationTx: null,
      };
      await this.store.putAdjudication(adjudication);

      if (outcome.status === "FAILED") {
        await this.emit(
          current,
          "ADJUDICATION_FAILED",
          outcome.failureReason ?? "Adjudication could not be submitted",
          outcome.fees
            ? { depositWei: outcome.fees.depositWei, feeSource: outcome.fees.source }
            : undefined,
        );
      } else {
        await this.emit(current, "ADJUDICATION_SUBMITTED", "Dispute submitted to GenLayer", {
          transaction: outcome.transactionHash,
          contract: outcome.contractAddress,
          // What the referral cost up front, and whether the network's live fee
          // policy agreed with the quote that was signed.
          deposit: outcome.fees ? formatGen(outcome.fees.depositWei) ?? outcome.fees.depositWei : "",
          feePolicy: outcome.fees ? outcome.fees.verification.status : "",
        });
      }

      return this.dossier(dispute.orderId);
    });
  }

  /**
   * Polls the forum and records what it reports.
   *
   * v0.2 separates three facts the v0.1 protocol collapsed into one:
   *
   *  - DECIDED: validators reached consensus. The ruling is readable, but
   *    GenLayer can still appeal and recompute it, so it is recorded as
   *    PROVISIONAL and the order waits in PROVISIONAL_RULING. Escrow stays held.
   *  - APPEALED: an appeal round is re-running consensus on that ruling.
   *  - FINALIZED: the finality window closed. The ruling is read from finalized
   *    state, the order moves to a ruled state, and only now can it settle.
   *
   * Appeal bookkeeping happens here too: an appeal is resolved once the
   * network shows its round is over, and is UPHELD or REVISED depending on
   * whether the award changed.
   */
  async pollAdjudication(disputeId: string): Promise<OrderDossier> {
    const dispute = await this.store.getDispute(disputeId);
    if (!dispute) fail("DISPUTE_NOT_FOUND", `No dispute with id ${disputeId}`);

    const adjudication = await this.store.getAdjudication(disputeId);
    if (!adjudication) fail("ADJUDICATION_UNAVAILABLE", "This dispute has not been submitted");
    if (adjudication.status === "FINALIZED" || adjudication.status === "FAILED") {
      return this.dossier(dispute.orderId);
    }
    if (!adjudication.transactionHash) {
      return this.dossier(dispute.orderId);
    }

    const outcome = await this.forum.poll({
      disputeId,
      transactionHash: adjudication.transactionHash,
      // The contract this adjudication was sent to, even after a redeploy.
      contractAddress: adjudication.contractAddress,
      submitter: adjudication.submitter ?? null,
      inputsHash: adjudication.inputsHash,
      contractVersion: adjudication.contractVersion ?? null,
    });

    return this.store.withOrderLock(dispute.orderId, async () => {
      let order = await this.requireOrder(dispute.orderId);
      const now = this.clock.isoNow();
      // Re-read under the lock: an appeal may have been filed while we polled.
      const latest = (await this.store.getAdjudication(disputeId)) ?? adjudication;
      if (latest.status === "FINALIZED" || latest.status === "FAILED") {
        return this.dossier(dispute.orderId);
      }

      /* ------------------------------------------------- appeal bookkeeping */
      const appeals: AppealRecord[] = [...(latest.appeals ?? [])];
      const pendingIndex = appeals.findIndex((appeal) => appeal.outcome === "PENDING");
      let pending: AppealRecord | null = pendingIndex >= 0 ? { ...appeals[pendingIndex] } : null;
      let resolvedAppeal: AppealRecord | null = null;

      if (pending) {
        if (outcome.status === "APPEALED" || outcome.status === "PENDING" || outcome.appealInFlight) {
          pending.observedInFlight = true;
        }
        const decided = outcome.status === "DECIDED" || outcome.status === "FINALIZED";
        if (decided && outcome.ruling) {
          /*
           * "Decided again" is only evidence the appeal is over if something
           * shows the appeal round actually happened: a round observed in
           * flight, more rounds, another failed appeal, a new decision id — or
           * finality itself. Otherwise this is the same acceptance the appeal
           * was filed against, seen before the network registered the appeal.
           */
          const roundsAdvanced =
            pending.roundsAtFiling !== null &&
            typeof outcome.rounds === "number" &&
            outcome.rounds > pending.roundsAtFiling;
          const failedAppealsAdvanced =
            pending.failedAppealsAtFiling !== null &&
            typeof outcome.failedAppeals === "number" &&
            outcome.failedAppeals > pending.failedAppealsAtFiling;
          const decisionChanged =
            pending.decisionId !== null &&
            Boolean(outcome.lifecycle?.decisionId) &&
            outcome.lifecycle?.decisionId !== pending.decisionId;
          if (
            pending.observedInFlight ||
            roundsAdvanced ||
            failedAppealsAdvanced ||
            decisionChanged ||
            outcome.status === "FINALIZED"
          ) {
            const after = snapshotOf(outcome.ruling);
            pending = {
              ...pending,
              rulingAfter: after,
              outcome: sameAward(pending.rulingBefore, after) ? "UPHELD" : "REVISED",
              resolvedAt: now,
            };
            resolvedAppeal = pending;
          }
        }
        appeals[pendingIndex] = pending;
      }
      const appealOpen = pending !== null && resolvedAppeal === null;

      /* ---------------------------------------------------- adjudication row */
      let status = outcome.status;
      if (appealOpen && status !== "FAILED" && status !== "FINALIZED") status = "APPEALED";
      // While a round is re-running, keep showing the ruling under appeal.
      const ruling =
        outcome.ruling ?? (status === "APPEALED" || status === "PENDING" ? latest.ruling : null);

      const updated: Adjudication = {
        ...latest,
        network: outcome.network ?? latest.network,
        networkStatus: outcome.networkStatus,
        votes: outcome.votes ?? latest.votes,
        status,
        ruling,
        failureReason: outcome.failureReason,
        finality: status === "FINALIZED" ? "FINAL" : ruling ? "PROVISIONAL" : null,
        decidedAt:
          latest.decidedAt ??
          (outcome.status === "DECIDED" || outcome.status === "FINALIZED" ? now : null),
        finalizedAt: status === "FINALIZED" ? outcome.finalizedAt ?? now : null,
        rounds: outcome.rounds ?? latest.rounds ?? null,
        lifecycle: outcome.lifecycle ?? latest.lifecycle ?? null,
        contractVersion: outcome.contractVersion ?? latest.contractVersion ?? null,
        appeals,
        finalizationTx: latest.finalizationTx ?? outcome.finalizationTx ?? null,
        // Fee consumption is read from the receipt on every poll, but only ever
        // replaced when the node actually reported it.
        feeAccounting: outcome.feeAccounting ?? latest.feeAccounting,
      };
      await this.store.putAdjudication(updated);

      /* ----------------------------------------------------- order and events */
      switch (status) {
        case "FAILED": {
          await this.store.putDispute({ ...dispute, status: "FAILED" });
          if (PROVISIONAL_STATES.includes(order.state)) {
            // Back to a state the dispute can be resubmitted from.
            order = await this.moveTo(order, "ADJUDICATING");
          }
          await this.emit(order, "ADJUDICATION_FAILED", outcome.failureReason ?? "Adjudication failed");
          break;
        }
        case "APPEALED": {
          if (order.state === "PROVISIONAL_RULING") {
            // An appeal round the protocol did not file is still an appeal.
            order = await this.moveTo(order, "APPEALED");
          }
          break;
        }
        case "DECIDED": {
          if (order.state === "ADJUDICATING" || order.state === "APPEALED") {
            const first = order.state === "ADJUDICATING";
            order = await this.moveTo(order, "PROVISIONAL_RULING");
            if (first && ruling) {
              await this.emit(
                order,
                "RULING_PROVISIONAL",
                `Provisional ruling: ${describeAward(ruling)}. Appealable until GenLayer finalizes it; escrow stays held.`,
                {
                  decision: ruling.decision,
                  refundBps: refundBpsOf(ruling),
                  transaction: latest.transactionHash,
                  networkStatus: outcome.networkStatus,
                },
              );
            }
          }
          break;
        }
        case "FINALIZED": {
          if (ruling && (order.state === "ADJUDICATING" || PROVISIONAL_STATES.includes(order.state))) {
            order = await this.moveTo(order, ruledStateFor(ruling));
            await this.store.putDispute({ ...dispute, status: "RULED" });
          }
          break;
        }
        default:
          break;
      }

      if (resolvedAppeal) {
        await this.emit(
          order,
          "APPEAL_RESOLVED",
          resolvedAppeal.outcome === "UPHELD"
            ? `Appeal resolved: the ruling stood (${describeAward(resolvedAppeal.rulingBefore)})`
            : `Appeal resolved: ${describeAward(resolvedAppeal.rulingBefore)} → ${describeAward(resolvedAppeal.rulingAfter!)}`,
          {
            appeal: resolvedAppeal.id,
            outcome: resolvedAppeal.outcome,
            requestedBy: resolvedAppeal.requestedBy,
          },
        );
      }
      if (updated.finalizationTx && !latest.finalizationTx) {
        await this.emit(
          order,
          "FINALIZATION_SUBMITTED",
          "The finality window elapsed; the protocol submitted finalization",
          { transaction: updated.finalizationTx },
        );
      }
      if (status === "FINALIZED" && ruling && RULED_STATES.includes(order.state)) {
        await this.emit(order, "RULING_FINALIZED", `Ruling final: ${describeAward(ruling)}`, {
          decision: ruling.decision,
          refundBps: refundBpsOf(ruling),
          violatedTerms: ruling.violatedTerms.join(", "),
          transaction: latest.transactionHash,
          appeals: appeals.length,
        });
      }

      return this.dossier(dispute.orderId);
    });
  }

  /* ---------------------------------------------------------------- appeals */

  /**
   * APPEAL.
   *
   * The losing side of a provisional ruling may ask GenLayer to re-evaluate
   * it: a larger validator committee re-runs the contract's validator
   * function, and if its majority disagrees the transaction is recomputed.
   * This is GenLayer's Optimistic Democracy, used as designed.
   *
   * Rules: only a party; only a side the ruling went against; once per party;
   * one appeal at a time; and only while the network still allows it. The
   * appeal is bound to the transaction and decision the network reports, and
   * the bond is quoted by the network rather than guessed.
   */
  async fileAppeal(input: FileAppealInput): Promise<OrderDossier> {
    const dispute = await this.store.getDispute(input.disputeId);
    if (!dispute) fail("DISPUTE_NOT_FOUND", `No dispute with id ${input.disputeId}`);

    return this.store.withOrderLock(dispute.orderId, async () => {
      let order = await this.requireOrder(dispute.orderId);
      const adjudication = await this.store.getAdjudication(input.disputeId);
      if (!adjudication || !adjudication.transactionHash) {
        fail("APPEAL_NOT_ALLOWED", "There is no adjudication transaction to appeal");
      }

      const appeals = adjudication.appeals ?? [];
      if (order.state === "APPEALED" || appeals.some((appeal) => appeal.outcome === "PENDING")) {
        fail("APPEAL_IN_PROGRESS", "An appeal against this ruling is already in progress");
      }
      if (RULED_STATES.includes(order.state) || adjudication.status === "FINALIZED") {
        fail("APPEAL_WINDOW_CLOSED", "The ruling is final; GenLayer no longer accepts appeals against it");
      }
      if (order.state !== "PROVISIONAL_RULING" || adjudication.status !== "DECIDED" || !adjudication.ruling) {
        fail("APPEAL_NOT_ALLOWED", `Order ${order.id} is ${order.state}; only a provisional ruling can be appealed`);
      }
      const ruling = adjudication.ruling;

      const losers = losingParties(ruling);
      const party = assertCanAppeal(
        order,
        input.actor,
        input.onBehalfOf ?? (!input.actor || isSystem(input.actor) ? losers[0] : undefined),
      );
      if (!losers.includes(party)) {
        fail(
          "APPEAL_NOT_ALLOWED",
          `The ruling (${describeAward(ruling)}) went in the ${party.toLowerCase()}'s favour; there is nothing for it to appeal`,
        );
      }
      if (appeals.some((appeal) => appeal.requestedBy === party)) {
        fail("APPEAL_NOT_ALLOWED", `The ${party.toLowerCase()} has already appealed this ruling once`);
      }

      if (!this.forum.available || !this.forum.appeal) {
        fail("APPEAL_UNAVAILABLE", "This adjudication forum does not support appeals");
      }

      const submission = await this.forum.appeal({
        disputeId: input.disputeId,
        transactionHash: adjudication.transactionHash,
      });
      if (submission.status === "REFUSED") {
        fail("APPEAL_WINDOW_CLOSED", submission.reason ?? "The network no longer accepts an appeal");
      }
      if (submission.status !== "FILED") {
        fail("APPEAL_UNAVAILABLE", submission.reason ?? "The appeal could not be submitted");
      }

      const now = this.clock.isoNow();
      const handle = party === "BUYER" ? order.buyer.handle : order.merchant.handle;
      const record: AppealRecord = {
        id: newAppealId(),
        requestedBy: party as AgentRole,
        requestedByHandle: input.actor && !isSystem(input.actor) ? input.actor.handle : handle,
        reason: input.reason ? input.reason.slice(0, 1_200) : "",
        filedAt: now,
        transactionHash: adjudication.transactionHash,
        chargeWei: submission.chargeWei,
        paidBy: submission.paidBy,
        decisionId: submission.decisionId ?? adjudication.lifecycle?.decisionId ?? null,
        roundsAtFiling: submission.rounds ?? adjudication.rounds ?? null,
        failedAppealsAtFiling: submission.failedAppeals,
        observedInFlight: false,
        rulingBefore: snapshotOf(ruling),
        rulingAfter: null,
        outcome: "PENDING",
        resolvedAt: null,
      };

      await this.store.putAdjudication({
        ...adjudication,
        status: "APPEALED",
        networkStatus: submission.networkStatus ?? adjudication.networkStatus,
        appeals: [...appeals, record],
      });
      order = await this.moveTo(order, "APPEALED");
      await this.emit(order, "APPEAL_FILED", `Appeal filed by ${record.requestedByHandle} against ${describeAward(ruling)}`, {
        appeal: record.id,
        requestedBy: party,
        transaction: adjudication.transactionHash,
        charge: submission.chargeWei ? formatGen(submission.chargeWei) ?? submission.chargeWei : "",
      });

      return this.dossier(dispute.orderId);
    });
  }

  /* ------------------------------------------------------------ settlement */

  /**
   * SETTLEMENT.
   *
   * Idempotent by construction: one settlement row per order, guarded by the
   * order lock and by the state machine, which has no edge from RELEASED or
   * REFUNDED to anywhere. Release and refund can never both execute.
   */
  async settle(orderId: string, actor?: Actor): Promise<OrderDossier> {
    // A ruling recorded under v0.1 rules was treated as final on acceptance.
    // Before money moves on one, confirm on-chain that it really is final.
    await this.confirmLegacyFinality(orderId);

    return this.store.withOrderLock(orderId, async () => {
      const order = await this.requireOrder(orderId);
      assertCanSettle(order, actor);
      const existing = await this.store.getSettlement(orderId);
      if (existing) {
        // Idempotent: repeat calls return the settlement that already happened.
        return this.dossier(orderId);
      }

      if (PROVISIONAL_STATES.includes(order.state)) {
        fail(
          "RULING_NOT_FINAL",
          `Order ${orderId} has a provisional ruling (${order.state}). It can still be appealed and recomputed, so escrow stays held until GenLayer finalizes it.`,
          { state: order.state },
        );
      }

      const payment = await this.store.getPayment(orderId);
      if (!payment) fail("SETTLEMENT_UNAVAILABLE", "There is no escrowed payment to settle");
      if (payment.escrow !== "HELD") {
        fail("SETTLEMENT_ALREADY_EXECUTED", `Escrow for ${orderId} is already ${payment.escrow}`);
      }

      let outcome: Settlement["outcome"];
      let refundBps: number;
      let reason: string;
      let nextState: OrderState;

      if (order.state === "FULFILLED") {
        outcome = "RELEASED";
        refundBps = 0;
        reason = "All mandatory terms were satisfied.";
        nextState = "RELEASED";
      } else if (RULED_STATES.includes(order.state)) {
        const adjudication = await this.store.getAdjudicationByOrder(orderId);
        if (!adjudication?.ruling) {
          fail("SETTLEMENT_UNAVAILABLE", `Order ${orderId} is ${order.state} but no ruling is recorded`);
        }
        if (adjudication.finality !== "FINAL") {
          fail(
            "RULING_NOT_FINAL",
            "This ruling was recorded on acceptance, under v0.1 rules, and the network has not confirmed it final with the same award. Escrow stays held.",
            { networkStatus: adjudication.networkStatus, transaction: adjudication.transactionHash },
          );
        }
        if (ruledStateFor(adjudication.ruling) !== order.state) {
          // The state and the ruling were written together; disagreement means
          // something wrote one without the other. Refuse rather than guess.
          fail(
            "SETTLEMENT_UNAVAILABLE",
            `Order ${orderId} is ${order.state} but its final ruling is ${adjudication.ruling.decision}`,
          );
        }
        refundBps = refundBpsOf(adjudication.ruling);
        if (order.state === "BUYER_WON") {
          outcome = "REFUNDED";
          refundBps = FULL_REFUND_BPS;
          reason = "Adjudication found a material breach of a mandatory term. The ruling is final.";
          nextState = "REFUNDED";
        } else if (order.state === "MERCHANT_WON") {
          outcome = "RELEASED";
          refundBps = 0;
          reason = "Adjudication found no material breach. The ruling is final.";
          nextState = "RELEASED";
        } else {
          if (refundBps <= 0 || refundBps >= FULL_REFUND_BPS) {
            fail("SETTLEMENT_UNAVAILABLE", `A split ruling must refund between 0 and 100%, not ${refundBps / 100}%`);
          }
          outcome = "PARTIAL_REFUND";
          reason = `Adjudication found a breach that cost the buyer part of what it paid for and awarded ${refundBps / 100}% of the escrow back. The ruling is final.`;
          nextState = "PARTIALLY_REFUNDED";
        }
      } else {
        fail(
          "SETTLEMENT_UNAVAILABLE",
          `Order ${orderId} is ${order.state}; settlement requires FULFILLED or a final ruling (BUYER_WON, MERCHANT_WON or SPLIT_AWARDED)`,
        );
      }

      /*
       * Money moves in legs. A split settlement has two — the buyer's refund,
       * rounded down to the micro-unit, and the merchant's release of exactly
       * the remainder — so the legs always add up to what was escrowed.
       */
      const buyer = order.buyer.handle;
      const merchant = order.merchant.handle;
      const currency = order.amount.currency;
      const { refund, release } = splitByBps(order.amount.amount, refundBps);
      const legs: SettlementLeg[] = [];
      let executedAt = this.clock.isoNow();

      if (toMicros(refund) > 0n) {
        const execution = await this.rail.refund({ orderId, amount: { amount: refund, currency }, to: buyer });
        legs.push({
          party: "BUYER",
          to: buyer,
          amount: { amount: refund, currency },
          execution: execution.execution,
          transactionHash: execution.transactionHash,
        });
        executedAt = execution.executedAt;
      }
      if (toMicros(release) > 0n) {
        const execution = await this.rail.release({ orderId, amount: { amount: release, currency }, to: merchant });
        legs.push({
          party: "MERCHANT",
          to: merchant,
          amount: { amount: release, currency },
          execution: execution.execution,
          transactionHash: execution.transactionHash,
        });
        executedAt = execution.executedAt;
      }

      const settlement: Settlement = {
        id: newSettlementId(),
        orderId,
        outcome,
        amount: order.amount,
        from: outcome === "REFUNDED" ? merchant : outcome === "RELEASED" ? buyer : "escrow",
        to: outcome === "REFUNDED" ? buyer : outcome === "RELEASED" ? merchant : `${buyer}, ${merchant}`,
        reason,
        idempotencyKey: `${orderId}:${outcome}`,
        rail: this.rail.id,
        execution: legs.every((leg) => leg.execution === "ONCHAIN")
          ? "ONCHAIN"
          : "SIGNATURE_VERIFIED_LOCAL_ESCROW",
        transactionHash: legs.find((leg) => leg.transactionHash)?.transactionHash ?? null,
        executedAt,
        refundBps,
        legs,
      };
      await this.store.putSettlement(settlement);
      await this.store.putPayment({
        ...payment,
        escrow: outcome === "REFUNDED" ? "REFUNDED" : outcome === "RELEASED" ? "RELEASED" : "SPLIT",
      });

      const current = await this.moveTo(order, nextState);
      const dispute = await this.store.getDisputeByOrder(orderId);
      if (dispute) await this.store.putDispute({ ...dispute, status: "SETTLED" });

      if (outcome === "PARTIAL_REFUND") {
        await this.emit(
          current,
          "PARTIAL_REFUND_EXECUTED",
          `Partial refund: ${refund} ${currency} to ${buyer}, ${release} ${currency} to ${merchant}`,
          {
            refundBps,
            refund: `${refund} ${currency}`,
            release: `${release} ${currency}`,
            execution: settlement.execution,
          },
        );
      } else {
        await this.emit(
          current,
          outcome === "REFUNDED" ? "REFUND_EXECUTED" : "MERCHANT_PAID",
          outcome === "REFUNDED" ? `Refund executed to ${buyer}` : `Escrow released to ${merchant}`,
          {
            amount: `${order.amount.amount} ${order.amount.currency}`,
            execution: settlement.execution,
          },
        );
      }

      return this.dossier(orderId);
    });
  }

  /**
   * Re-confirms, on-chain, the finality of a ruling recorded before v0.2.
   *
   * v0.1 treated an ACCEPTED transaction as final, so ledgers can hold rulings
   * whose finality was never actually observed. If such an order has not
   * settled yet, the forum is asked once more: only a FINALIZED transaction
   * whose finalized ruling awards the same thing is accepted. Anything else
   * leaves the record untouched, and `settle` refuses with RULING_NOT_FINAL.
   */
  private async confirmLegacyFinality(orderId: string): Promise<void> {
    const order = await this.store.getOrder(orderId);
    if (!order || !RULED_STATES.includes(order.state)) return;
    if (await this.store.getSettlement(orderId)) return;
    const adjudication = await this.store.getAdjudicationByOrder(orderId);
    if (!adjudication?.ruling || adjudication.finality === "FINAL" || !adjudication.transactionHash) return;

    const outcome = await this.forum.poll({
      disputeId: adjudication.disputeId,
      transactionHash: adjudication.transactionHash,
      contractAddress: adjudication.contractAddress,
      submitter: adjudication.submitter ?? null,
      inputsHash: adjudication.inputsHash,
      contractVersion: adjudication.contractVersion ?? null,
    });
    if (outcome.status !== "FINALIZED" || !outcome.ruling || !sameAward(outcome.ruling, adjudication.ruling)) {
      return;
    }

    await this.store.withOrderLock(orderId, async () => {
      const current = await this.store.getAdjudicationByOrder(orderId);
      if (!current || current.finality === "FINAL") return;
      await this.store.putAdjudication({
        ...current,
        finality: "FINAL",
        finalityConfirmedAt: this.clock.isoNow(),
        networkStatus: outcome.networkStatus ?? current.networkStatus,
      });
    });
  }

  /* ----------------------------------------------------------------- reads */

  async dossier(orderId: string): Promise<OrderDossier> {
    const order = await this.requireOrder(orderId);
    const agreement = await this.store.getAgreement(orderId);
    if (!agreement) fail("NOT_FOUND", `Order ${orderId} has no agreement`);

    const dispute = await this.store.getDisputeByOrder(orderId);
    return {
      order,
      agreement,
      payment: await this.store.getPayment(orderId),
      delivery: await this.store.getDelivery(orderId),
      verification: await this.store.getVerification(orderId),
      dispute,
      adjudication: dispute ? await this.store.getAdjudication(dispute.id) : null,
      settlement: await this.store.getSettlement(orderId),
      events: await this.store.listEvents(orderId),
    };
  }

  async dossierByDispute(disputeId: string): Promise<OrderDossier | null> {
    const dispute = await this.store.getDispute(disputeId);
    if (!dispute) return null;
    return this.dossier(dispute.orderId);
  }

  listOrders(): Promise<Order[]> {
    return this.store.listOrders();
  }

  listDisputes(): Promise<Dispute[]> {
    return this.store.listDisputes();
  }

  getOrder(orderId: string): Promise<Order | null> {
    return this.store.getOrder(orderId);
  }

  getAgreement(orderId: string): Promise<Agreement | null> {
    return this.store.getAgreement(orderId);
  }

  getDelivery(orderId: string): Promise<Delivery | null> {
    return this.store.getDelivery(orderId);
  }

  getVerification(orderId: string): Promise<Verification | null> {
    return this.store.getVerification(orderId);
  }

  getSettlement(orderId: string): Promise<Settlement | null> {
    return this.store.getSettlement(orderId);
  }

  getAdjudication(disputeId: string): Promise<Adjudication | null> {
    return this.store.getAdjudication(disputeId);
  }

  get forumDescription(): string {
    return this.forum.description;
  }

  get forumAvailable(): boolean {
    return this.forum.available;
  }

  get railId(): string {
    return this.rail.id;
  }

  get railNetwork(): string {
    return this.rail.network;
  }

  get railSettlesOnchain(): boolean {
    return this.rail.settlesOnchain;
  }
}
