import { createAccount, createClient } from "genlayer-js";
import type { Hash } from "genlayer-js/types";
import type {
  AdjudicationForum,
  AdjudicationOutcome,
  AdjudicationRequest,
} from "../../domain/ports";
import type { Ruling } from "../../domain/model";
import { documentHash, type Json } from "../../domain/shared/canonical";
import { loadGenLayerConfig, type GenLayerConfig } from "./config";

/**
 * GenLayer adjudication forum.
 *
 * This is a real client against a real network. Every field it reports —
 * transaction hash, finality status, validator votes — comes back from the
 * chain. When something is unknown it is reported as null and the UI says
 * "not yet available"; nothing here is ever synthesised to look complete.
 */

type Client = ReturnType<typeof createClient>;

interface LeaderReceipt {
  execution_result?: string;
  genvm_result?: { stdout?: string; stderr?: string };
}

/**
 * Transaction receipts, across two different shapes.
 *
 * Studionet returns snake_case with `consensus_data.votes` and
 * `data.contract_address`. The public testnets return camelCase with the
 * validator set split across `lastRound.roundValidators` and
 * `lastRound.validatorVotes`, and the deployed address in `recipient`.
 *
 * Reading only one shape means the other silently loses its validator data —
 * which is the most load-bearing evidence this product publishes. So both are
 * normalised into one structure before anything else looks at them.
 */
interface Receipt {
  status?: number;
  status_name?: string;
  statusName?: string;
  recipient?: string;
  numOfRounds?: number | string;
  txExecutionResultName?: string;
  data?: { contract_address?: string };
  consensus_data?: {
    votes?: Record<string, string>;
    leader_receipt?: LeaderReceipt[];
  };
  lastRound?: {
    round?: number | string;
    roundValidators?: string[];
    validatorVotes?: number[];
  };
}

/**
 * Vote codes as returned by the testnet consensus contract.
 *
 * 0 and 1 are confirmed against live transactions (all-1 rounds report
 * resultName AGREE). The remaining codes follow the documented enum ordering
 * but have not been observed here, so anything unrecognised is surfaced as its
 * raw code rather than given a label it might not deserve.
 */
const VOTE_CODES: Record<number, string> = {
  0: "idle",
  1: "agree",
  2: "disagree",
  3: "timeout",
  4: "deterministic-violation",
};

function normalizeVotes(receipt: Receipt): Record<string, string> | null {
  if (receipt.consensus_data?.votes) return receipt.consensus_data.votes;

  const validators = receipt.lastRound?.roundValidators;
  const votes = receipt.lastRound?.validatorVotes;
  if (!validators?.length || !votes?.length) return null;

  const out: Record<string, string> = {};
  validators.forEach((validator, index) => {
    const code = Number(votes[index]);
    out[validator] = VOTE_CODES[code] ?? `code:${code}`;
  });
  return out;
}

/** The address a deployment produced, whichever shape reported it. */
export function contractAddressFrom(receipt: Receipt): string | null {
  return receipt.data?.contract_address ?? receipt.recipient ?? null;
}

function roundsFrom(receipt: Receipt): number | null {
  const rounds = receipt.numOfRounds ?? receipt.lastRound?.round;
  if (rounds === undefined || rounds === null) return null;
  const n = Number(rounds);
  // lastRound.round is zero-based; numOfRounds is a count.
  return Number.isFinite(n) ? (receipt.numOfRounds !== undefined ? n : n + 1) : null;
}

/** GenLayer transaction status codes we care about. */
const STATUS_NAMES: Record<number, string> = {
  0: "UNINITIALIZED",
  1: "PENDING",
  2: "PROPOSING",
  3: "COMMITTING",
  4: "REVEALING",
  5: "ACCEPTED",
  6: "UNDETERMINED",
  7: "FINALIZED",
  8: "CANCELED",
};

function statusName(receipt: Receipt): string {
  return (
    receipt.statusName ??
    receipt.status_name ??
    STATUS_NAMES[receipt.status ?? -1] ??
    `STATUS_${receipt.status}`
  );
}

function executionResult(receipt: Receipt): string | null {
  const studio = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
  if (studio) return studio;
  const testnet = receipt.txExecutionResultName;
  // Testnets phrase success as FINISHED_WITH_RETURN.
  if (!testnet) return null;
  return testnet.startsWith("FINISHED") ? "SUCCESS" : testnet;
}

/**
 * Parses and re-validates a ruling coming back from the network.
 *
 * Exported because it is a security boundary, not a formatting detail: a forum
 * that returned "buyer wins, pay the merchant" must never become actionable.
 */
export function parseRuling(raw: unknown): Ruling | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const decision = parsed.decision;
  const settlement = parsed.recommended_settlement;
  if (decision !== "BUYER_WINS" && decision !== "MERCHANT_WINS") return null;
  if (settlement !== "REFUND" && settlement !== "RELEASE") return null;

  // Re-assert the invariant on this side of the wire too. A forum that returned
  // "buyer wins, release the funds to the merchant" must not be actionable.
  const materialBreach = Boolean(parsed.material_breach);
  if (decision === "BUYER_WINS" && (!materialBreach || settlement !== "REFUND")) return null;
  if (decision === "MERCHANT_WINS" && (materialBreach || settlement !== "RELEASE")) return null;

  return {
    decision,
    materialBreach,
    violatedTerms: Array.isArray(parsed.violated_terms)
      ? (parsed.violated_terms as unknown[]).map(String)
      : [],
    satisfiedTerms: Array.isArray(parsed.satisfied_terms)
      ? (parsed.satisfied_terms as unknown[]).map(String)
      : [],
    recommendedSettlement: settlement,
    reasoningSummary: String(parsed.reasoning_summary ?? ""),
  };
}

export class GenLayerForum implements AdjudicationForum {
  readonly id = "GENLAYER";
  private readonly config: GenLayerConfig;
  private client: Client | null = null;

  constructor(config: GenLayerConfig = loadGenLayerConfig()) {
    this.config = config;
  }

  get available(): boolean {
    return Boolean(this.config.contractAddress);
  }

  get description(): string {
    return this.available
      ? `RecourseAdjudicator on ${this.config.networkLabel}`
      : "RecourseAdjudicator is not deployed for this environment";
  }

  get network(): string {
    return this.config.networkLabel;
  }

  get contractAddress(): string | null {
    return this.config.contractAddress;
  }

  private getClient(): Client {
    if (!this.client) {
      const account = this.config.privateKey
        ? createAccount(this.config.privateKey)
        : createAccount();
      this.client = createClient({ chain: this.config.chain, account });
    }
    return this.client;
  }

  private unavailable(reason: string): AdjudicationOutcome {
    return {
      status: "FAILED",
      network: this.config.networkLabel,
      contractAddress: this.config.contractAddress,
      transactionHash: null,
      networkStatus: null,
      votes: null,
      ruling: null,
      failureReason: reason,
      finalizedAt: null,
    };
  }

  async submit(request: AdjudicationRequest): Promise<AdjudicationOutcome> {
    if (!this.config.contractAddress) {
      return this.unavailable(
        "No RecourseAdjudicator contract address is configured. Run `npm run genlayer:deploy` and set GENLAYER_CONTRACT_ADDRESS.",
      );
    }

    const payload = {
      ...request.payload,
      inputsHash: documentHash(request.payload as unknown as Json),
    };

    try {
      const client = this.getClient();
      const transactionHash = await client.writeContract({
        address: this.config.contractAddress as `0x${string}`,
        functionName: "adjudicate",
        args: [request.disputeId, JSON.stringify(payload)],
        value: 0n,
      });

      return {
        status: "SUBMITTED",
        network: this.config.networkLabel,
        contractAddress: this.config.contractAddress,
        transactionHash,
        networkStatus: "SUBMITTED",
        votes: null,
        ruling: null,
        failureReason: null,
        finalizedAt: null,
      };
    } catch (error) {
      return this.unavailable(
        `GenLayer submission failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async poll(input: {
    disputeId: string;
    transactionHash: string;
  }): Promise<AdjudicationOutcome> {
    if (!this.config.contractAddress) {
      return this.unavailable("No RecourseAdjudicator contract address is configured.");
    }

    const client = this.getClient();
    let receipt: Receipt;
    try {
      receipt = (await client.getTransaction({
        hash: input.transactionHash as Hash,
      })) as Receipt;
    } catch (error) {
      return {
        status: "PENDING",
        network: this.config.networkLabel,
        contractAddress: this.config.contractAddress,
        transactionHash: input.transactionHash,
        networkStatus: null,
        votes: null,
        ruling: null,
        failureReason: `Receipt not yet retrievable: ${
          error instanceof Error ? error.message : String(error)
        }`,
        finalizedAt: null,
      };
    }

    const network = statusName(receipt);
    const votes = normalizeVotes(receipt);
    const execution = executionResult(receipt);

    const settled = network === "FINALIZED" || network === "ACCEPTED";

    if (!settled) {
      return {
        status: "PENDING",
        network: this.config.networkLabel,
        contractAddress: this.config.contractAddress,
        transactionHash: input.transactionHash,
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: null,
        finalizedAt: null,
      };
    }

    if (execution && execution !== "SUCCESS") {
      return {
        status: "FAILED",
        network: this.config.networkLabel,
        contractAddress: this.config.contractAddress,
        transactionHash: input.transactionHash,
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: `Contract execution returned ${execution}`,
        finalizedAt: null,
      };
    }

    // The authoritative ruling is contract state, not the transaction log.
    let raw: unknown;
    try {
      raw = await client.readContract({
        address: this.config.contractAddress as `0x${string}`,
        functionName: "get_ruling",
        args: [input.disputeId],
      });
    } catch (error) {
      return {
        status: "PENDING",
        network: this.config.networkLabel,
        contractAddress: this.config.contractAddress,
        transactionHash: input.transactionHash,
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: `Ruling not yet readable: ${
          error instanceof Error ? error.message : String(error)
        }`,
        finalizedAt: null,
      };
    }

    const ruling = parseRuling(raw);
    if (!ruling) {
      return {
        status: typeof raw === "string" && raw.trim() === "" ? "PENDING" : "FAILED",
        network: this.config.networkLabel,
        contractAddress: this.config.contractAddress,
        transactionHash: input.transactionHash,
        networkStatus: network,
        votes,
        ruling: null,
        failureReason:
          typeof raw === "string" && raw.trim() === ""
            ? null
            : "Adjudication returned a ruling the protocol cannot act on.",
        finalizedAt: null,
      };
    }

    return {
      status: "FINALIZED",
      network: this.config.networkLabel,
      contractAddress: this.config.contractAddress,
      transactionHash: input.transactionHash,
      networkStatus: network,
      votes,
      rounds: roundsFrom(receipt),
      ruling,
      failureReason: null,
      finalizedAt: new Date().toISOString(),
    };
  }
}

/**
 * Used when no contract is deployed. It refuses to rule rather than pretending
 * to — an unavailable forum is a legitimate protocol state, a fake one is not.
 */
export class UnavailableForum implements AdjudicationForum {
  readonly id = "GENLAYER";
  readonly available = false;
  readonly description =
    "No adjudication forum is configured for this environment. Deploy the RecourseAdjudicator to enable judgment.";

  private outcome(): AdjudicationOutcome {
    return {
      status: "FAILED",
      network: null,
      contractAddress: null,
      transactionHash: null,
      networkStatus: null,
      votes: null,
      ruling: null,
      failureReason: this.description,
      finalizedAt: null,
    };
  }

  async submit(): Promise<AdjudicationOutcome> {
    return this.outcome();
  }

  async poll(): Promise<AdjudicationOutcome> {
    return this.outcome();
  }
}
