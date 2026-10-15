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
  AppealSubmission,
} from "../domain/ports";
import type { Decision, Ruling } from "../domain/model";
import { BRIEF, BRIEF_TERMS, GOOD_DELIVERY, SHORT_DELIVERY } from "../server/scenario";

/**
 * Test harness.
 *
 * Every test gets a fresh store in a temp directory and a scripted forum, so
 * the protocol is exercised for real while the network is not. The GenLayer
 * client itself is covered separately by tests/genlayer.live.test.ts.
 */

/**
 * A forum whose ruling and timing the test controls exactly.
 *
 * Its polls walk the same phases a GenLayer transaction does:
 *
 *   PENDING ×pendingPolls → DECIDED ×provisionalPolls → FINALIZED
 *
 * and an appeal inserts, after filing:
 *
 *   DECIDED ×lagPolls (the network has not registered the appeal yet)
 *   → APPEALED ×appealPolls → (revision applied) → DECIDED … → FINALIZED
 *
 * With `appealPolls: 0` the whole appeal round happens between two polls, and
 * the only evidence it happened is the round counter — which is exactly the
 * case the protocol has to get right.
 */
export interface ScriptedAppeal {
  /** The ruling after the appeal; omit for an appeal that fails (upheld). */
  revisedDecision?: Decision;
  revisedRefundBps?: number;
  lagPolls?: number;
  appealPolls?: number;
  refuse?: boolean;
  fail?: string;
}

export function scriptedRuling(decision: Decision, refundBps?: number, corrupt = false): Ruling {
  const material = decision !== "MERCHANT_WINS";
  return {
    decision,
    materialBreach: corrupt ? !material : material,
    violatedTerms: material ? ["minimum_sources"] : [],
    satisfiedTerms: material ? [] : ["minimum_sources"],
    recommendedSettlement:
      decision === "BUYER_WINS" ? "REFUND" : decision === "MERCHANT_WINS" ? "RELEASE" : "SPLIT",
    refundBps: decision === "BUYER_WINS" ? 10_000 : decision === "MERCHANT_WINS" ? 0 : (refundBps ?? 6_000),
    reasoningSummary: "Scripted ruling for tests.",
  };
}

export class ScriptedForum implements AdjudicationForum {
  readonly id = "GENLAYER";
  readonly available: boolean;
  readonly description = "Scripted adjudication forum (test double)";
  readonly requests: AdjudicationRequest[] = [];
  readonly appealRequests: Array<{ disputeId: string; transactionHash: string }> = [];
  readonly pollInputs: Array<Record<string, unknown>> = [];

  private decision: Decision;
  private refundBps: number | undefined;
  private readonly pendingPolls: number;
  private readonly provisionalPolls: number;
  private polls = 0;
  private provisionalSeen = 0;
  private lagRemaining = 0;
  private appealRemaining = 0;
  private revisionDue = false;
  private rounds = 1;
  private failedAppeals = 0;
  private readonly failSubmit: string | null;
  /** Set to return a ruling that contradicts itself. */
  private readonly corrupt: boolean;
  private readonly appealScript: ScriptedAppeal;

  constructor(options?: {
    available?: boolean;
    decision?: Decision;
    refundBps?: number;
    pendingPolls?: number;
    provisionalPolls?: number;
    failSubmit?: string | null;
    corrupt?: boolean;
    appeal?: ScriptedAppeal;
  }) {
    this.available = options?.available ?? true;
    this.decision = options?.decision ?? "BUYER_WINS";
    this.refundBps = options?.refundBps;
    this.pendingPolls = options?.pendingPolls ?? 0;
    this.provisionalPolls = options?.provisionalPolls ?? 0;
    this.failSubmit = options?.failSubmit ?? null;
    this.corrupt = options?.corrupt ?? false;
    this.appealScript = options?.appeal ?? {};
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
      submitter: "0xsubmitter",
      contractVersion: 2,
    };
  }

  private outcome(status: AdjudicationOutcome["status"], networkStatus: string): AdjudicationOutcome {
    const decided = status === "DECIDED" || status === "FINALIZED";
    return {
      status,
      network: "TEST",
      contractAddress: "0xtest",
      transactionHash: "0xtx",
      networkStatus,
      votes: decided ? { "0xa": "agree", "0xb": "agree", "0xc": "disagree" } : null,
      ruling: decided ? scriptedRuling(this.decision, this.refundBps, this.corrupt) : null,
      failureReason: null,
      finalizedAt: status === "FINALIZED" ? new Date().toISOString() : null,
      rounds: this.rounds,
      failedAppeals: this.failedAppeals,
      appealInFlight: status === "APPEALED",
      lifecycle: {
        storedStatus: networkStatus,
        projectedStatus: networkStatus,
        resolutionAction: status === "DECIDED" ? "NoOp" : null,
        decisionId: decided ? String(this.rounds) : null,
        decisionActive: status === "DECIDED",
      },
      contractVersion: 2,
    };
  }

  private applyRevision(): void {
    this.revisionDue = false;
    if (this.appealScript.revisedDecision) {
      // A successful appeal: an appeal round, then a recomputation round.
      this.rounds += 2;
      this.decision = this.appealScript.revisedDecision;
      this.refundBps = this.appealScript.revisedRefundBps;
    } else {
      this.rounds += 1;
      this.failedAppeals += 1;
    }
    // The finality window starts again for the (possibly new) decision.
    this.provisionalSeen = 0;
  }

  async poll(input?: Record<string, unknown>): Promise<AdjudicationOutcome> {
    if (input) this.pollInputs.push(input);
    this.polls += 1;
    if (this.polls <= this.pendingPolls) return this.outcome("PENDING", "PROPOSING");

    if (this.lagRemaining > 0) {
      this.lagRemaining -= 1;
      return this.outcome("DECIDED", "ACCEPTED");
    }
    if (this.appealRemaining > 0) {
      this.appealRemaining -= 1;
      const outcome = this.outcome("APPEALED", "APPEAL_COMMITTING");
      if (this.appealRemaining === 0) this.applyRevision();
      return outcome;
    }
    if (this.revisionDue) this.applyRevision();

    if (this.provisionalSeen < this.provisionalPolls) {
      this.provisionalSeen += 1;
      return this.outcome("DECIDED", "ACCEPTED");
    }
    return this.outcome("FINALIZED", "FINALIZED");
  }

  async appeal(input: { disputeId: string; transactionHash: string }): Promise<AppealSubmission> {
    this.appealRequests.push(input);
    const base = {
      chargeWei: null,
      decisionId: null,
      paidBy: null,
      rounds: null,
      failedAppeals: null,
      networkStatus: null,
    };
    if (this.appealScript.refuse) {
      return { ...base, status: "REFUSED", reason: "The finality window has closed." };
    }
    if (this.appealScript.fail) {
      return { ...base, status: "FAILED", reason: this.appealScript.fail };
    }
    const filed: AppealSubmission = {
      status: "FILED",
      chargeWei: "2500000000000000000",
      decisionId: String(this.rounds),
      paidBy: "0xprotocol",
      rounds: this.rounds,
      failedAppeals: this.failedAppeals,
      networkStatus: "ACCEPTED",
      reason: null,
    };
    this.lagRemaining = this.appealScript.lagPolls ?? 0;
    this.appealRemaining = this.appealScript.appealPolls ?? 1;
    // An instant round: nothing to see in flight, only the counters move.
    if (this.appealRemaining === 0) this.revisionDue = true;
    return filed;
  }
}

export function harness(options?: { forum?: AdjudicationForum }) {
  const dir = mkdtempSync(join(tmpdir(), "recourse-test-"));
  const store = new JsonStore(join(dir, "ledger.json"));
  const forum = options?.forum ?? new ScriptedForum();
  const protocol = new RecourseProtocol({ store, rail: new SimulatedRail(), forum });
  return { protocol, store, forum };
}

export async function buyBrief(
  protocol: RecourseProtocol,
  options?: { remedy?: "full_refund" | "graduated_refund"; amount?: string },
) {
  const dossier = await protocol.createProtectedPurchase({
    buyer: { handle: "shopper.agent" },
    merchant: { handle: "merchant.agent" },
    resource: { name: BRIEF.name, type: BRIEF.type },
    amount: options?.amount ?? BRIEF.price,
    terms: BRIEF_TERMS,
    remedy: options?.remedy,
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
