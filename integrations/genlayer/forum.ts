import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { generatePrivateKey } from "viem/accounts";
import type { Hash } from "genlayer-js/types";
import type {
  AdjudicationForum,
  AdjudicationOutcome,
  AdjudicationRequest,
} from "../../domain/ports";
import type { Ruling } from "../../domain/model";
import { documentHash, type Json } from "../../domain/shared/canonical";
import { loadGenLayerConfig, type GenLayerConfig } from "./config";
import { createForumKit, extractFeeAccounting, quoteToDomain, type ForumKit } from "./fees";

/**
 * GenLayer adjudication forum, on Consensus v0.6.
 *
 * This is a real client against a real network. Every field it reports —
 * transaction hash, finality status, validator votes, fee deposit — comes back
 * from the chain or from a quote the chain priced. When something is unknown it
 * is reported as null and the UI says "not yet available"; nothing here is ever
 * synthesised to look complete.
 *
 * v0.6 changed three things this file had to follow, and one it had to refuse:
 *
 *  - **Fees.** Every write carries a `FeesDistribution` and its quoted value.
 *    The quote comes from the transaction kit over a measured profile plus live
 *    prices (see `fees.ts`), and a quote that does not match the network's live
 *    fee config is not signed unless an operator explicitly allows it.
 *  - **Success is two facts, not one.** `ACCEPTED`/`FINALIZED` says the network
 *    decided something; only `FINISHED_WITH_RETURN` says the contract ran.
 *    `isSuccessful` requires both, and that is what we use.
 *  - **Statuses and phases.** Receipts now carry a derived lifecycle
 *    (`pending` → `processing` → `decided` → `finalized`) and a queue position
 *    while a transaction waits. Both are surfaced verbatim.
 *  - **Refused:** nothing. A forum that cannot quote a fee cannot submit, so it
 *    reports FAILED with the reason and leaves escrow held rather than
 *    broadcasting a transaction the network would reject.
 */

type Client = ReturnType<typeof createClient>;

interface LeaderReceipt {
  execution_result?: string;
  genvm_result?: { stdout?: string; stderr?: string };
}

/**
 * Transaction receipts, across three shapes.
 *
 * Studionet (stable) returns snake_case with `consensus_data.votes` and
 * `data.contract_address`. The public testnets return camelCase with the
 * validator set split across `lastRound.roundValidators` and
 * `lastRound.validatorVotes`, and the deployed address in
 * `txDataDecoded.contractAddress`. Consensus v0.6 adds a derived `lifecycle`
 * and `queuePosition`.
 *
 * Reading only one shape means another silently loses its validator data or its
 * deposit — the most load-bearing evidence this product publishes. So all of
 * them are normalised into one structure before anything else looks at them.
 */
interface Receipt {
  status?: number | string;
  status_name?: string;
  statusName?: string;
  recipient?: string;
  txExecutionResult?: number;
  txExecutionResultName?: string;
  txId?: string;
  hash?: string;
  numOfRounds?: number | string;
  queuePosition?: number | string;
  lifecycle?: { state?: string; phase?: string; outcome?: string };
  data?: { contract_address?: string };
  txDataDecoded?: { contractAddress?: string };
  feeAccounting?: Record<string, unknown>;
  fee_accounting?: Record<string, unknown>;
  consensus_data?: {
    votes?: Record<string, string>;
    leader_receipt?: LeaderReceipt[];
  };
  lastRound?: {
    round?: number | string;
    roundValidators?: string[];
    validatorVotes?: number[];
    validatorVotesName?: string[];
  };
}

/**
 * Vote codes as returned by the consensus contract.
 *
 * 0 and 1 are confirmed against live transactions (all-1 rounds report
 * resultName AGREE). v0.6 also returns named votes in `validatorVotesName`,
 * which is preferred when present; anything unrecognised is surfaced as its raw
 * code rather than given a label it might not deserve.
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
  const named = receipt.lastRound?.validatorVotesName;
  if (!validators?.length) return null;
  if (!votes?.length && !named?.length) return null;

  const out: Record<string, string> = {};
  validators.forEach((validator, index) => {
    if (named?.[index]) {
      out[validator] = String(named[index]).toLowerCase();
      return;
    }
    const code = Number(votes?.[index]);
    out[validator] = VOTE_CODES[code] ?? `code:${code}`;
  });
  return out;
}

/** The address a deployment produced, whichever shape reported it. */
export function contractAddressFrom(receipt: Receipt): string | null {
  return (
    receipt.txDataDecoded?.contractAddress ??
    receipt.data?.contract_address ??
    receipt.recipient ??
    null
  );
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
  9: "APPEAL_REVEALING",
  10: "APPEAL_COMMITTING",
  11: "READY_TO_FINALIZE",
  12: "VALIDATORS_TIMEOUT",
  13: "LEADER_TIMEOUT",
  14: "LEADER_REVEALING",
};

function statusName(receipt: Receipt): string {
  if (receipt.statusName) return receipt.statusName as string;
  if (receipt.status_name) return receipt.status_name;
  if (typeof receipt.status === "string") {
    return /^\d+$/.test(receipt.status)
      ? STATUS_NAMES[Number(receipt.status)] ?? `STATUS_${receipt.status}`
      : receipt.status;
  }
  return STATUS_NAMES[Number(receipt.status ?? -1)] ?? `STATUS_${receipt.status}`;
}

function executionResult(receipt: Receipt): string | null {
  const studio = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
  if (studio) return studio;
  if (receipt.txExecutionResultName) return receipt.txExecutionResultName;
  return null;
}

/**
 * A decision is not an execution.
 *
 * v0.6 is explicit about this: a transaction is successful only when its status
 * is ACCEPTED or FINALIZED **and** its execution result is FINISHED_WITH_RETURN.
 * `isSuccessful` encodes exactly that, and the SDK's own answer is used rather
 * than a second opinion written here.
 */
function transactionSucceeded(receipt: Receipt): boolean {
  try {
    return Boolean(isSuccessful(receipt as unknown as Parameters<typeof isSuccessful>[0]));
  } catch {
    const status = statusName(receipt);
    const execution = executionResult(receipt);
    return (status === "ACCEPTED" || status === "FINALIZED") && execution === "FINISHED_WITH_RETURN";
  }
}

/** Queue position, only while the transaction has not activated. */
function queuePositionOf(receipt: Receipt): number | null {
  if (receipt.queuePosition === undefined || receipt.queuePosition === null) return null;
  const position = Number(receipt.queuePosition);
  return Number.isFinite(position) ? position : null;
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

/**
 * Public testnets rate-limit and shed load. Those failures are transient and
 * self-describing ("retry in ~981ms"), so treating them as a permanent
 * adjudication failure strands a dispute that would have succeeded a second
 * later — with the escrow held and no way forward.
 */
function retryDelayMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);

  if (/retry in ~?(\d+)\s*ms/i.test(message)) {
    const match = message.match(/retry in ~?(\d+)\s*ms/i);
    return Math.max(500, Number(match?.[1] ?? 1000));
  }
  if (/rate limit|at capacity|too many requests|429|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i.test(message)) {
    return 1500;
  }
  return null;
}

async function withRetries<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delay = retryDelayMs(error);
      if (delay === null) throw error;
      // Back off progressively; the node tells us roughly how long to wait.
      await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Whether an operator has chosen to sign a quote that failed verification. */
function allowUnverifiedFees(): boolean {
  return process.env.RECOURSE_ALLOW_UNVERIFIED_FEES === "1";
}

/**
 * How a transaction kit is obtained. Injectable so the no-network tests can
 * exercise quoting, price protection and retries without a live chain — the
 * decisions worth testing are ours, not the node's.
 */
export type KitFactory = (
  config: GenLayerConfig,
  privateKey: `0x${string}`,
  options: { allowUnverified?: boolean },
) => ForumKit;

export class GenLayerForum implements AdjudicationForum {
  readonly id = "GENLAYER";
  private readonly config: GenLayerConfig;
  private readonly kitFactory: KitFactory;
  private client: Client | null = null;
  /** Address adjudications are signed with, once a key has been resolved. */
  signer: string | null = null;

  constructor(config: GenLayerConfig = loadGenLayerConfig(), kitFactory: KitFactory = createForumKit) {
    this.config = config;
    this.kitFactory = kitFactory;
  }

  get available(): boolean {
    return Boolean(this.config.contractAddress);
  }

  get description(): string {
    return this.available
      ? `RecourseAdjudicator on ${this.config.networkLabel} (chain ${this.config.chainId})`
      : `RecourseAdjudicator is not deployed on ${this.config.networkLabel}`;
  }

  get network(): string {
    return this.config.networkLabel;
  }

  get contractAddress(): string | null {
    return this.config.contractAddress;
  }

  get chainId(): number {
    return this.config.chainId;
  }

  get explorerUrl(): string | null {
    return this.available && this.config.explorer
      ? `${this.config.explorer}${this.config.contractAddress}`
      : null;
  }

  get warnings(): string[] {
    return this.config.warnings;
  }

  get signerAddress(): string | null {
    return this.signer;
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
      fees: null,
      feeAccounting: null,
      queuePosition: null,
    };
  }

  /**
   * Keeps the signing account solvent on a Studio sandbox.
   *
   * Studio exposes `sim_fundAccount`, which is what makes the hosted sandbox
   * usable without a faucet. It is used only when the account is short of the
   * quoted deposit, and only on a Studio chain: on a public testnet there is no
   * such facility, no fallback, and an unfunded key fails loudly instead of
   * being quietly topped up from somewhere.
   *
   * Failure is non-fatal on purpose: a missing funding RPC must not be reported
   * as a fee problem, and the submission that follows reports the truth either
   * way.
   */
  private async ensureStudioFunding(required: bigint): Promise<string | null> {
    if (!this.config.isStudio || required <= 0n) return null;
    const account = this.config.privateKey ?? null;
    if (!account) return null;

    const client = this.getClient();
    try {
      const address = createAccount(account).address;
      const balance = BigInt(await client.getBalance({ address }));
      if (balance >= required) return null;

      // Ask for whole GEN with headroom: the amount is a convenience top-up for
      // a sandbox account, not an accounting operation.
      const shortfallGen = Number((required - balance + 10n ** 18n - 1n) / 10n ** 18n);
      const amount = Math.max(1, shortfallGen + 1);
      await client.request({ method: "sim_fundAccount", params: [address, amount] });
      return `Studio funded ${address} with ${amount} GEN so the quoted deposit (${required} wei) could be escrowed.`;
    } catch (error) {
      return `Could not top up the Studio account automatically (${describe(error)}). If the submission fails, fund the signer or deploy with a funded GENLAYER_PRIVATE_KEY.`;
    }
  }

  /**
   * Quotes and submits one adjudication.
   *
   * The order matters. The quote is taken first, then checked, then submitted
   * unchanged: a deposit that is recalculated after verification is a deposit
   * the verification did not cover.
   */
  async submit(request: AdjudicationRequest): Promise<AdjudicationOutcome> {
    const address = this.config.contractAddress;
    if (!address) {
      return this.unavailable(
        `No RecourseAdjudicator contract is configured for ${this.config.networkLabel}. Run \`npm run genlayer:deploy\` and set GENLAYER_CONTRACT_ADDRESS.`,
      );
    }

    const payload = {
      ...request.payload,
      inputsHash: documentHash(request.payload as unknown as Json),
    };
    const args = [request.disputeId, JSON.stringify(payload)];

    let forumKit: ForumKit;
    try {
      forumKit = this.kitFactory(this.config, this.config.privateKey ?? createEphemeralKey(), {
        allowUnverified: allowUnverifiedFees(),
      });
      this.signer = forumKit.signerAddress;
    } catch (error) {
      return this.unavailable(
        `Could not build a signing provider for ${this.config.networkLabel}: ${describe(error)}`,
      );
    }

    let quote;
    try {
      quote = await withRetries(() =>
        forumKit.kit.estimate({ preset: "standard" }, {
          kind: "write",
          address: address as `0x${string}`,
          method: "adjudicate",
          args,
        }),
      );
    } catch (error) {
      return this.unavailable(
        `Fee estimation failed on ${this.config.networkLabel}: ${describe(error)}. Nothing was submitted, so the escrow is still held.`,
      );
    }

    const fees = quoteToDomain(quote, forumKit.profile, new Date().toISOString());

    /*
     * Price protection. A quote built against fee prices that have since moved
     * is refused rather than signed: on a fee-charging network that is the
     * difference between a transaction that settles and one that is cancelled
     * at activation.
     */
    if (quote.verification.status === "mismatch" && !allowUnverifiedFees()) {
      return {
        status: "FAILED",
        network: this.config.networkLabel,
        contractAddress: address,
        transactionHash: null,
        networkStatus: null,
        votes: null,
        ruling: null,
        failureReason: `The fee quote does not match ${this.config.networkLabel}'s live fee policy (expected ${quote.verification.expectedHash}, got ${quote.verification.actualHash}). Refusing to sign it; set RECOURSE_ALLOW_UNVERIFIED_FEES=1 only to override deliberately.`,
        finalizedAt: null,
        fees,
        feeAccounting: null,
        queuePosition: null,
      };
    }

    const fundingNote = await this.ensureStudioFunding(quote.feeValue);

    try {
      const { genlayerTxId, evmTxHash } = await forumKit.kit.submit(quote, {
        kind: "write",
        address: address as `0x${string}`,
        method: "adjudicate",
        args,
      });

      return {
        status: "SUBMITTED",
        network: this.config.networkLabel,
        contractAddress: address,
        // The GenLayer transaction id is the handle every read uses.
        transactionHash: genlayerTxId ?? evmTxHash ?? null,
        networkStatus: "SUBMITTED",
        votes: null,
        ruling: null,
        failureReason: null,
        finalizedAt: null,
        fees,
        feeAccounting: null,
        queuePosition: fees.queuePosition,
      };
    } catch (error) {
      return {
        ...this.unavailable(
          `GenLayer submission failed: ${describe(error)}. The deposit was not consumed and the escrow remains held.${
            fundingNote ? ` ${fundingNote}` : ""
          }`,
        ),
        fees,
      };
    }
  }

  async poll(input: { disputeId: string; transactionHash: string }): Promise<AdjudicationOutcome> {
    const address = this.config.contractAddress;
    if (!address) {
      return this.unavailable("No RecourseAdjudicator contract is configured.");
    }

    const client = this.getClient();
    let receipt: Receipt;
    try {
      receipt = (await withRetries(() =>
        client.getTransaction({ hash: input.transactionHash as Hash }),
      )) as Receipt;
    } catch (error) {
      return {
        status: "PENDING",
        network: this.config.networkLabel,
        contractAddress: address,
        transactionHash: input.transactionHash,
        networkStatus: null,
        votes: null,
        ruling: null,
        failureReason: `Receipt not yet retrievable: ${describe(error)}`,
        finalizedAt: null,
        queuePosition: null,
      };
    }

    const network = statusName(receipt);
    const votes = normalizeVotes(receipt);
    const execution = executionResult(receipt);
    const queuePosition = queuePositionOf(receipt);
    const lifecyclePhase = receipt.lifecycle?.phase ?? receipt.lifecycle?.state ?? null;
    const feeAccounting = extractFeeAccounting(receipt);

    const decided = network === "ACCEPTED" || network === "FINALIZED";
    const terminalFailure = [
      "UNDETERMINED",
      "CANCELED",
      "VALIDATORS_TIMEOUT",
      "LEADER_TIMEOUT",
    ].includes(network);

    if (!decided && !terminalFailure) {
      return {
        status: "PENDING",
        network: this.config.networkLabel,
        contractAddress: address,
        transactionHash: input.transactionHash,
        networkStatus: lifecyclePhase ? `${network} · ${lifecyclePhase}` : network,
        votes,
        ruling: null,
        failureReason: null,
        finalizedAt: null,
        queuePosition,
        feeAccounting,
      };
    }

    if (terminalFailure) {
      return {
        status: "FAILED",
        network: this.config.networkLabel,
        contractAddress: address,
        transactionHash: input.transactionHash,
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: `The network ${network === "CANCELED" ? "cancelled" : "failed to decide"} this transaction (${network}). The escrow is still held.`,
        finalizedAt: null,
        queuePosition: null,
        feeAccounting,
      };
    }

    /*
     * Decided is not executed. On v0.6 the two are separate facts, and a
     * contract that raised after consensus would otherwise be reported as a
     * ruling nobody could act on.
     */
    if (!transactionSucceeded(receipt)) {
      const failed = execution ?? "an execution result the node did not report";
      return {
        status: "FAILED",
        network: this.config.networkLabel,
        contractAddress: address,
        transactionHash: input.transactionHash,
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: `The transaction was decided (${network}) but the contract did not finish successfully: ${failed}.`,
        finalizedAt: null,
        queuePosition: null,
        feeAccounting,
      };
    }

    // The authoritative ruling is contract state, not the transaction log.
    let raw: unknown;
    try {
      raw = await withRetries(() =>
        client.readContract({
          address: address as `0x${string}`,
          functionName: "get_ruling",
          args: [input.disputeId],
        }),
      );
    } catch (error) {
      return {
        status: "PENDING",
        network: this.config.networkLabel,
        contractAddress: address,
        transactionHash: input.transactionHash,
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: `Ruling not yet readable: ${describe(error)}`,
        finalizedAt: null,
        queuePosition: null,
        feeAccounting,
      };
    }

    const ruling = parseRuling(raw);
    if (!ruling) {
      return {
        status: typeof raw === "string" && raw.trim() === "" ? "PENDING" : "FAILED",
        network: this.config.networkLabel,
        contractAddress: address,
        transactionHash: input.transactionHash,
        networkStatus: network,
        votes,
        ruling: null,
        failureReason:
          typeof raw === "string" && raw.trim() === ""
            ? null
            : "Adjudication returned a ruling the protocol cannot act on.",
        finalizedAt: null,
        queuePosition: null,
        feeAccounting,
      };
    }

    return {
      status: "FINALIZED",
      network: this.config.networkLabel,
      contractAddress: address,
      transactionHash: input.transactionHash,
      networkStatus: network,
      votes,
      rounds: roundsFrom(receipt),
      ruling,
      failureReason: null,
      finalizedAt: new Date().toISOString(),
      queuePosition: null,
      feeAccounting,
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * An ephemeral key for an unconfigured environment.
 *
 * It cannot fund a fee deposit, which is exactly why the caller is warned: on a
 * fee-charging network the quote will be refused by the network rather than
 * silently underpaid.
 */
function createEphemeralKey(): `0x${string}` {
  return generatePrivateKey();
}

/**
 * Used when no contract is deployed. It refuses to rule rather than pretending
 * to — an unavailable forum is a legitimate protocol state, a fake one is not.
 */
export class UnavailableForum implements AdjudicationForum {
  readonly id = "GENLAYER";
  readonly available = false;
  readonly signer = null;
  readonly description =
    "No adjudication forum is configured for this environment. Deploy the RecourseAdjudicator to Studio Next (`npm run genlayer:deploy`) and set GENLAYER_CONTRACT_ADDRESS to enable judgment.";

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
      fees: null,
      feeAccounting: null,
      queuePosition: null,
    };
  }

  async submit(): Promise<AdjudicationOutcome> {
    return this.outcome();
  }

  async poll(): Promise<AdjudicationOutcome> {
    return this.outcome();
  }
}
