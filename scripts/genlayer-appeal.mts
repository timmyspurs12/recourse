#!/usr/bin/env tsx
/**
 * One real appeal, through the protocol's own GenLayer adapter.
 *
 *   npm run genlayer:appeal
 *   npm run genlayer:appeal -- --graduated
 *   npm run genlayer:appeal -- --network testnet-bradbury --key 0x...
 *
 * It submits an adjudication, waits for GenLayer to ACCEPT it (a provisional
 * ruling), appeals that ruling as the losing side, and follows the same
 * transaction until it is FINALIZED. It uses `GenLayerForum` — the exact code
 * the running protocol uses — so what it proves is what the product does.
 *
 * Every line it prints comes from the network. Copy the summary at the end into
 * the milestone notes: contract, transaction, appeal charge, before and after.
 *
 * Timing matters. Studio's finality window is short (tens of seconds), so the
 * script polls every two seconds and appeals the moment a provisional ruling is
 * readable. If the window closes first, it says so and exits without appealing.
 */
import { readFileSync } from "node:fs";
import { GenLayerForum } from "../integrations/genlayer/forum";
import { loadGenLayerConfig } from "../integrations/genlayer/config";
import { documentHash, type Json } from "../domain/shared/canonical";
import { formatGen } from "../domain/shared/money";
import { refundBpsOf, type Ruling } from "../domain/model";
import type { AdjudicationOutcome, AdjudicationPayload } from "../domain/ports";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : undefined;
}

const overrides: Record<string, string | undefined> = { ...process.env };
if (flag("network")) overrides.GENLAYER_NETWORK = flag("network");
if (flag("key")) overrides.GENLAYER_PRIVATE_KEY = flag("key");
if (flag("address")) overrides.GENLAYER_CONTRACT_ADDRESS = flag("address");
const graduated = process.argv.includes("--graduated");

const config = loadGenLayerConfig(overrides);
if (!config.contractAddress) {
  try {
    const local = JSON.parse(readFileSync(config.deploymentFile, "utf-8")) as {
      deployments?: Record<string, { address?: string }>;
    };
    const recorded = local.deployments?.[config.networkKey]?.address;
    if (recorded) overrides.GENLAYER_CONTRACT_ADDRESS = recorded;
  } catch {
    // fall through to the error below
  }
}
const resolved = loadGenLayerConfig(overrides);
if (!resolved.contractAddress) {
  console.error(`No RecourseAdjudicator address for ${resolved.networkLabel}. Deploy one first: npm run genlayer:deploy`);
  process.exit(1);
}

const forum = new GenLayerForum(resolved);
const disputeId = `dsp_appeal_${Date.now()}`;

/*
 * A deliberately contestable case: a real shortfall on a counted term, with a
 * merchant statement that argues it was immaterial. Validators may well uphold
 * the first ruling — an upheld appeal is still the mechanism working.
 */
const payload: AdjudicationPayload = {
  agreementHash: `0x${"a1".repeat(32)}`,
  evidenceHash: `0x${"b2".repeat(32)}`,
  contestedTerms: [
    { id: "minimum_sources", label: "Minimum sources", operator: "GTE", expected: "5", mandatory: true },
  ],
  deterministicFindings: [
    { termId: "minimum_sources", expression: "3 < 5", result: "BREACH" },
    { termId: "geography", expression: "Lagos = Lagos", result: "PASS" },
    { termId: "required_sections", expression: "4 = 4", result: "PASS" },
  ],
  merchantStatement:
    "Three strong, independent sources cover the Lagos market. Two more would not have changed the conclusions.",
  buyerClaim:
    "I required five independent sources to size a market entry. Three arrived, so the sizing rests on less evidence than I paid for.",
  remedyMode: graduated ? "GRADUATED" : "ALL_OR_NOTHING",
};
const inputsHash = documentHash(payload as unknown as Json);

const award = (ruling: Ruling | null) =>
  ruling
    ? `${ruling.decision}${ruling.decision === "SPLIT" ? ` ${refundBpsOf(ruling) / 100}%` : ""} — ${ruling.reasoningSummary}`
    : "none";

console.log(`network:   ${resolved.networkLabel} (chain ${resolved.chainId})`);
console.log(`contract:  ${resolved.contractAddress}`);
console.log(`dispute:   ${disputeId}`);
console.log(`remedy:    ${payload.remedyMode}`);
for (const warning of resolved.warnings) console.log(`warning:   ${warning}`);

const submitted = await forum.submit({
  disputeId,
  orderId: "RC-APPEAL",
  question: "Is the shortfall a material breach of the mandatory terms in contention?",
  payload,
});
if (submitted.status !== "SUBMITTED" || !submitted.transactionHash) {
  console.error(`\nSubmission failed: ${submitted.failureReason}`);
  process.exit(1);
}
console.log(`adjudicate tx: ${submitted.transactionHash}`);
console.log(`submitter:     ${submitted.submitter}`);
if (submitted.fees) {
  console.log(`deposit:       ${formatGen(submitted.fees.depositWei) ?? `${submitted.fees.depositWei} wei`}`);
}

const pollInput = {
  disputeId,
  transactionHash: submitted.transactionHash,
  submitter: submitted.submitter ?? null,
  inputsHash,
  contractVersion: null as number | null,
};

async function follow(until: (outcome: AdjudicationOutcome) => boolean, deadlineMs: number) {
  let last = "";
  let outcome: AdjudicationOutcome | null = null;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    outcome = await forum.poll(pollInput);
    pollInput.contractVersion = outcome.contractVersion ?? pollInput.contractVersion;
    const line =
      `  ${outcome.status.padEnd(9)} ${outcome.networkStatus ?? ""}` +
      (typeof outcome.rounds === "number" ? ` · rounds ${outcome.rounds}` : "") +
      (typeof outcome.failedAppeals === "number" ? ` · failed appeals ${outcome.failedAppeals}` : "") +
      (outcome.appealInFlight ? " · appeal in flight" : "") +
      (outcome.lifecycle?.resolutionAction ? ` · next action ${outcome.lifecycle.resolutionAction}` : "");
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (until(outcome)) return outcome;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return outcome;
}

console.log("\nwaiting for a provisional ruling…");
const decided = await follow((o) => ["DECIDED", "FINALIZED", "FAILED"].includes(o.status), 300_000);
if (!decided || decided.status === "FAILED") {
  console.error(`\nThe adjudication did not reach a ruling: ${decided?.failureReason ?? "timed out"}`);
  process.exit(1);
}
if (decided.status === "FINALIZED") {
  console.log("\nThe finality window closed before a provisional ruling was observed; there is nothing left to appeal.");
  console.log(`final ruling: ${award(decided.ruling)}`);
  process.exit(2);
}
console.log(`\nprovisional ruling: ${award(decided.ruling)}`);
if (decided.lifecycle?.decisionId) console.log(`decision id:        ${decided.lifecycle.decisionId}`);

const appellant = decided.ruling?.decision === "MERCHANT_WINS" ? "buyer" : "merchant";
console.log(`\nappealing as the ${appellant}…`);
const appeal = await forum.appeal({ disputeId, transactionHash: submitted.transactionHash });
console.log(`appeal:    ${appeal.status}${appeal.reason ? ` — ${appeal.reason}` : ""}`);
if (appeal.chargeWei) console.log(`charge:    ${formatGen(appeal.chargeWei) ?? `${appeal.chargeWei} wei`} (bond + funding, quoted by the network)`);
if (appeal.paidBy) console.log(`paid by:   ${appeal.paidBy}`);
if (appeal.status !== "FILED") process.exit(1);

console.log("\nfollowing the appeal round to finality…");
const final = await follow((o) => ["FINALIZED", "FAILED"].includes(o.status), 600_000);
if (!final || final.status !== "FINALIZED") {
  console.error(`\nNot finalized yet: ${final?.failureReason ?? "timed out"} — re-run the poll later with the tx above.`);
  process.exit(1);
}

const changed =
  decided.ruling && final.ruling
    ? decided.ruling.decision !== final.ruling.decision || refundBpsOf(decided.ruling) !== refundBpsOf(final.ruling)
    : false;

console.log("\n──────── summary (paste into the milestone notes) ────────");
console.log(`network:            ${resolved.networkLabel} (chain ${resolved.chainId})`);
console.log(`contract:           ${resolved.contractAddress}`);
console.log(`adjudicate tx:      ${submitted.transactionHash}`);
console.log(`provisional ruling: ${award(decided.ruling)}`);
console.log(`appeal charge:      ${appeal.chargeWei ? formatGen(appeal.chargeWei) ?? appeal.chargeWei : "not reported"}`);
console.log(`final ruling:       ${award(final.ruling)}`);
console.log(`appeal outcome:     ${changed ? "REVISED" : "UPHELD"}`);
console.log(`final status:       ${final.networkStatus}`);
if (resolved.explorer) console.log(`explorer:           ${resolved.explorer}${resolved.contractAddress}`);
