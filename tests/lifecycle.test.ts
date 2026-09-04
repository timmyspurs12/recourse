import { strict as assert } from "node:assert";
import test from "node:test";
import { buyBrief, finalize, goodDelivery, harness, ScriptedForum, shortDelivery } from "./harness";

/**
 * THE CRITICAL PATH.
 *
 * If only one test in this repository ever runs, it should be this one:
 * purchase -> agreement -> escrow -> delivery -> breach -> dispute ->
 * adjudication -> buyer wins -> refund.
 */
test("critical path: a breached promise ends in a refund", async () => {
  const { protocol, forum } = harness();
  const orderId = await buyBrief(protocol);

  // Promise: the agreement is hashed and locked before any money is at risk.
  let dossier = await protocol.dossier(orderId);
  assert.equal(dossier.order.state, "ESCROWED");
  assert.ok(dossier.agreement.lockedAt, "agreement must be locked at payment");
  assert.match(dossier.agreement.hash, /^0x[0-9a-f]{64}$/);
  assert.equal(dossier.payment?.escrow, "HELD");

  // Proof: the merchant delivers two of the five required sources.
  dossier = await protocol.submitDelivery(shortDelivery(orderId));
  assert.equal(dossier.order.state, "VERIFICATION_PENDING");
  assert.deepEqual(dossier.verification?.breachedTermIds, ["minimum_sources"]);

  // The breach is arithmetic, and it is recorded as arithmetic.
  const check = dossier.verification?.checks.find((c) => c.termId === "minimum_sources");
  assert.equal(check?.expression, "2 < 5");
  assert.equal(check?.result, "BREACH");

  // Judgment: only the contested terms travel to the forum.
  dossier = await protocol.openDispute({
    orderId,
    claim: "Five independent sources were required and two were supplied.",
  });
  assert.equal(dossier.order.state, "DISPUTED");
  const disputeId = dossier.dispute!.id;

  dossier = await protocol.submitAdjudication(disputeId);
  assert.equal(dossier.order.state, "ADJUDICATING");
  assert.equal((forum as ScriptedForum).requests.length, 1);

  dossier = await finalize(protocol, disputeId);
  assert.equal(dossier.order.state, "BUYER_WON");
  assert.equal(dossier.adjudication?.ruling?.decision, "BUYER_WINS");

  // Settlement: the money goes back.
  dossier = await protocol.settle(orderId);
  assert.equal(dossier.order.state, "REFUNDED");
  assert.equal(dossier.settlement?.outcome, "REFUNDED");
  assert.equal(dossier.settlement?.to, "shopper.agent");
  assert.equal(dossier.payment?.escrow, "REFUNDED");

  // The ledger tells the whole story, in order.
  const types = dossier.events.map((event) => event.type);
  assert.deepEqual(types, [
    "ORDER_CREATED",
    "AGREEMENT_LOCKED",
    "PAYMENT_ESCROWED",
    "DELIVERY_POSTED",
    "VERIFICATION_STARTED",
    "BREACH_DETECTED",
    "DISPUTE_OPENED",
    "ADJUDICATION_SUBMITTED",
    "RULING_FINALIZED",
    "REFUND_EXECUTED",
  ]);
});

test("happy path: a kept promise pays the merchant without adjudication", async () => {
  const { protocol, forum } = harness();
  const orderId = await buyBrief(protocol);

  let dossier = await protocol.submitDelivery(goodDelivery(orderId));
  assert.equal(dossier.order.state, "FULFILLED");
  assert.equal(dossier.verification?.outcome, "SATISFIED");

  dossier = await protocol.settle(orderId);
  assert.equal(dossier.order.state, "RELEASED");
  assert.equal(dossier.settlement?.outcome, "RELEASED");
  assert.equal(dossier.settlement?.to, "merchant.agent");

  // The forum was never called: arithmetic settled every mandatory term.
  assert.equal((forum as ScriptedForum).requests.length, 0);
  assert.equal(dossier.adjudication, null);
});

test("neutrality: the merchant is paid when adjudication finds no material breach", async () => {
  const forum = new ScriptedForum({ decision: "MERCHANT_WINS" });
  const { protocol } = harness({ forum });
  const orderId = await buyBrief(protocol);

  await protocol.submitDelivery(shortDelivery(orderId));
  const disputed = await protocol.openDispute({
    orderId,
    claim: "I believe the brief is inadequate for my purposes.",
  });
  await protocol.submitAdjudication(disputed.dispute!.id);
  let dossier = await finalize(protocol, disputed.dispute!.id);
  assert.equal(dossier.order.state, "MERCHANT_WON");

  dossier = await protocol.settle(orderId);
  assert.equal(dossier.settlement?.outcome, "RELEASED");
  assert.equal(dossier.settlement?.to, "merchant.agent");
});

test("only semantic questions are eligible for the forum", async () => {
  const { protocol } = harness();
  const orderId = await buyBrief(protocol);
  const dossier = await protocol.submitDelivery(shortDelivery(orderId));

  // Four deterministic checks, one semantic question. The count matters:
  // arithmetic must never be delegated.
  assert.equal(dossier.verification?.checks.length, 4);
  assert.equal(dossier.verification?.semanticQuestions.length, 1);
  assert.equal(dossier.verification?.semanticQuestions[0]?.termId, "material_accuracy");
});
