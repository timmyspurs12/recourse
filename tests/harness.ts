import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecourseProtocol } from "../domain/orders/service";
import { JsonStore } from "../infra/store/json-store";
import { SimulatedRail } from "../integrations/simulated/rail";
import type {
  AdjudicationForum,
  AdjudicationOutcome,
  AdjudicationRequest,
} from "../domain/ports";
import type { Decision } from "../domain/model";
import { BRIEF, BRIEF_TERMS, GOOD_DELIVERY, SHORT_DELIVERY } from "../server/scenario";

/**
 * Test harness.
 *
 * Every test gets a fresh store in a temp directory and a scripted forum, so
 * the protocol is exercised for real while the network is not. The GenLayer
 * client itself is covered separately by tests/genlayer.live.test.ts.
 */

/** A forum whose ruling and timing the test controls exactly. */
export class ScriptedForum implements AdjudicationForum {
  readonly id = "GENLAYER";
  readonly available: boolean;
  readonly description = "Scripted adjudication forum (test double)";
  readonly requests: AdjudicationRequest[] = [];

  private decision: Decision;
  private pendingPolls: number;
  private polls = 0;
  private failSubmit: string | null;
  /** Set to return a ruling that contradicts itself. */
  private corrupt: boolean;

  constructor(options?: {
    available?: boolean;
    decision?: Decision;
    pendingPolls?: number;
    failSubmit?: string | null;
    corrupt?: boolean;
  }) {
    this.available = options?.available ?? true;
    this.decision = options?.decision ?? "BUYER_WINS";
    this.pendingPolls = options?.pendingPolls ?? 0;
    this.failSubmit = options?.failSubmit ?? null;
    this.corrupt = options?.corrupt ?? false;
  }

  async submit(request: AdjudicationRequest): Promise<AdjudicationOutcome> {
    this.requests.push(request);
    if (this.failSubmit) {
      return {
        status: "FAILED",
        network: "TEST",
        contractAddress: "0xtest",
        transactionHash: null,
        networkStatus: null,
        votes: null,
        ruling: null,
        failureReason: this.failSubmit,
        finalizedAt: null,
      };
    }
    return {
      status: "SUBMITTED",
      network: "TEST",
      contractAddress: "0xtest",
      transactionHash: `0xtx_${request.disputeId}`,
      networkStatus: "SUBMITTED",
      votes: null,
      ruling: null,
      failureReason: null,
      finalizedAt: null,
    };
  }

  async poll(): Promise<AdjudicationOutcome> {
    this.polls += 1;
    if (this.polls <= this.pendingPolls) {
      return {
        status: "PENDING",
        network: "TEST",
        contractAddress: "0xtest",
        transactionHash: "0xtx",
        networkStatus: "PROPOSING",
        votes: null,
        ruling: null,
        failureReason: null,
        finalizedAt: null,
      };
    }

    const buyerWins = this.decision === "BUYER_WINS";
    return {
      status: "FINALIZED",
      network: "TEST",
      contractAddress: "0xtest",
      transactionHash: "0xtx",
      networkStatus: "FINALIZED",
      votes: { "0xa": "agree", "0xb": "agree", "0xc": "disagree" },
      ruling: {
        decision: this.decision,
        materialBreach: this.corrupt ? !buyerWins : buyerWins,
        violatedTerms: buyerWins ? ["minimum_sources"] : [],
        satisfiedTerms: buyerWins ? [] : ["minimum_sources"],
        recommendedSettlement: buyerWins ? "REFUND" : "RELEASE",
        reasoningSummary: "Scripted ruling for tests.",
      },
      failureReason: null,
      finalizedAt: new Date().toISOString(),
    };
  }
}

export function harness(options?: { forum?: AdjudicationForum }) {
  const dir = mkdtempSync(join(tmpdir(), "recourse-test-"));
  const store = new JsonStore(join(dir, "ledger.json"));
  const forum = options?.forum ?? new ScriptedForum();
  const protocol = new RecourseProtocol({ store, rail: new SimulatedRail(), forum });
  return { protocol, store, forum };
}

export async function buyBrief(protocol: RecourseProtocol) {
  const dossier = await protocol.createProtectedPurchase({
    buyer: { handle: "shopper.agent" },
    merchant: { handle: "merchant.agent" },
    resource: { name: BRIEF.name, type: BRIEF.type },
    amount: BRIEF.price,
    terms: BRIEF_TERMS,
  });
  return dossier.order.id;
}

export const goodDelivery = (orderId: string) => ({
  orderId,
  statement: GOOD_DELIVERY.statement,
  artifactUrl: GOOD_DELIVERY.artifactUrl,
  artifactHash: GOOD_DELIVERY.artifactHash,
  assertions: { ...GOOD_DELIVERY.assertions },
  evidence: GOOD_DELIVERY.evidence.map((item) => ({ ...item })),
});

export const shortDelivery = (orderId: string) => ({
  orderId,
  statement: SHORT_DELIVERY.statement,
  artifactUrl: SHORT_DELIVERY.artifactUrl,
  artifactHash: SHORT_DELIVERY.artifactHash,
  assertions: { ...SHORT_DELIVERY.assertions },
  evidence: SHORT_DELIVERY.evidence.map((item) => ({ ...item })),
});

/** Drives a submitted adjudication to finality. */
export async function finalize(protocol: RecourseProtocol, disputeId: string, attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    const dossier = await protocol.pollAdjudication(disputeId);
    if (dossier.adjudication?.status === "FINALIZED" || dossier.adjudication?.status === "FAILED") {
      return dossier;
    }
  }
  return protocol.dossier((await protocol.getAdjudication(disputeId))!.orderId);
}
