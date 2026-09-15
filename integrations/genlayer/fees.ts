import { readFileSync } from "node:fs";
import { createTransactionKit, type FeeSuggestions, type PolicyQuote, type TransactionKit } from "@genlayer/transaction-kit";
import type { AdjudicationFeeAccounting, AdjudicationFeeQuote } from "../../domain/model";
import { formatGen } from "../../domain/shared/money";
import { createSigningProvider } from "./provider";
import type { GenLayerConfig } from "./config";

export { formatGen };

/**
 * Fees.
 *
 * Consensus v0.6 makes every deploy and write carry a fee distribution and the
 * fee value quoted for it. Recourse does not compute that deposit itself. The
 * deposit is a *measured application policy*: it comes from a fee profile
 * produced by the contract's own test suite, priced by the network at quote
 * time, and submitted unchanged.
 *
 * Two rules this module exists to enforce:
 *
 *  1. **Never submit an unquoted fee.** A write with no fee distribution, or
 *     with one that does not match live prices, is refused rather than
 *     broadcast and hoped for. Escrow stays held; the dispute is not stranded
 *     on a transaction the network was always going to reject.
 *  2. **Never claim a number the network did not report.** The deposit is ours
 *     (we submitted it). Consumption and refund are the network's, and are
 *     reported only when a receipt actually carries them.
 */

export interface FeeProfileResolution {
  /** Suggestions the kit will consume, or null when no usable profile exists. */
  suggestions: FeeSuggestions | null;
  file: string;
  /** Why the profile was not used, in the operator's words. Null when it was. */
  note: string | null;
  measuredAt: string | null;
}

function asChainId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return BigInt(value as string).toString();
  } catch {
    return null;
  }
}

/**
 * Reads a `fee-profile.json` and keeps it only when it was measured on the
 * chain this deployment actually talks to.
 *
 * A profile measured elsewhere is not a smaller estimate, it is a different
 * network's cost structure. The kit itself refuses to apply one; this surfaces
 * the reason so an operator sees "ignored" instead of wondering why the deposit
 * looks like the network default.
 */
export function resolveFeeProfile(file: string, activeChainId: number): FeeProfileResolution {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return {
      suggestions: null,
      file,
      note: `No fee profile at ${file}; the quote uses network-default allocations within live price caps.`,
      measuredAt: null,
    };
  }

  const profileChainId = asChainId(raw.chainId);
  if (profileChainId === null) {
    return {
      suggestions: null,
      file,
      note: `${file} does not declare a chainId, so it cannot be shown to have been measured on chain ${activeChainId}. Ignored; regenerate it with \`gltest --fee-profile\` against this network.`,
      measuredAt: typeof raw.measuredAt === "string" ? raw.measuredAt : null,
    };
  }
  if (profileChainId !== String(activeChainId)) {
    return {
      suggestions: null,
      file,
      note: `${file} was measured on chain ${profileChainId}, and this deployment is on chain ${activeChainId}. Measurements do not cross networks, so it is ignored.`,
      measuredAt: typeof raw.measuredAt === "string" ? raw.measuredAt : null,
    };
  }

  return {
    suggestions: raw as FeeSuggestions,
    file,
    note: null,
    measuredAt: typeof raw.measuredAt === "string" ? raw.measuredAt : null,
  };
}

export interface ForumKit {
  kit: TransactionKit;
  signerAddress: `0x${string}`;
  profile: FeeProfileResolution;
}

/**
 * Builds a transaction kit over the deployment key.
 *
 * The kit is created per submission rather than cached: a quote is only valid
 * against the prices that were live when it was taken, and reusing a stale
 * quote is the failure mode the kit's verification step exists to catch.
 */
export function createForumKit(
  config: GenLayerConfig,
  privateKey: `0x${string}`,
  options: { allowUnverified?: boolean } = {},
): ForumKit {
  const { provider, address } = createSigningProvider({
    privateKey,
    chain: config.chain,
    rpcUrl: config.rpcUrl,
  });
  const profile = resolveFeeProfile(config.feeProfileFile, config.chainId);

  const kit = createTransactionKit({
    chain: config.chain,
    provider,
    account: address,
    ...(options.allowUnverified ? { allowUnverified: true } : {}),
    ...(profile.suggestions ? { suggestions: profile.suggestions } : {}),
  });

  return { kit, signerAddress: address, profile };
}

const bigint = (value: bigint | number | string | undefined): string =>
  value === undefined ? "0" : value.toString();

/**
 * Turns a kit quote into the protocol's own record of what it submitted.
 *
 * The deposit, the caps and the fee-config hash are ours: we measured them at
 * quote time and submitted them unchanged. `profileNote` travels with the
 * record so a reviewer can see whether a measured profile was used and, if not,
 * exactly why.
 */
export function quoteToDomain(
  quote: PolicyQuote,
  profile: FeeProfileResolution,
  quotedAt: string,
): AdjudicationFeeQuote {
  return {
    depositWei: bigint(quote.feeValue),
    userValueWei: bigint(quote.userValue),
    totalWei: bigint(quote.total),
    gasless: Boolean(quote.gasless),
    source: quote.source,
    breakdown: {
      timeUnitFeesWei: bigint(quote.breakdown.timeUnitFees),
      executionBudgetWei: bigint(quote.breakdown.executionBudget),
      messageFeesWei: bigint(quote.breakdown.messageFees),
    },
    caps: {
      genPerTimeUnitWei: bigint(quote.caps.genPerTimeUnit),
      storagePriceWei: bigint(quote.caps.storagePrice),
      receiptPriceWei: bigint(quote.caps.receiptPrice),
    },
    verification: {
      status: quote.verification.status,
      expectedFeeConfigHash: quote.verification.expectedHash ?? null,
      actualFeeConfigHash: quote.verification.actualHash ?? null,
    },
    profileFile: profile.suggestions ? profile.file : null,
    profileNote: profile.note,
    queuePosition: quote.queue?.pendingAhead ?? null,
    quotedAt,
  };
}

type AccountingShape = Record<string, unknown>;

function pickNumber(shape: AccountingShape, keys: string[]): string | null {
  for (const key of keys) {
    const value = shape[key];
    if (value === undefined || value === null) continue;
    try {
      return BigInt(value as string).toString();
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fee consumption, when — and only when — a receipt reports it.
 *
 * Not every node exposes fee accounting on a transaction read, and a deposited
 * budget is not the same number as a consumed one. Rather than infer
 * consumption from the deposit (which would make the refund always zero and
 * always wrong), absence is reported as absence and the UI says so.
 */
export function extractFeeAccounting(receipt: unknown): AdjudicationFeeAccounting | null {
  if (!receipt || typeof receipt !== "object") return null;
  const record = receipt as Record<string, unknown>;
  const data = (record.data ?? {}) as Record<string, unknown>;
  const consensus = (record.consensus_data ?? {}) as Record<string, unknown>;

  const candidates: Array<[string, AccountingShape]> = [
    ["receipt.feeAccounting", record.feeAccounting as AccountingShape],
    ["receipt.fee_accounting", record.fee_accounting as AccountingShape],
    ["receipt.data.fee_accounting", data.fee_accounting as AccountingShape],
    ["receipt.data.feeAccounting", data.feeAccounting as AccountingShape],
    ["receipt.consensus_data.fee_accounting", consensus.fee_accounting as AccountingShape],
  ];

  for (const [source, shape] of candidates) {
    if (!shape || typeof shape !== "object") continue;
    const deposit = pickNumber(shape, [
      "paid_fee_value",
      "paidFeeValue",
      "deposit",
      "fee_value",
    ]);
    const consumed = pickNumber(shape, [
      "execution_fee_consumed",
      "executionFeeConsumed",
      "consumed",
      "total_consumed",
      "totalConsumed",
    ]);
    const refunded = pickNumber(shape, ["total_refunded", "totalRefunded", "refunded"]);
    if (deposit === null && consumed === null && refunded === null) continue;
    return {
      source,
      depositWei: deposit,
      consumedWei: consumed,
      refundedWei: refunded,
      reportedAt: new Date().toISOString(),
    };
  }

  return null;
}
