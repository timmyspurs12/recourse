import type {
  Adjudication,
  Agreement,
  AgreementTerm,
  AgentRef,
  Currency,
  Delivery,
  Dispute,
  LedgerEvent,
  Money,
  Order,
  OrderDossier,
  OrderState,
  Payment,
  Settlement,
  Verification,
  EventType,
} from "../model";
import { PHASE_BY_STATE } from "../model";
import type {
  AdjudicationForum,
  PaymentAuthorization,
  PaymentRail,
  RecourseStore,
} from "../ports";
import { transition } from "./state-machine";
import {
  assertAgreementIntegrity,
  draftAgreement,
  lockAgreement,
} from "../agreements/agreement";
import { buildDelivery, sanitizeUntrusted, type EvidenceDraft } from "../evidence/evidence";
import { isMaterialBreach, verifyDelivery } from "../verification/engine";
import { documentHash, type Json } from "../shared/canonical";
import {
  formatOrderId,
  newAdjudicationId,
  newDisputeId,
  newEventId,
  newPaymentId,
  newSettlementId,
  orderRef,
} from "../shared/ids";
import { addHours, type Clock, systemClock } from "../shared/clock";
import {
  assertCanAdjudicate,
  assertCanDeliver,
  assertCanDispute,
  assertCanSettle,
  type Actor,
} from "../identity/authorization";
import { fail } from "../shared/errors";
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
      await this.requireAgreement(input.orderId);

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
        claimedRemedy: "FULL_REFUND",
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
      if (existing && (existing.status === "SUBMITTED" || existing.status === "PENDING")) {
        return this.dossier(dispute.orderId);
      }
      if (existing?.status === "FINALIZED") {
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
      };

      const question =
        "Given the deterministic findings, is the shortfall a material breach of the mandatory terms in contention?";

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
      };
      await this.store.putAdjudication(adjudication);

      if (outcome.status === "FAILED") {
        await this.emit(
          current,
          "ADJUDICATION_FAILED",
          outcome.failureReason ?? "Adjudication could not be submitted",
        );
      } else {
        await this.emit(current, "ADJUDICATION_SUBMITTED", "Dispute submitted to GenLayer", {
          transaction: outcome.transactionHash,
          contract: outcome.contractAddress,
        });
      }

      return this.dossier(dispute.orderId);
    });
  }

  /** Polls the forum and, once final, records the ruling. */
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
    });

    return this.store.withOrderLock(dispute.orderId, async () => {
      const order = await this.requireOrder(dispute.orderId);
      const updated: Adjudication = {
        ...adjudication,
        network: outcome.network ?? adjudication.network,
        networkStatus: outcome.networkStatus,
        votes: outcome.votes,
        status: outcome.status,
        ruling: outcome.ruling,
        failureReason: outcome.failureReason,
        finalizedAt: outcome.finalizedAt,
      };
      await this.store.putAdjudication(updated);

      if (outcome.status !== "FINALIZED" || !outcome.ruling) {
        if (outcome.status === "FAILED") {
          await this.store.putDispute({ ...dispute, status: "FAILED" });
          await this.emit(
            order,
            "ADJUDICATION_FAILED",
            outcome.failureReason ?? "Adjudication failed",
          );
        }
        return this.dossier(dispute.orderId);
      }

      const won = outcome.ruling.decision === "BUYER_WINS" ? "BUYER_WON" : "MERCHANT_WON";
      const current = await this.moveTo(order, won);
      await this.store.putDispute({ ...dispute, status: "RULED" });
      await this.emit(current, "RULING_FINALIZED", `Ruling: ${outcome.ruling.decision}`, {
        decision: outcome.ruling.decision,
        violatedTerms: outcome.ruling.violatedTerms.join(", "),
        transaction: adjudication.transactionHash,
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
    return this.store.withOrderLock(orderId, async () => {
      const order = await this.requireOrder(orderId);
      assertCanSettle(order, actor);
      const existing = await this.store.getSettlement(orderId);
      if (existing) {
        // Idempotent: repeat calls return the settlement that already happened.
        return this.dossier(orderId);
      }

      const payment = await this.store.getPayment(orderId);
      if (!payment) fail("SETTLEMENT_UNAVAILABLE", "There is no escrowed payment to settle");
      if (payment.escrow !== "HELD") {
        fail("SETTLEMENT_ALREADY_EXECUTED", `Escrow for ${orderId} is already ${payment.escrow}`);
      }

      let outcome: Settlement["outcome"];
      let reason: string;
      let nextState: OrderState;

      switch (order.state) {
        case "FULFILLED":
          outcome = "RELEASED";
          reason = "All mandatory terms were satisfied.";
          nextState = "RELEASED";
          break;
        case "MERCHANT_WON":
          outcome = "RELEASED";
          reason = "Adjudication found no material breach.";
          nextState = "RELEASED";
          break;
        case "BUYER_WON":
          outcome = "REFUNDED";
          reason = "Adjudication found a material breach of a mandatory term.";
          nextState = "REFUNDED";
          break;
        default:
          fail(
            "SETTLEMENT_UNAVAILABLE",
            `Order ${orderId} is ${order.state}; settlement requires FULFILLED, BUYER_WON or MERCHANT_WON`,
          );
      }

      const to = outcome === "REFUNDED" ? order.buyer.handle : order.merchant.handle;
      const execution =
        outcome === "REFUNDED"
          ? await this.rail.refund({ orderId, amount: order.amount, to })
          : await this.rail.release({ orderId, amount: order.amount, to });

      const settlement: Settlement = {
        id: newSettlementId(),
        orderId,
        outcome,
        amount: order.amount,
        from: outcome === "REFUNDED" ? order.merchant.handle : order.buyer.handle,
        to,
        reason,
        idempotencyKey: `${orderId}:${outcome}`,
        rail: this.rail.id,
        execution: execution.execution,
        transactionHash: execution.transactionHash,
        executedAt: execution.executedAt,
      };
      await this.store.putSettlement(settlement);
      await this.store.putPayment({
        ...payment,
        escrow: outcome === "REFUNDED" ? "REFUNDED" : "RELEASED",
      });

      const current = await this.moveTo(order, nextState);
      const dispute = await this.store.getDisputeByOrder(orderId);
      if (dispute) await this.store.putDispute({ ...dispute, status: "SETTLED" });

      await this.emit(
        current,
        outcome === "REFUNDED" ? "REFUND_EXECUTED" : "MERCHANT_PAID",
        outcome === "REFUNDED"
          ? `Refund executed to ${to}`
          : `Escrow released to ${to}`,
        {
          amount: `${order.amount.amount} ${order.amount.currency}`,
          execution: execution.execution,
        },
      );

      return this.dossier(orderId);
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
