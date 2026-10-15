import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { generatePrivateKey } from "viem/accounts";
import type { Hash } from "genlayer-js/types";
import type {
  AdjudicationForum,
  AdjudicationOutcome,
  AdjudicationRequest,
  AppealSubmission,
} from "../../domain/ports";
import type { ConsensusLifecycle, Ruling } from "../../domain/model";
import { FULL_REFUND_BPS } from "../../domain/model";
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
 *
 * v0.2 of the protocol adds what v0.1 got wrong about finality:
 *
 *  - **Accepted is not final.** An ACCEPTED transaction can still be appealed
 *    and recomputed until its finality window closes. It is reported DECIDED,
 *    with the ruling read from the latest *non-final* state, and the protocol
 *    does not settle on it. Only FINALIZED reads the ruling from finalized
 *    state (`latest-final`) and reports FINALIZED.
 *  - **Appeals.** `appeal()` asks the network whether the decision can still be
 *    appealed, takes the authoritative charge (bond + funding), and appeals the
 *    same transaction — GenLayer's Optimistic Democracy, as designed.
 *  - **A ruling must be ours.** Rulings are checked against the inputs hash the
 *    protocol submitted (and, on v2 contracts, the submitting address). A ruling
 *    made against different inputs — a reused dispute id after a reseed, or a
 *    third party who got to a v1 contract first — is refused, not settled.
 */

/* ---------------------------------------------------------------- receipts */

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
 * and `queuePosition`. Studio also reports appeal bookkeeping (`appealed`,
 * `appeal_failed`).
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
  appealed?: boolean;
  appeal_failed?: number | string;
  appealFailed?: number | string;
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

/** Appeals the network has counted as failed (Studio reports this). */
function failedAppealsFrom(receipt: Receipt): number | null {
  const raw = receipt.appealFailed ?? receipt.appeal_failed;
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Consensus v0.6 transaction status codes.
 *
 * v0.1 of this file carried the v0.5 layout (11 READY_TO_FINALIZE,
 * 12 VALIDATORS_TIMEOUT, 13 LEADER_TIMEOUT, 14 LEADER_REVEALING). On v0.6, 13
 * is LEADER_REVEALING — a transaction still being decided — and the old table
 * would have reported it as LEADER_TIMEOUT and failed a live adjudication. The
 * table below is v0.6's, and an unknown code is reported as pending, never as
 * a failure.
 */
export const STATUS_NAMES: Record<number, string> = {
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
  11: "VALIDATORS_TIMEOUT",
  12: "LEADER_TIMEOUT",
  13: "LEADER_REVEALING",
};

// UNINITIALIZED, PENDING, PROPOSING, COMMITTING, REVEALING and LEADER_REVEALING
// are all "still being decided" — as is any name this table does not know.
const APPEALING = new Set(["APPEAL_REVEALING", "APPEAL_COMMITTING"]);
/**
 * Outcomes this protocol does not settle on. Leader appeals against
 * UNDETERMINED or a timeout are possible on GenLayer, but the protocol treats
 * these as failed referrals and lets the dispute be resubmitted instead.
 */
const FAILED_STATES = new Set(["UNDETERMINED", "CANCELED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT"]);

function statusName(receipt: Receipt): string {
  const named = receipt.statusName ?? receipt.status_name;
  const raw = named ?? receipt.status;
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) {
    return STATUS_NAMES[Number(raw)] ?? `STATUS_${raw}`;
  }
  if (typeof raw === "string" && raw !== "") {
    // Normalise "AppealRevealing" (protocol names) to "APPEAL_REVEALING".
    return raw.includes("_") || raw === raw.toUpperCase()
      ? raw.toUpperCase()
      : raw.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  }
  return `STATUS_${String(receipt.status)}`;
}

/** Where a status name puts the adjudication. Unknown names are never failures. */
export function classifyStatus(name: string): "PROCESSING" | "APPEALING" | "ACCEPTED" | "FINALIZED" | "FAILED" {
  if (name === "FINALIZED") return "FINALIZED";
  // READY_TO_FINALIZE only exists on v0.5 nodes; it is still not final.
  if (name === "ACCEPTED" || name === "READY_TO_FINALIZE") return "ACCEPTED";
  if (APPEALING.has(name)) return "APPEALING";
  if (FAILED_STATES.has(name)) return "FAILED";
  return "PROCESSING";
}

const EXECUTION_RESULTS: Record<number, string> = {
  0: "NOT_VOTED",
  1: "FINISHED_WITH_RETURN",
  2: "FINISHED_WITH_ERROR",
  3: "TIMEOUT",
  4: "NONDET_DISAGREE",
};

function executionResult(receipt: Receipt): string | null {
  const studio = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
  if (studio) return studio;
  if (receipt.txExecutionResultName) return receipt.txExecutionResultName;
  if (typeof receipt.txExecutionResult === "number") {
    return EXECUTION_RESULTS[receipt.txExecutionResult] ?? null;
  }
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
    if (isSuccessful(receipt as unknown as Parameters<typeof isSuccessful>[0])) return true;
  } catch {
    // fall through to the same rule over the normalised names
  }
  /*
   * The SDK compares the raw status name, so a node that reports the protocol
   * spelling ("Accepted") would read as a failed execution. Same rule, applied
   * to the normalised name: decided AND finished with a return value.
   */
  const status = statusName(receipt);
  const execution = executionResult(receipt);
  return (status === "ACCEPTED" || status === "FINALIZED") && execution === "FINISHED_WITH_RETURN";
}

/** Queue position, only while the transaction has not activated. */
function queuePositionOf(receipt: Receipt): number | null {
  if (receipt.queuePosition === undefined || receipt.queuePosition === null) return null;
  const position = Number(receipt.queuePosition);
  return Number.isFinite(position) ? position : null;
}

/* ----------------------------------------------------------------- rulings */

/**
 * Parses and re-validates a ruling coming back from the network.
 *
 * Exported because it is a security boundary, not a formatting detail: a forum
 * that returned "buyer wins, pay the merchant" must never become actionable.
 * Accepts both contract generations: v1 rulings (all-or-nothing, no refund
 * field) and v2 rulings (`recourse.ruling/2`, refund in basis points).
 */
export function parseRuling(raw: unknown): Ruling | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const decision = parsed.decision;
  const settlement = parsed.recommended_settlement;
  if (decision !== "BUYER_WINS" && decision !== "MERCHANT_WINS" && decision !== "SPLIT") return null;
  if (settlement !== "REFUND" && settlement !== "RELEASE" && settlement !== "SPLIT") return null;

  let refundBps: number;
  if (parsed.refund_bps === undefined) {
    // A v1 ruling: the decision fixes the amount. A split cannot be v1.
    if (decision === "SPLIT") return null;
    refundBps = decision === "BUYER_WINS" ? FULL_REFUND_BPS : 0;
  } else {
    const bps = parsed.refund_bps;
    if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > FULL_REFUND_BPS) return null;
    refundBps = bps;
  }

  // Re-assert the invariants on this side of the wire too. A forum that
  // returned "buyer wins, release the funds to the merchant" must not be
  // actionable, and neither is a "split" that refunds nothing or everything.
  const materialBreach = Boolean(parsed.material_breach);
  if (decision === "BUYER_WINS" && (!materialBreach || settlement !== "REFUND" || refundBps !== FULL_REFUND_BPS)) {
    return null;
  }
  if (decision === "MERCHANT_WINS" && (materialBreach || settlement !== "RELEASE" || refundBps !== 0)) {
    return null;
  }
  if (decision === "SPLIT" && (!materialBreach || settlement !== "SPLIT" || refundBps <= 0 || refundBps >= FULL_REFUND_BPS)) {
    return null;
  }

  const ruling: Ruling = {
    decision,
    materialBreach,
    violatedTerms: Array.isArray(parsed.violated_terms)
      ? (parsed.violated_terms as unknown[]).map(String)
      : [],
    satisfiedTerms: Array.isArray(parsed.satisfied_terms)
      ? (parsed.satisfied_terms as unknown[]).map(String)
      : [],
    recommendedSettlement: settlement,
    refundBps,
    reasoningSummary: String(parsed.reasoning_summary ?? ""),
  };
  if (typeof parsed.schema === "string") ruling.schema = parsed.schema;
  if (parsed.remedy_mode === "ALL_OR_NOTHING" || parsed.remedy_mode === "GRADUATED") {
    ruling.remedyMode = parsed.remedy_mode;
  }
  if (typeof parsed.inputs_hash === "string") ruling.inputsHash = parsed.inputs_hash;
  if (typeof parsed.submitter === "string") ruling.submitter = parsed.submitter;
  return ruling;
}

/**
 * Why a ruling must not be acted on, or null when it is bound to this request.
 *
 * v2 rulings carry the inputs hash and submitter they were made for. v1
 * rulings carry neither, so for them the contract's separately stored inputs
 * hash is compared instead. Either way, a ruling made against inputs the
 * protocol did not send is refused: on a v1 contract that is exactly what a
 * reused dispute id, or a caller who got to the id first, would produce.
 */
export function rulingBindingProblem(
  ruling: Ruling,
  expected: { inputsHash?: string | null; submitter?: string | null; storedInputsHash?: string | null },
): string | null {
  const want = expected.inputsHash?.toLowerCase() ?? null;
  if (ruling.schema) {
    const got = ruling.inputsHash?.toLowerCase() ?? null;
    if (want && got !== want) {
      return `the ruling was made against inputs ${got ?? "(none)"}, not the ${want} this protocol submitted`;
    }
    const submitter = expected.submitter?.toLowerCase() ?? null;
    const recorded = ruling.submitter?.toLowerCase() ?? null;
    if (submitter && recorded !== submitter) {
      return `the ruling was requested by ${recorded ?? "(unknown)"}, not by this protocol's signer ${submitter}`;
    }
    return null;
  }
  const stored = expected.storedInputsHash?.toLowerCase() ?? null;
  if (want && stored && stored !== want) {
    return `the contract recorded this dispute id against inputs ${stored}, not the ${want} this protocol submitted — a stale ruling for a reused id, or one requested by someone else`;
  }
  return null;
}

/* -------------------------------------------------------------- transport */

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

/** A read of a method the contract does not have — i.e. a v1 contract. */
function isMissingMethod(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // GenVM's bootloader answers an unknown method by refusing the abstract
  // `__handle_undefined_method__` fallback ("method is abstract ...").
  return /__handle_undefined_method__|method is abstract|unknown method|no such method|method not found|has no attribute|AttributeError/i.test(
    message,
  );
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

/** The lifecycle shape genlayer-js normalises Studio and contract networks to. */
interface ProtocolLifecycleLike {
  storedStatus?: unknown;
  projectedStatus?: unknown;
  resolutionAction?: unknown;
  decisionId?: unknown;
  decisionActive?: unknown;
}

/**
 * The part of the genlayer-js client the forum uses for reads, appeals and
 * finalization. Writes go through the transaction kit instead.
 */
export interface ForumClient {
  getTransaction(args: { hash: Hash }): Promise<unknown>;
  readContract(args: {
    address: `0x${string}`;
    functionName: string;
    args: unknown[];
    transactionHashVariant?: "latest-final" | "latest-nonfinal";
  }): Promise<unknown>;
  getBalance(args: { address: `0x${string}` }): Promise<bigint | number | string>;
  request(args: { method: string; params: unknown[] }): Promise<unknown>;
  canAppeal(args: { txId: `0x${string}` }): Promise<boolean>;
  getAppealCharge(args: { txId: `0x${string}` }): Promise<bigint>;
  appealTransaction(args: { txId: `0x${string}`; value?: bigint }): Promise<unknown>;
  finalizeTransaction(args: { txId: `0x${string}` }): Promise<string>;
  advanced: {
    getTransactionLifecycle(args: { hash: `0x${string}` }): Promise<ProtocolLifecycleLike>;
  };
}

/** Builds the client for one signing key. Injectable for the same reason. */
export type ClientFactory = (config: GenLayerConfig, privateKey: `0x${string}`) => ForumClient;

export const createForumClient: ClientFactory = (config, privateKey) =>
  createClient({ chain: config.chain, account: createAccount(privateKey) }) as unknown as ForumClient;

/* ------------------------------------------------------------------ forum */

export class GenLayerForum implements AdjudicationForum {
  readonly id = "GENLAYER";
  private readonly config: GenLayerConfig;
  private readonly kitFactory: KitFactory;
  private readonly clientFactory: ClientFactory;
  private client: ForumClient | null = null;
  /**
   * Key for reads, appeals and finalization when no GENLAYER_PRIVATE_KEY is
   * configured. Generated once per process, so an appeal is paid for by the
   * same account the forum was funding on a Studio sandbox.
   */
  private readonly processKey: `0x${string}`;
  private readonly versions = new Map<string, number>();
  private readonly finalized = new Set<string>();
  /** Address adjudications are signed with, once a key has been resolved. */
  signer: string | null = null;

  constructor(
    config: GenLayerConfig = loadGenLayerConfig(),
    kitFactory: KitFactory = createForumKit,
    clientFactory: ClientFactory = createForumClient,
  ) {
    this.config = config;
    this.kitFactory = kitFactory;
    this.clientFactory = clientFactory;
    this.processKey = config.privateKey ?? createEphemeralKey();
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

  private getClient(): ForumClient {
    if (!this.client) this.client = this.clientFactory(this.config, this.processKey);
    return this.client;
  }

  /** The address that pays for appeals and finalization. */
  private get accountAddress(): string {
    return createAccount(this.processKey).address;
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
   * Keeps an account solvent on a Studio sandbox.
   *
   * Studio exposes `sim_fundAccount`, which is what makes the hosted sandbox
   * usable without a faucet. It is used only when the account is short of the
   * amount it is about to pay, and only on a Studio chain: on a public testnet
   * there is no such facility, no fallback, and an unfunded key fails loudly
   * instead of being quietly topped up from somewhere.
   *
   * Failure is non-fatal on purpose: a missing funding RPC must not be reported
   * as a fee problem, and the submission that follows reports the truth either
   * way.
   */
  private async ensureStudioFunding(required: bigint, address?: string): Promise<string | null> {
    if (!this.config.isStudio || required <= 0n) return null;
    const target = address ?? (this.config.privateKey ? createAccount(this.config.privateKey).address : null);
    if (!target) return null;

    const client = this.getClient();
    try {
      const balance = BigInt(await client.getBalance({ address: target as `0x${string}` }));
      if (balance >= required) return null;

      // Ask for whole GEN with headroom: the amount is a convenience top-up for
      // a sandbox account, not an accounting operation.
      const shortfallGen = Number((required - balance + 10n ** 18n - 1n) / 10n ** 18n);
      const amount = Math.max(1, shortfallGen + 1);
      await client.request({ method: "sim_fundAccount", params: [target, amount] });
      return `Studio funded ${target} with ${amount} GEN so ${required} wei could be paid.`;
    } catch (error) {
      return `Could not top up the Studio account automatically (${describe(error)}). If the transaction fails, fund the signer or set a funded GENLAYER_PRIVATE_KEY.`;
    }
  }

  /**
   * The contract generation at `address`: 2 when it publishes `get_policy`,
   * 1 when it has no such method, null when the read failed for some other
   * reason (which is not evidence of anything, so it is not cached).
   */
  async contractVersion(address: string): Promise<number | null> {
    const key = address.toLowerCase();
    const cached = this.versions.get(key);
    if (cached !== undefined) return cached;

    try {
      const raw = await withRetries(() =>
        this.getClient().readContract({
          address: address as `0x${string}`,
          functionName: "get_policy",
          args: [],
        }),
      );
      const policy = JSON.parse(String(raw)) as { version?: unknown };
      const major = Number(String(policy.version ?? "2").split(".")[0]);
      const version = Number.isInteger(major) && major >= 2 ? major : 2;
      this.versions.set(key, version);
      return version;
    } catch (policyError) {
      /*
       * No get_policy. Rather than trust the wording of a VM error, look for
       * positive evidence of v1: its one-argument get_ruling answers, where a
       * v2 contract's two-argument get_ruling would refuse the call.
       */
      try {
        await withRetries(() =>
          this.getClient().readContract({
            address: address as `0x${string}`,
            functionName: "get_ruling",
            args: ["recourse:contract-version-probe"],
          }),
        );
        this.versions.set(key, 1);
        return 1;
      } catch {
        if (isMissingMethod(policyError)) {
          this.versions.set(key, 1);
          return 1;
        }
        return null;
      }
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

    // On a Studio sandbox, keep whichever key signs this solvent — including a
    // per-submission key when no GENLAYER_PRIVATE_KEY is configured.
    const fundingNote = await this.ensureStudioFunding(quote.feeValue, forumKit.signerAddress);

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
        // v2 contracts store the ruling under the address that asked for it.
        // The contract generation is detected when the ruling is first read.
        submitter: forumKit.signerAddress,
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

  /** GenLayer's lifecycle for a transaction, or null when it cannot be read. */
  private async readLifecycle(txId: string): Promise<ConsensusLifecycle | null> {
    try {
      const lifecycle = await this.getClient().advanced.getTransactionLifecycle({
        hash: txId as `0x${string}`,
      });
      const text = (value: unknown) => (value === undefined || value === null ? null : String(value));
      return {
        storedStatus: text(lifecycle.storedStatus),
        projectedStatus: text(lifecycle.projectedStatus),
        resolutionAction: text(lifecycle.resolutionAction),
        decisionId: lifecycle.decisionActive ? text(lifecycle.decisionId) : null,
        decisionActive: typeof lifecycle.decisionActive === "boolean" ? lifecycle.decisionActive : null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Whether this forum submits finalization itself when the window elapses.
   *
   * Studio finalizes accepted transactions on its own once the window closes.
   * Contract networks wait for someone to submit finalization, and "anyone"
   * includes the party whose escrow is waiting on it — so off Studio the forum
   * does it. RECOURSE_AUTO_FINALIZE=0 turns it off, =1 forces it on.
   */
  private autoFinalizeEnabled(): boolean {
    const flag = process.env.RECOURSE_AUTO_FINALIZE;
    if (flag === "0") return false;
    if (flag === "1") return true;
    return !this.config.isStudio;
  }

  async poll(input: {
    disputeId: string;
    transactionHash: string;
    contractAddress?: string | null;
    submitter?: string | null;
    inputsHash?: string | null;
    contractVersion?: number | null;
  }): Promise<AdjudicationOutcome> {
    const address = input.contractAddress ?? this.config.contractAddress;
    if (!address) {
      return this.unavailable("No RecourseAdjudicator contract is configured.");
    }

    const client = this.getClient();
    const base = {
      network: this.config.networkLabel,
      contractAddress: address,
      transactionHash: input.transactionHash,
    };

    let receipt: Receipt;
    try {
      receipt = (await withRetries(() =>
        client.getTransaction({ hash: input.transactionHash as Hash }),
      )) as Receipt;
    } catch (error) {
      return {
        ...base,
        status: "PENDING",
        networkStatus: null,
        votes: null,
        ruling: null,
        failureReason: `Receipt not yet retrievable: ${describe(error)}`,
        finalizedAt: null,
        queuePosition: null,
      };
    }

    const network = statusName(receipt);
    const phase = classifyStatus(network);
    const votes = normalizeVotes(receipt);
    const execution = executionResult(receipt);
    const lifecyclePhase = receipt.lifecycle?.phase ?? receipt.lifecycle?.state ?? null;
    const feeAccounting = extractFeeAccounting(receipt);
    const observed = {
      rounds: roundsFrom(receipt),
      failedAppeals: failedAppealsFrom(receipt),
      appealInFlight: phase === "APPEALING" || receipt.appealed === true,
      feeAccounting,
    };

    if (phase === "PROCESSING" || phase === "APPEALING") {
      return {
        ...base,
        ...observed,
        status: phase === "APPEALING" ? "APPEALED" : "PENDING",
        networkStatus: lifecyclePhase ? `${network} · ${lifecyclePhase}` : network,
        votes,
        ruling: null,
        failureReason: null,
        finalizedAt: null,
        queuePosition: queuePositionOf(receipt),
      };
    }

    if (phase === "FAILED") {
      return {
        ...base,
        ...observed,
        status: "FAILED",
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: `The network ${network === "CANCELED" ? "cancelled" : "failed to decide"} this transaction (${network}). The escrow is still held.`,
        finalizedAt: null,
        queuePosition: null,
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
        ...base,
        ...observed,
        status: "FAILED",
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: `The transaction was decided (${network}) but the contract did not finish successfully: ${failed}.`,
        finalizedAt: null,
        queuePosition: null,
      };
    }

    const final = phase === "FINALIZED";
    // The lifecycle says whether the window has elapsed and which decision an
    // appeal would be bound to. Best effort: absence is reported as absence.
    const lifecycle = final ? null : await this.readLifecycle(input.transactionHash);

    let finalizationTx: string | null = null;
    let finalizationNote: string | null = null;
    if (
      !final &&
      lifecycle?.resolutionAction === "Finalize" &&
      lifecycle.decisionActive &&
      this.autoFinalizeEnabled() &&
      !this.finalized.has(input.transactionHash)
    ) {
      try {
        finalizationTx = String(
          await client.finalizeTransaction({ txId: input.transactionHash as `0x${string}` }),
        );
        this.finalized.add(input.transactionHash);
      } catch (error) {
        finalizationNote = `The finality window has elapsed but submitting finalization failed (${describe(error)}); waiting for someone else to finalize.`;
      }
    }

    const version = input.contractVersion ?? (await this.contractVersion(address));
    if (version === null) {
      return {
        ...base,
        ...observed,
        status: "PENDING",
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: "Could not determine which contract generation holds the ruling yet; will retry.",
        finalizedAt: null,
        queuePosition: null,
        lifecycle,
        finalizationTx,
      };
    }
    if (version >= 2 && !input.submitter) {
      return {
        ...base,
        ...observed,
        status: "FAILED",
        networkStatus: network,
        votes,
        ruling: null,
        failureReason:
          "This adjudication has no recorded submitter, and v2 contracts store each ruling under the address that requested it.",
        finalizedAt: null,
        queuePosition: null,
        lifecycle,
        contractVersion: version,
      };
    }

    /*
     * The authoritative ruling is contract state, not the transaction log —
     * and which state matters. A provisional ruling is read from the latest
     * non-final state; a final one only from finalized state.
     */
    const variant = final ? "latest-final" : "latest-nonfinal";
    let raw: unknown;
    let storedInputsHash: string | null = null;
    try {
      if (version >= 2) {
        raw = await withRetries(() =>
          client.readContract({
            address: address as `0x${string}`,
            functionName: "get_ruling",
            args: [input.submitter, input.disputeId],
            transactionHashVariant: variant,
          }),
        );
      } else {
        raw = await withRetries(() =>
          client.readContract({
            address: address as `0x${string}`,
            functionName: "get_ruling",
            args: [input.disputeId],
            transactionHashVariant: variant,
          }),
        );
        storedInputsHash = String(
          (await withRetries(() =>
            client.readContract({
              address: address as `0x${string}`,
              functionName: "get_inputs_hash",
              args: [input.disputeId],
              transactionHashVariant: variant,
            }),
          )) ?? "",
        );
      }
    } catch (error) {
      return {
        ...base,
        ...observed,
        status: "PENDING",
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: `Ruling not yet readable: ${describe(error)}`,
        finalizedAt: null,
        queuePosition: null,
        lifecycle,
        contractVersion: version,
        finalizationTx,
      };
    }

    const empty = typeof raw === "string" && raw.trim() === "";
    const ruling = parseRuling(raw);
    if (!ruling) {
      return {
        ...base,
        ...observed,
        status: empty ? "PENDING" : "FAILED",
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: empty
          ? final
            ? null
            : "Accepted, but the ruling is not readable from the latest state yet."
          : "Adjudication returned a ruling the protocol cannot act on.",
        finalizedAt: null,
        queuePosition: null,
        lifecycle,
        contractVersion: version,
        finalizationTx,
      };
    }

    const problem = rulingBindingProblem(ruling, {
      inputsHash: input.inputsHash ?? null,
      submitter: input.submitter ?? null,
      storedInputsHash,
    });
    if (problem) {
      return {
        ...base,
        ...observed,
        status: "FAILED",
        networkStatus: network,
        votes,
        ruling: null,
        failureReason: `Refusing to act on this ruling: ${problem}.`,
        finalizedAt: null,
        queuePosition: null,
        lifecycle,
        contractVersion: version,
      };
    }

    return {
      ...base,
      ...observed,
      status: final ? "FINALIZED" : "DECIDED",
      networkStatus: network,
      votes,
      ruling,
      failureReason: finalizationNote,
      finalizedAt: final ? new Date().toISOString() : null,
      queuePosition: null,
      lifecycle,
      contractVersion: version,
      finalizationTx,
    };
  }

  /**
   * Appeals the provisional ruling of a submitted adjudication.
   *
   * GenLayer appeals the *same* transaction: a larger committee re-runs the
   * contract's validator function against the leader's ruling, and if its
   * majority disagrees, the transaction is recomputed. The network decides
   * whether the decision can still be appealed and what it costs; this method
   * asks it both, in that order, and pays exactly the quoted charge.
   */
  async appeal(input: { disputeId: string; transactionHash: string }): Promise<AppealSubmission> {
    const client = this.getClient();
    const txId = input.transactionHash as `0x${string}`;
    const failed = (reason: string): AppealSubmission => ({
      status: "FAILED",
      chargeWei: null,
      decisionId: null,
      paidBy: null,
      rounds: null,
      failedAppeals: null,
      networkStatus: null,
      reason,
    });

    let allowed: boolean;
    try {
      allowed = await withRetries(() => client.canAppeal({ txId }));
    } catch (error) {
      return failed(`Could not ask ${this.config.networkLabel} whether this decision can be appealed: ${describe(error)}`);
    }
    if (!allowed) {
      return {
        ...failed(
          "GenLayer reports this decision can no longer be appealed: its finality window has closed, or the decision it was bound to has changed.",
        ),
        status: "REFUSED",
      };
    }

    let charge: bigint;
    try {
      charge = BigInt(await withRetries(() => client.getAppealCharge({ txId })));
    } catch (error) {
      return failed(`The network did not quote an appeal charge: ${describe(error)}`);
    }

    // Signals as they stand before the appeal, so the protocol can tell later
    // when the appeal round has actually been run.
    let before: Receipt | null = null;
    try {
      before = (await withRetries(() => client.getTransaction({ hash: input.transactionHash as Hash }))) as Receipt;
    } catch {
      before = null;
    }
    const lifecycle = await this.readLifecycle(input.transactionHash);
    const payer = this.accountAddress;
    const fundingNote = await this.ensureStudioFunding(charge + 10n ** 18n, payer);

    try {
      await client.appealTransaction({ txId, value: charge });
    } catch (error) {
      return {
        ...failed(
          `The appeal was not accepted by ${this.config.networkLabel}: ${describe(error)}.${fundingNote ? ` ${fundingNote}` : ""} Nothing changed; the provisional ruling stands.`,
        ),
        chargeWei: charge.toString(),
      };
    }

    return {
      status: "FILED",
      chargeWei: charge.toString(),
      decisionId: lifecycle?.decisionId ?? null,
      paidBy: payer,
      rounds: before ? roundsFrom(before) : null,
      failedAppeals: before ? failedAppealsFrom(before) : null,
      networkStatus: before ? statusName(before) : null,
      reason: null,
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

  async appeal(): Promise<AppealSubmission> {
    return {
      status: "FAILED",
      chargeWei: null,
      decisionId: null,
      paidBy: null,
      rounds: null,
      failedAppeals: null,
      networkStatus: null,
      reason: this.description,
    };
  }
}
