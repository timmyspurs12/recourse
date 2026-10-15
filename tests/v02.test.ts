import { strict as assert } from "node:assert";
import test from "node:test";
import { RecourseProtocol } from "../domain/orders/service";
import { canTransition, TRANSITIONS } from "../domain/orders/state-machine";
import { agreementHash, assertAgreementIntegrity, draftAgreement } from "../domain/agreements/agreement";
import { splitByBps, toMicros, fromMicros } from "../domain/shared/money";
import type { AgreementDocument, OrderState } from "../domain/model";
import { refundBpsOf, sameAward } from "../domain/model";
import { SimulatedRail } from "../integrations/simulated/rail";
import {
  GenLayerForum,
  STATUS_NAMES,
  classifyStatus,
  parseRuling,
  rulingBindingProblem,
  type ForumClient,
} from "../integrations/genlayer/forum";
import { loadGenLayerConfig } from "../integrations/genlayer/config";
import {
  KNOWN_PY_GENLAYER_RUNNERS,
  checkRunnerPin,
  negotiateRunnerPin,
  runnerPinsInHeader,
  withRunnerPin,
} from "../integrations/genlayer/runner-pin";
import { BRIEF_TERMS, BUYER_CLAIM } from "../server/scenario";
import { ScriptedForum, buyBrief, harness, shortDelivery } from "./harness";

/**
 * v0.2: CONTESTABLE, FINAL, PROPORTIONAL.
 *
 * The accepted v0.1 protocol settled the moment GenLayer reported a ruling
 * ACCEPTED — while that ruling could still be appealed and recomputed — and
 * its remedies were all-or-nothing. These tests pin the three changes:
 *
 *  1. Finality. An accepted ruling is provisional; nothing settles until the
 *     network finalizes it, and rulings recorded on acceptance are re-checked.
 *  2. Appeals. The losing side can appeal a provisional ruling through
 *     GenLayer's own appeal mechanism, under rules the protocol enforces.
 *  3. Graduated remedies. An agreement can allow a partial refund, which
 *     settles in two exact legs.
 */

const merchant = { handle: "merchant.agent", authenticated: true };
const buyer = { handle: "shopper.agent", authenticated: true };
const stranger = { handle: "mallory.agent", authenticated: true };

async function disputed(protocol: RecourseProtocol, options?: Parameters<typeof buyBrief>[1]) {
  const orderId = await buyBrief(protocol, options);
  await protocol.submitDelivery(shortDelivery(orderId));
  const dossier = await protocol.openDispute({ orderId, claim: BUYER_CLAIM });
  const disputeId = dossier.dispute!.id;
  await protocol.submitAdjudication(disputeId);
  return { orderId, disputeId };
}

async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: { code?: string; message?: string }) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
}

/* ---------------------------------------------------------------- finality */

test("an accepted ruling is provisional: escrow stays held and settlement is refused", async () => {
  const forum = new ScriptedForum({ decision: "BUYER_WINS", provisionalPolls: 2 });
  const { protocol } = harness({ forum });
  const { orderId, disputeId } = await disputed(protocol);

  let dossier = await protocol.pollAdjudication(disputeId);
  assert.equal(dossier.order.state, "PROVISIONAL_RULING");
  assert.equal(dossier.adjudication?.status, "DECIDED");
  assert.equal(dossier.adjudication?.finality, "PROVISIONAL");
  assert.equal(dossier.adjudication?.ruling?.decision, "BUYER_WINS");
  assert.equal(dossier.adjudication?.finalizedAt, null, "not final, so no finalization time");
  assert.ok(dossier.events.some((event) => event.type === "RULING_PROVISIONAL"));
  assert.ok(!dossier.events.some((event) => event.type === "RULING_FINALIZED"));

  // The v0.1 failure mode, now refused: money does not move on a ruling that
  // can still be appealed.
  await rejects(protocol.settle(orderId), "RULING_NOT_FINAL");
  assert.equal((await protocol.dossier(orderId)).payment?.escrow, "HELD");

  dossier = await protocol.pollAdjudication(disputeId);
  assert.equal(dossier.order.state, "PROVISIONAL_RULING", "still inside the finality window");

  dossier = await protocol.pollAdjudication(disputeId);
  assert.equal(dossier.order.state, "BUYER_WON");
  assert.equal(dossier.adjudication?.status, "FINALIZED");
  assert.equal(dossier.adjudication?.finality, "FINAL");
  assert.ok(dossier.adjudication?.finalizedAt);
  assert.ok(dossier.events.some((event) => event.type === "RULING_FINALIZED"));

  dossier = await protocol.settle(orderId);
  assert.equal(dossier.order.state, "REFUNDED");
  assert.equal(dossier.settlement?.refundBps, 10_000);
  assert.equal(dossier.settlement?.legs?.length, 1);
});

test("the forum is told which inputs and which signer a ruling must be bound to", async () => {
  const forum = new ScriptedForum({ provisionalPolls: 1 });
  const { protocol } = harness({ forum });
  const { disputeId } = await disputed(protocol);
  await protocol.pollAdjudication(disputeId);

  const adjudication = await protocol.getAdjudication(disputeId);
  const input = forum.pollInputs.at(-1)!;
  assert.equal(input.inputsHash, adjudication?.inputsHash);
  assert.equal(input.submitter, "0xsubmitter");
  assert.equal(input.contractAddress, "0xtest", "polled at the address it was sent to, even after a redeploy");
});

test("a ruling recorded on acceptance under v0.1 rules is re-confirmed on-chain before it settles", async () => {
  // Reach BUYER_WON, then rewrite the adjudication the way v0.1 stored it:
  // FINALIZED on the protocol side, ACCEPTED on the network side, no finality.
  const { protocol, store } = harness({ forum: new ScriptedForum() });
  const { orderId, disputeId } = await disputed(protocol);
  await protocol.pollAdjudication(disputeId);
  const recorded = (await store.getAdjudication(disputeId))!;
  const legacy = { ...recorded, networkStatus: "ACCEPTED" };
  delete (legacy as { finality?: unknown }).finality;
  await store.putAdjudication(legacy);
  assert.equal((await protocol.dossier(orderId)).order.state, "BUYER_WON");

  // The network still says ACCEPTED: the window never closed. No settlement.
  const stillAccepted = new RecourseProtocol({
    store,
    rail: new SimulatedRail(),
    forum: new ScriptedForum({ provisionalPolls: 99 }),
  });
  await rejects(stillAccepted.settle(orderId), "RULING_NOT_FINAL");

  // Finalized, but on appeal the award changed: still no settlement on the
  // ruling that was recorded.
  const overturned = new RecourseProtocol({
    store,
    rail: new SimulatedRail(),
    forum: new ScriptedForum({ decision: "MERCHANT_WINS" }),
  });
  await rejects(overturned.settle(orderId), "RULING_NOT_FINAL");

  // Finalized with the same award: confirmed, stamped, settled.
  const confirmed = new RecourseProtocol({ store, rail: new SimulatedRail(), forum: new ScriptedForum() });
  const dossier = await confirmed.settle(orderId);
  assert.equal(dossier.order.state, "REFUNDED");
  assert.equal(dossier.adjudication?.finality, "FINAL");
  assert.ok(dossier.adjudication?.finalityConfirmedAt);
});

test("no edge settles a provisional ruling, and ruled states are only entered from judgment", () => {
  for (const provisional of ["PROVISIONAL_RULING", "APPEALED"] as OrderState[]) {
    for (const settled of ["REFUNDED", "RELEASED", "PARTIALLY_REFUNDED"] as OrderState[]) {
      assert.equal(canTransition(provisional, settled), false, `${provisional} → ${settled}`);
    }
  }
  assert.deepEqual(TRANSITIONS.SPLIT_AWARDED, ["PARTIALLY_REFUNDED"]);
  assert.deepEqual(TRANSITIONS.PARTIALLY_REFUNDED, []);
  for (const ruled of ["BUYER_WON", "MERCHANT_WON", "SPLIT_AWARDED"] as OrderState[]) {
    const sources = (Object.keys(TRANSITIONS) as OrderState[]).filter((from) => TRANSITIONS[from].includes(ruled));
    assert.deepEqual(sources.sort(), ["ADJUDICATING", "APPEALED", "PROVISIONAL_RULING"], ruled);
  }
});

test("a network failure after acceptance returns the dispute to a resubmittable state", async () => {
  class FailsAfterAcceptance extends ScriptedForum {
    private calls = 0;
    override async poll(input?: Record<string, unknown>) {
      this.calls += 1;
      if (this.calls === 1) return super.poll(input);
      return {
        status: "FAILED" as const,
        network: "TEST",
        contractAddress: "0xtest",
        transactionHash: "0xtx",
        networkStatus: "UNDETERMINED",
        votes: null,
        ruling: null,
        failureReason: "The network failed to decide this transaction (UNDETERMINED).",
        finalizedAt: null,
      };
    }
  }
  const { protocol } = harness({ forum: new FailsAfterAcceptance({ provisionalPolls: 5 }) });
  const { disputeId } = await disputed(protocol);
  assert.equal((await protocol.pollAdjudication(disputeId)).order.state, "PROVISIONAL_RULING");
  const dossier = await protocol.pollAdjudication(disputeId);
  assert.equal(dossier.order.state, "ADJUDICATING");
  assert.equal(dossier.dispute?.status, "FAILED");
});

/* ----------------------------------------------------------------- appeals */

test("the losing side appeals; an upheld appeal keeps the award and then finalizes", async () => {
  const forum = new ScriptedForum({ decision: "BUYER_WINS", provisionalPolls: 1, appeal: { appealPolls: 1 } });
  const { protocol } = harness({ forum });
  const { orderId, disputeId } = await disputed(protocol);
  await protocol.pollAdjudication(disputeId);

  let dossier = await protocol.fileAppeal({ disputeId, actor: merchant, reason: "Three sources were enough." });
  assert.equal(dossier.order.state, "APPEALED");
  assert.equal(dossier.adjudication?.status, "APPEALED");
  const filed = dossier.adjudication!.appeals![0];
  assert.equal(filed.requestedBy, "MERCHANT");
  assert.equal(filed.requestedByHandle, "merchant.agent");
  assert.equal(filed.outcome, "PENDING");
  assert.equal(filed.chargeWei, "2500000000000000000", "the charge is the network's quote");
  assert.equal(filed.rulingBefore.decision, "BUYER_WINS");
  assert.equal(forum.appealRequests[0].transactionHash, dossier.adjudication?.transactionHash);
  await rejects(protocol.settle(orderId), "RULING_NOT_FINAL");

  dossier = await protocol.pollAdjudication(disputeId); // appeal round in flight
  assert.equal(dossier.order.state, "APPEALED");
  assert.equal(dossier.adjudication?.ruling?.decision, "BUYER_WINS", "the ruling under appeal stays visible");

  dossier = await protocol.pollAdjudication(disputeId); // decided again
  assert.equal(dossier.order.state, "PROVISIONAL_RULING");
  const resolved = dossier.adjudication!.appeals![0];
  assert.equal(resolved.outcome, "UPHELD");
  assert.equal(resolved.observedInFlight, true);
  assert.ok(dossier.events.some((event) => event.type === "APPEAL_FILED"));
  assert.ok(dossier.events.some((event) => event.type === "APPEAL_RESOLVED"));

  dossier = await protocol.pollAdjudication(disputeId);
  assert.equal(dossier.order.state, "BUYER_WON");
  assert.equal((await protocol.settle(orderId)).order.state, "REFUNDED");
});

test("a successful appeal revises the ruling before a single unit settles", async () => {
  const forum = new ScriptedForum({
    decision: "BUYER_WINS",
    provisionalPolls: 1,
    appeal: { revisedDecision: "MERCHANT_WINS", appealPolls: 1 },
  });
  const { protocol } = harness({ forum });
  const { orderId, disputeId } = await disputed(protocol);
  await protocol.pollAdjudication(disputeId);
  await protocol.fileAppeal({ disputeId, actor: merchant });
  await protocol.pollAdjudication(disputeId);
  let dossier = await protocol.pollAdjudication(disputeId);

  const appeal = dossier.adjudication!.appeals![0];
  assert.equal(appeal.outcome, "REVISED");
  assert.equal(appeal.rulingBefore.decision, "BUYER_WINS");
  assert.equal(appeal.rulingAfter?.decision, "MERCHANT_WINS");
  assert.equal(dossier.order.state, "PROVISIONAL_RULING");

  dossier = await protocol.pollAdjudication(disputeId);
  assert.equal(dossier.order.state, "MERCHANT_WON");
  dossier = await protocol.settle(orderId);
  assert.equal(dossier.order.state, "RELEASED");
  assert.equal(dossier.settlement?.outcome, "RELEASED");
});

test("an appeal the network has not registered yet is not mistaken for a resolved one", async () => {
  const forum = new ScriptedForum({
    decision: "BUYER_WINS",
    provisionalPolls: 1,
    appeal: { revisedDecision: "MERCHANT_WINS", lagPolls: 2, appealPolls: 1 },
  });
  const { protocol } = harness({ forum });
  const { disputeId } = await disputed(protocol);
  await protocol.pollAdjudication(disputeId);
  await protocol.fileAppeal({ disputeId, actor: merchant });

  // The network still reports the same acceptance, with the same counters.
  for (let i = 0; i < 2; i += 1) {
    const dossier = await protocol.pollAdjudication(disputeId);
    assert.equal(dossier.order.state, "APPEALED");
    assert.equal(dossier.adjudication?.status, "APPEALED");
    assert.equal(dossier.adjudication!.appeals![0].outcome, "PENDING");
  }
  await protocol.pollAdjudication(disputeId); // in flight
  const dossier = await protocol.pollAdjudication(disputeId);
  assert.equal(dossier.adjudication!.appeals![0].outcome, "REVISED");
});

test("an appeal round that finishes between two polls is still detected, from the round counter", async () => {
  const forum = new ScriptedForum({
    decision: "BUYER_WINS",
    provisionalPolls: 1,
    appeal: { revisedDecision: "MERCHANT_WINS", appealPolls: 0 },
  });
  const { protocol } = harness({ forum });
  const { disputeId } = await disputed(protocol);
  await protocol.pollAdjudication(disputeId);
  await protocol.fileAppeal({ disputeId, actor: merchant });

  const dossier = await protocol.pollAdjudication(disputeId);
  const appeal = dossier.adjudication!.appeals![0];
  assert.equal(appeal.observedInFlight, false, "the round was never seen in flight");
  assert.equal(appeal.outcome, "REVISED");
  assert.equal(dossier.order.state, "PROVISIONAL_RULING");
});

test("finality reached during an unresolved appeal resolves it from the final ruling", async () => {
  const forum = new ScriptedForum({ decision: "BUYER_WINS", provisionalPolls: 1, appeal: { appealPolls: 0 } });
  const { protocol } = harness({ forum });
  const { disputeId } = await disputed(protocol);
  await protocol.pollAdjudication(disputeId);
  await protocol.fileAppeal({ disputeId, actor: merchant });
  await protocol.pollAdjudication(disputeId); // decided again, failed appeal counted
  const dossier = await protocol.pollAdjudication(disputeId);
  assert.equal(dossier.order.state, "BUYER_WON");
  assert.equal(dossier.adjudication!.appeals![0].outcome, "UPHELD");
});

test("appeal rules: only a losing party, once each, one at a time, and only while appealable", async () => {
  const forum = new ScriptedForum({ decision: "BUYER_WINS", provisionalPolls: 3, appeal: { appealPolls: 1 } });
  const { protocol } = harness({ forum });
  const { orderId, disputeId } = await disputed(protocol);

  // Nothing to appeal before a ruling exists.
  await rejects(protocol.fileAppeal({ disputeId, actor: merchant }), "APPEAL_NOT_ALLOWED");
  await protocol.pollAdjudication(disputeId);

  await rejects(protocol.fileAppeal({ disputeId, actor: buyer }), "APPEAL_NOT_ALLOWED");
  await rejects(protocol.fileAppeal({ disputeId, actor: stranger }), "UNAUTHORIZED");

  await protocol.fileAppeal({ disputeId, actor: merchant });
  await rejects(protocol.fileAppeal({ disputeId, actor: merchant }), "APPEAL_IN_PROGRESS");

  await protocol.pollAdjudication(disputeId);
  await protocol.pollAdjudication(disputeId);
  assert.equal((await protocol.dossier(orderId)).order.state, "PROVISIONAL_RULING");
  await rejects(protocol.fileAppeal({ disputeId, actor: merchant }), "APPEAL_NOT_ALLOWED");

  for (let i = 0; i < 4; i += 1) await protocol.pollAdjudication(disputeId);
  assert.equal((await protocol.dossier(orderId)).order.state, "BUYER_WON");
  await rejects(protocol.fileAppeal({ disputeId, actor: merchant }), "APPEAL_WINDOW_CLOSED");
  assert.equal(forum.appealRequests.length, 1, "refused appeals never reach the network");
});

test("when the network refuses or cannot take an appeal, nothing moves", async () => {
  for (const [script, code] of [
    [{ refuse: true }, "APPEAL_WINDOW_CLOSED"],
    [{ fail: "insufficient funds for the appeal bond" }, "APPEAL_UNAVAILABLE"],
  ] as const) {
    const { protocol } = harness({ forum: new ScriptedForum({ provisionalPolls: 2, appeal: script }) });
    const { orderId, disputeId } = await disputed(protocol);
    await protocol.pollAdjudication(disputeId);
    await rejects(protocol.fileAppeal({ disputeId, actor: merchant }), code);
    const dossier = await protocol.dossier(orderId);
    assert.equal(dossier.order.state, "PROVISIONAL_RULING");
    assert.deepEqual(dossier.adjudication?.appeals, []);
  }
});

test("a split ruling leaves both sides short, so either may appeal it — once each", async () => {
  const forum = new ScriptedForum({ decision: "SPLIT", refundBps: 6_000, provisionalPolls: 4, appeal: { appealPolls: 1 } });
  const { protocol } = harness({ forum });
  const { disputeId } = await disputed(protocol, { remedy: "graduated_refund" });
  await protocol.pollAdjudication(disputeId);

  await protocol.fileAppeal({ disputeId, actor: merchant });
  await protocol.pollAdjudication(disputeId);
  await protocol.pollAdjudication(disputeId);
  const dossier = await protocol.fileAppeal({ disputeId, actor: buyer });
  assert.deepEqual(dossier.adjudication!.appeals!.map((appeal) => appeal.requestedBy), ["MERCHANT", "BUYER"]);
});

test("the protocol, acting for the demo, must appeal for a side the ruling went against", async () => {
  const { protocol } = harness({ forum: new ScriptedForum({ decision: "MERCHANT_WINS", provisionalPolls: 2 }) });
  const { disputeId } = await disputed(protocol);
  await protocol.pollAdjudication(disputeId);
  await rejects(protocol.fileAppeal({ disputeId, onBehalfOf: "MERCHANT" }), "APPEAL_NOT_ALLOWED");
  // With no side named, it appeals for the side that lost.
  const dossier = await protocol.fileAppeal({ disputeId });
  assert.equal(dossier.adjudication!.appeals![0].requestedBy, "BUYER");
});

/* ------------------------------------------------------ graduated remedies */

test("a graduated agreement asks for a proportional remedy and settles in two exact legs", async () => {
  const forum = new ScriptedForum({ decision: "SPLIT", refundBps: 6_000 });
  const { protocol } = harness({ forum });
  const { orderId, disputeId } = await disputed(protocol, { remedy: "graduated_refund" });

  const agreement = (await protocol.getAgreement(orderId))!;
  assert.equal(agreement.document.version, "recourse/0.2");
  assert.equal(agreement.document.refundPolicy.settlement, "graduated_refund");
  assert.equal((await protocol.dossier(orderId)).dispute?.claimedRemedy, "PROPORTIONAL_REFUND");
  assert.equal(forum.requests[0].payload.remedyMode, "GRADUATED", "taken from the locked agreement");

  let dossier = await protocol.pollAdjudication(disputeId);
  assert.equal(dossier.order.state, "SPLIT_AWARDED");
  dossier = await protocol.settle(orderId);
  assert.equal(dossier.order.state, "PARTIALLY_REFUNDED");
  assert.equal(dossier.settlement?.outcome, "PARTIAL_REFUND");
  assert.equal(dossier.settlement?.refundBps, 6_000);
  assert.deepEqual(
    dossier.settlement?.legs?.map((leg) => [leg.party, leg.to, leg.amount.amount]),
    [
      ["BUYER", "shopper.agent", "0.60"],
      ["MERCHANT", "merchant.agent", "0.40"],
    ],
  );
  assert.equal(dossier.payment?.escrow, "SPLIT");
  assert.ok(dossier.events.some((event) => event.type === "PARTIAL_REFUND_EXECUTED"));

  // Idempotent like every other settlement.
  const again = await protocol.settle(orderId);
  assert.equal(again.settlement?.id, dossier.settlement?.id);
});

test("an all-or-nothing agreement never asks for a split", async () => {
  const forum = new ScriptedForum();
  const { protocol } = harness({ forum });
  const { orderId } = await disputed(protocol);
  assert.equal(forum.requests[0].payload.remedyMode, "ALL_OR_NOTHING");
  assert.equal((await protocol.dossier(orderId)).dispute?.claimedRemedy, "FULL_REFUND");
});

test("a split that refunds nothing or everything is refused at settlement", async () => {
  const { protocol } = harness({ forum: new ScriptedForum({ decision: "SPLIT", refundBps: 10_000 }) });
  const { orderId, disputeId } = await disputed(protocol, { remedy: "graduated_refund" });
  await protocol.pollAdjudication(disputeId);
  await rejects(protocol.settle(orderId), "SETTLEMENT_UNAVAILABLE");
});

test("split arithmetic is exact: rounding never pays out more than was escrowed", () => {
  assert.deepEqual(splitByBps("1.00", 6_000), { refund: "0.60", release: "0.40" });
  assert.deepEqual(splitByBps("2.25", 3_333), { refund: "0.749925", release: "1.500075" });
  assert.deepEqual(splitByBps("0.000001", 5_000), { refund: "0.00", release: "0.000001" });
  assert.deepEqual(splitByBps("1.5", 10_000), { refund: "1.50", release: "0.00" });
  assert.equal(fromMicros(toMicros("12.345678")), "12.345678");
  assert.throws(() => splitByBps("1.00", 10_001), RangeError);
  assert.throws(() => splitByBps("1.00", 12.5), RangeError);
  assert.throws(() => splitByBps("1.0000001", 5_000), RangeError);

  for (let i = 0; i < 500; i += 1) {
    const micros = BigInt(1 + Math.floor(Math.random() * 10_000_000_000));
    const bps = Math.floor(Math.random() * 10_001);
    const { refund, release } = splitByBps(fromMicros(micros), bps);
    assert.equal(toMicros(refund) + toMicros(release), micros, `${micros} @ ${bps}`);
    assert.ok(toMicros(refund) * 10_000n <= micros * BigInt(bps), "refund is rounded down");
  }
});

test("agreements stay verifiable across document versions", () => {
  const draft = draftAgreement({
    orderId: "RC-000900",
    buyer: "shopper.agent",
    merchant: "merchant.agent",
    resource: { name: "Brief", type: "digital_report" },
    amount: "1.00",
    currency: "USDC",
    rail: "x402",
    terms: BRIEF_TERMS,
    deliveryDeadline: "2026-10-16T00:00:00.000Z",
    recourseWindowHours: 72,
    createdAt: "2026-10-15T00:00:00.000Z",
  });
  // A recourse/0.1 document locked under the old version keeps verifying.
  const legacyDocument: AgreementDocument = { ...draft.document, version: "recourse/0.1" };
  const legacy = { ...draft, document: legacyDocument, hash: agreementHash(legacyDocument) };
  assert.doesNotThrow(() => assertAgreementIntegrity(legacy));
  assert.notEqual(legacy.hash, draft.hash, "the version is part of what is hashed");
  // And neither can be relabelled after the fact.
  assert.throws(() => assertAgreementIntegrity({ ...legacy, document: draft.document }));
  assert.throws(() =>
    draftAgreement({ ...BRIEF_DRAFT, remedy: "half_refund" as never }),
  );
});

const BRIEF_DRAFT = {
  orderId: "RC-000901",
  buyer: "a",
  merchant: "b",
  resource: { name: "n", type: "t" },
  amount: "1.00",
  currency: "USDC" as const,
  rail: "x402",
  terms: BRIEF_TERMS,
  deliveryDeadline: "2026-10-16T00:00:00.000Z",
  recourseWindowHours: 72,
  createdAt: "2026-10-15T00:00:00.000Z",
};

test("refunds are read the same way from both ruling generations", () => {
  assert.equal(refundBpsOf({ decision: "BUYER_WINS" }), 10_000);
  assert.equal(refundBpsOf({ decision: "MERCHANT_WINS" }), 0);
  assert.equal(refundBpsOf({ decision: "SPLIT", refundBps: 4_000 }), 4_000);
  assert.equal(sameAward({ decision: "BUYER_WINS" }, { decision: "BUYER_WINS", refundBps: 10_000 }), true);
  assert.equal(sameAward({ decision: "SPLIT", refundBps: 4_000 }, { decision: "SPLIT", refundBps: 5_000 }), false);
});

/* ------------------------------------------------- the GenLayer forum (v0.6) */

const CONTRACT = "0x00000000000000000000000000000000000000aa";
const SIGNER = "0x00000000000000000000000000000000000000bb";
const INPUTS = `0x${"33".repeat(32)}`;
const TX = `0x${"77".repeat(32)}`;

const V1_MISSING = new Error(
  "ValueError: method is abstract `<function Contract.__handle_undefined_method__ at 0x1>`",
);

function rulingJson(fields: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema: "recourse.ruling/2",
    decision: "SPLIT",
    material_breach: true,
    violated_terms: ["minimum_sources"],
    satisfied_terms: [],
    refund_bps: 6_000,
    recommended_settlement: "SPLIT",
    remedy_mode: "GRADUATED",
    reasoning_summary: "Three of five sources still carries most of the value.",
    inputs_hash: INPUTS,
    submitter: SIGNER,
    ...fields,
  });
}

interface FakeOptions {
  receipt?: Record<string, unknown>;
  policy?: string | Error;
  ruling?: string;
  v1InputsHash?: string;
  lifecycle?: Record<string, unknown> | Error;
  canAppeal?: boolean;
  charge?: bigint;
  probeFails?: boolean;
}

function fakeClient(options: FakeOptions = {}) {
  const calls = {
    reads: [] as Array<{ functionName: string; args: unknown[]; variant?: string }>,
    appeals: [] as Array<{ txId: string; value?: bigint }>,
    finalizations: [] as string[],
    funding: [] as unknown[],
  };
  const policy = options.policy === undefined ? JSON.stringify({ version: "2.0.0" }) : options.policy;
  const client: ForumClient = {
    async getTransaction() {
      return options.receipt ?? { statusName: "ACCEPTED", txExecutionResultName: "FINISHED_WITH_RETURN", numOfRounds: "1" };
    },
    async readContract({ functionName, args, transactionHashVariant }) {
      calls.reads.push({ functionName, args, variant: transactionHashVariant });
      if (functionName === "get_policy") {
        if (policy instanceof Error) throw policy;
        return policy;
      }
      if (functionName === "get_ruling") {
        if (args[0] === "recourse:contract-version-probe") {
          if (options.probeFails || !(policy instanceof Error)) throw new Error("connection refused");
          return "";
        }
        return options.ruling ?? rulingJson();
      }
      if (functionName === "get_inputs_hash") return options.v1InputsHash ?? INPUTS;
      throw new Error(`unexpected read ${functionName}`);
    },
    async getBalance() {
      return 0n;
    },
    async request(args) {
      calls.funding.push(args);
      return null;
    },
    async canAppeal() {
      return options.canAppeal ?? true;
    },
    async getAppealCharge() {
      return options.charge ?? 123n;
    },
    async appealTransaction(args) {
      calls.appeals.push(args);
      return args.txId;
    },
    async finalizeTransaction(args) {
      calls.finalizations.push(args.txId);
      return "0xfinalize";
    },
    advanced: {
      async getTransactionLifecycle() {
        if (options.lifecycle instanceof Error) throw options.lifecycle;
        return (
          options.lifecycle ?? {
            storedStatus: "Accepted",
            projectedStatus: "Accepted",
            resolutionAction: "NoOp",
            decisionId: "7",
            decisionActive: true,
          }
        );
      },
    },
  };
  return { client, calls };
}

function forumOn(network: string, client: ForumClient) {
  return new GenLayerForum(
    loadGenLayerConfig({
      GENLAYER_NETWORK: network,
      GENLAYER_CONTRACT_ADDRESS: CONTRACT,
      GENLAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
    }),
    undefined,
    () => client,
  );
}

const pollV2 = { disputeId: "dsp_rc-000101", transactionHash: TX, submitter: SIGNER, inputsHash: INPUTS };

test("v0.6 status codes: 13 is a transaction still being decided, not a timeout", () => {
  assert.equal(STATUS_NAMES[13], "LEADER_REVEALING");
  assert.equal(classifyStatus(STATUS_NAMES[13]), "PROCESSING");
  assert.equal(STATUS_NAMES[11], "VALIDATORS_TIMEOUT");
  assert.equal(classifyStatus(STATUS_NAMES[11]), "FAILED");
  assert.equal(classifyStatus(STATUS_NAMES[5]), "ACCEPTED");
  assert.equal(classifyStatus(STATUS_NAMES[7]), "FINALIZED");
  assert.equal(classifyStatus(STATUS_NAMES[9]), "APPEALING");
  // Unknown is never failure: escrow must not be released on a status we cannot read.
  assert.equal(classifyStatus("STATUS_42"), "PROCESSING");
});

test("ACCEPTED is reported DECIDED from latest-nonfinal state; FINALIZED from latest-final", async () => {
  const accepted = fakeClient();
  let outcome = await forumOn("testnet-bradbury", accepted.client).poll(pollV2);
  assert.equal(outcome.status, "DECIDED");
  assert.equal(outcome.ruling?.decision, "SPLIT");
  assert.equal(outcome.ruling?.refundBps, 6_000);
  assert.equal(outcome.finalizedAt, null);
  assert.equal(outcome.lifecycle?.decisionId, "7");
  const read = accepted.calls.reads.find((call) => call.functionName === "get_ruling")!;
  assert.deepEqual(read.args, [SIGNER, "dsp_rc-000101"], "v2 rulings are read by submitter");
  assert.equal(read.variant, "latest-nonfinal");

  const finalized = fakeClient({
    receipt: { status: 7, txExecutionResult: 1, numOfRounds: "3", appeal_failed: 1 },
  });
  outcome = await forumOn("testnet-bradbury", finalized.client).poll(pollV2);
  assert.equal(outcome.status, "FINALIZED");
  assert.ok(outcome.finalizedAt);
  assert.equal(outcome.rounds, 3);
  assert.equal(outcome.failedAppeals, 1);
  assert.equal(finalized.calls.reads.find((call) => call.functionName === "get_ruling")!.variant, "latest-final");
});

test("protocol-style status names are understood ('Accepted', 'AppealRevealing')", async () => {
  let outcome = await forumOn(
    "testnet-bradbury",
    fakeClient({ receipt: { statusName: "Accepted", txExecutionResultName: "FINISHED_WITH_RETURN" } }).client,
  ).poll(pollV2);
  assert.equal(outcome.status, "DECIDED");

  outcome = await forumOn(
    "testnet-bradbury",
    fakeClient({ receipt: { statusName: "AppealRevealing" } }).client,
  ).poll(pollV2);
  assert.equal(outcome.status, "APPEALED");
  assert.equal(outcome.appealInFlight, true);
});

test("a v2 ruling must echo the inputs and the signer the protocol submitted", async () => {
  for (const [ruling, pattern] of [
    [rulingJson({ inputs_hash: `0x${"44".repeat(32)}` }), /made against inputs/],
    [rulingJson({ submitter: "0x00000000000000000000000000000000000000cc" }), /requested by/],
  ] as const) {
    const outcome = await forumOn("testnet-bradbury", fakeClient({ ruling }).client).poll(pollV2);
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.ruling, null);
    assert.match(outcome.failureReason ?? "", pattern);
  }
  // The submitter comparison ignores checksum casing.
  const mixed = rulingJson({ submitter: SIGNER.toUpperCase().replace("0X", "0x") });
  const ok = await forumOn("testnet-bradbury", fakeClient({ ruling: mixed }).client).poll(pollV2);
  assert.equal(ok.status, "DECIDED");
});

test("on a v1 contract, a ruling recorded against different inputs is refused (pre-emption, reused ids)", async () => {
  const v1Ruling = JSON.stringify({
    decision: "MERCHANT_WINS",
    material_breach: false,
    violated_terms: [],
    satisfied_terms: ["minimum_sources"],
    recommended_settlement: "RELEASE",
    reasoning_summary: "Stored by whoever got to this dispute id first.",
  });
  const preempted = fakeClient({ policy: V1_MISSING, ruling: v1Ruling, v1InputsHash: `0x${"ee".repeat(32)}` });
  const outcome = await forumOn("testnet-bradbury", preempted.client).poll(pollV2);
  assert.equal(outcome.contractVersion, 1);
  assert.equal(outcome.status, "FAILED");
  assert.match(outcome.failureReason ?? "", /Refusing to act on this ruling/);
  assert.deepEqual(
    preempted.calls.reads.filter((call) => call.functionName === "get_ruling").at(-1)?.args,
    ["dsp_rc-000101"],
    "v1 rulings are read by dispute id",
  );

  const ours = fakeClient({ policy: V1_MISSING, ruling: v1Ruling, v1InputsHash: INPUTS });
  const accepted = await forumOn("testnet-bradbury", ours.client).poll(pollV2);
  assert.equal(accepted.status, "DECIDED");
  assert.equal(accepted.ruling?.refundBps, 0);
});

test("the contract generation is detected from positive evidence; a failed read is not a verdict", async () => {
  // get_policy fails for a transport reason and so does the v1 probe: unknown, retried later.
  const flaky = fakeClient({ policy: new Error("socket closed"), probeFails: true });
  const forum = forumOn("testnet-bradbury", flaky.client);
  assert.equal(await forum.contractVersion(CONTRACT), null);
  const outcome = await forum.poll(pollV2);
  assert.equal(outcome.status, "PENDING", "unknown generation is a wait, never a failure");

  assert.equal(await forumOn("testnet-bradbury", fakeClient().client).contractVersion(CONTRACT), 2);
  assert.equal(await forumOn("testnet-bradbury", fakeClient({ policy: V1_MISSING }).client).contractVersion(CONTRACT), 1);
});

test("a v2 adjudication with no recorded submitter cannot be located, and says why", async () => {
  const outcome = await forumOn("testnet-bradbury", fakeClient().client).poll({ ...pollV2, submitter: null });
  assert.equal(outcome.status, "FAILED");
  assert.match(outcome.failureReason ?? "", /submitter/);
});

test("when the finality window has elapsed off Studio, the forum submits finalization itself", async () => {
  const lifecycle = {
    storedStatus: "Accepted",
    projectedStatus: "Finalized",
    resolutionAction: "Finalize",
    decisionId: "7",
    decisionActive: true,
  };
  const network = fakeClient({ lifecycle });
  const forum = forumOn("testnet-bradbury", network.client);
  const outcome = await forum.poll(pollV2);
  assert.equal(outcome.status, "DECIDED", "still not final until the network says FINALIZED");
  assert.equal(outcome.finalizationTx, "0xfinalize");
  await forum.poll(pollV2);
  assert.deepEqual(network.calls.finalizations, [TX], "submitted once, not on every poll");

  // Studio finalizes on its own.
  const studio = fakeClient({ lifecycle });
  await forumOn("studio-next", studio.client).poll(pollV2);
  assert.deepEqual(studio.calls.finalizations, []);

  // And an operator can turn it off.
  process.env.RECOURSE_AUTO_FINALIZE = "0";
  try {
    const off = fakeClient({ lifecycle });
    await forumOn("testnet-bradbury", off.client).poll(pollV2);
    assert.deepEqual(off.calls.finalizations, []);
  } finally {
    delete process.env.RECOURSE_AUTO_FINALIZE;
  }
});

test("an appeal asks the network first, then pays exactly the quoted charge", async () => {
  const refused = fakeClient({ canAppeal: false });
  const no = await forumOn("testnet-bradbury", refused.client).appeal({ disputeId: "d", transactionHash: TX });
  assert.equal(no.status, "REFUSED");
  assert.deepEqual(refused.calls.appeals, [], "nothing is paid for an appeal the network will not take");

  const network = fakeClient({
    charge: 2_500_000_000_000_000_000n,
    receipt: { statusName: "ACCEPTED", txExecutionResultName: "FINISHED_WITH_RETURN", numOfRounds: "1", appeal_failed: 0 },
  });
  const filed = await forumOn("testnet-bradbury", network.client).appeal({ disputeId: "d", transactionHash: TX });
  assert.equal(filed.status, "FILED");
  assert.equal(filed.chargeWei, "2500000000000000000");
  assert.deepEqual(network.calls.appeals, [{ txId: TX, value: 2_500_000_000_000_000_000n }]);
  assert.equal(filed.decisionId, "7");
  assert.equal(filed.rounds, 1, "signals are captured before the appeal, to compare later");
  assert.equal(filed.failedAppeals, 0);
  assert.equal(network.calls.funding.length, 0, "no sandbox top-ups off Studio");
});

test("on Studio, the appeal payer is topped up through the sandbox before paying", async () => {
  const studio = fakeClient({ charge: 10n ** 18n });
  const filed = await forumOn("studio-next", studio.client).appeal({ disputeId: "d", transactionHash: TX });
  assert.equal(filed.status, "FILED");
  assert.equal((studio.calls.funding[0] as { method: string }).method, "sim_fundAccount");
});

test("v2 ruling parsing: amounts must match decisions on this side of the wire too", () => {
  assert.equal(parseRuling(rulingJson())?.refundBps, 6_000);
  assert.equal(parseRuling(rulingJson({ refund_bps: 0 })), null, "a split that refunds nothing");
  assert.equal(parseRuling(rulingJson({ refund_bps: 10_000 })), null, "a split that refunds everything");
  assert.equal(parseRuling(rulingJson({ refund_bps: 60.5 })), null);
  assert.equal(parseRuling(rulingJson({ recommended_settlement: "REFUND" })), null);
  assert.equal(
    parseRuling(rulingJson({ decision: "BUYER_WINS", recommended_settlement: "REFUND", refund_bps: 9_000 })),
    null,
    "buyer wins means the whole escrow",
  );
  assert.equal(parseRuling(JSON.stringify({ decision: "SPLIT", material_breach: true, recommended_settlement: "SPLIT", reasoning_summary: "x" })), null, "v1 cannot split");
  assert.equal(parseRuling("[]"), null);
  assert.equal(rulingBindingProblem(parseRuling(rulingJson())!, { inputsHash: INPUTS.toUpperCase().replace("0X", "0x"), submitter: SIGNER }), null);
});

/* --------------------------------------------------------- runner pinning */

test("every known runner pin is canonical, and the contract pins the newest", () => {
  for (const runner of KNOWN_PY_GENLAYER_RUNNERS) assert.equal(checkRunnerPin(runner.pin), null, runner.pin);
  const declared = runnerPinsInHeader(
    `# v0.3.0\n# { "Depends": "${KNOWN_PY_GENLAYER_RUNNERS[0].pin}" }\nimport genlayer as gl\n`,
  );
  assert.deepEqual(declared, [KNOWN_PY_GENLAYER_RUNNERS[0].pin]);
});

test("runner negotiation: keep a pin that loads, fall back on a missing runner, stop when unsure", async () => {
  const [rc9, rc7] = KNOWN_PY_GENLAYER_RUNNERS;
  const source = `# v0.3.0\n# { "Depends": "${rc9.pin}" }\nimport genlayer as gl\nX = "${rc9.pin}"\n`;

  const loads = await negotiateRunnerPin(source, async () => ({ status: "ok" }));
  assert.equal(loads.pin, rc9.pin);
  assert.equal(loads.code, source);

  // A network still on rc7: the rc9 runner is missing, rc7's loads.
  const probed: string[] = [];
  const older = await negotiateRunnerPin(source, async (code) => {
    const pin = runnerPinsInHeader(code)[0];
    probed.push(pin);
    return pin === rc7.pin ? { status: "ok" } : { status: "runner-missing", detail: "invalid_contract runner malformed" };
  });
  assert.equal(older.pin, rc7.pin);
  assert.deepEqual(probed, [rc9.pin, rc7.pin], "never the superseded rc1/rc2 runner");
  assert.ok(older.code.includes(`"Depends": "${rc7.pin}"`));
  assert.ok(older.code.includes(`X = "${rc9.pin}"`), "only the header changes");

  const unsure = await negotiateRunnerPin(source, async () => ({ status: "inconclusive", detail: "rate limited" }));
  assert.equal(unsure.pin, rc9.pin, "an inconclusive probe is not evidence against the pin");
  assert.equal(unsure.attempts.length, 1);

  const none = await negotiateRunnerPin(source, async () => ({ status: "runner-missing", detail: "malformed" }));
  assert.equal(none.pin, null);

  assert.equal(withRunnerPin(source, rc7.pin).split("\n")[1], `# { "Depends": "${rc7.pin}" }`);
});
