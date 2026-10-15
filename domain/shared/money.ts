/**
 * Money formatting.
 *
 * Pure, and in the domain because the ledger records GEN amounts as base-unit
 * strings: the protocol has to be able to say "0.00042 GEN" in an event without
 * depending on a UI library or the exact shape of a fee quote.
 *
 * This formats. It never computes a balance: deposits, consumption and refunds
 * are three different numbers reported by different parties, and adding them up
 * here would be the fastest way to publish one that is wrong.
 */

const WEI_PER_GEN = 10n ** 18n;

export function formatGen(
  wei: string | bigint | null | undefined,
  maxDecimals = 6,
): string | null {
  if (wei === null || wei === undefined || wei === "") return null;
  let value: bigint;
  try {
    value = BigInt(wei);
  } catch {
    return null;
  }
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / WEI_PER_GEN;
  const fraction = abs % WEI_PER_GEN;
  if (fraction === 0n) return `${sign}${whole} GEN`;
  const digits = fraction
    .toString()
    .padStart(18, "0")
    .slice(0, maxDecimals)
    .replace(/0+$/, "");
  if (digits !== "") return `${sign}${whole}.${digits} GEN`;
  /*
   * A non-zero deposit must never be displayed as zero. Rounding 1 wei to
   * "0 GEN" would tell a reader that nothing was escrowed when something was.
   */
  if (abs !== 0n) {
    return `${sign}<0.${"0".repeat(Math.max(0, maxDecimals - 1))}1 GEN`;
  }
  return `${sign}${whole} GEN`;
}

/* ------------------------------------------------------- escrow arithmetic */

/**
 * USDC amounts as integer micro-units.
 *
 * Orders carry decimal strings with at most six places (the agreement
 * validator enforces it), and a split settlement has to divide one of them
 * without losing or inventing a micro-unit. Integers make that exact: the
 * refund is rounded down, the release is the remainder, and the two legs
 * always add back up to the escrow.
 */
const MICROS_PER_UNIT = 1_000_000n;
const DECIMAL_AMOUNT = /^\d+(\.\d{1,6})?$/;

export function toMicros(amount: string): bigint {
  if (!DECIMAL_AMOUNT.test(amount)) {
    throw new RangeError(`Not a decimal amount with at most 6 places: "${amount}"`);
  }
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * MICROS_PER_UNIT + BigInt(fraction.padEnd(6, "0"));
}

/** Micro-units back to a decimal string with at least two places. */
export function fromMicros(micros: bigint): string {
  if (micros < 0n) throw new RangeError("Amounts are never negative");
  const whole = micros / MICROS_PER_UNIT;
  const fraction = (micros % MICROS_PER_UNIT).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/**
 * Splits an escrowed amount by a refund in basis points.
 *
 * The buyer's share is rounded *down* to the micro-unit and the merchant gets
 * exactly what is left, so rounding can never pay out more than was escrowed.
 */
export function splitByBps(amount: string, refundBps: number): { refund: string; release: string } {
  if (!Number.isInteger(refundBps) || refundBps < 0 || refundBps > 10_000) {
    throw new RangeError(`refundBps must be an integer between 0 and 10000, received ${refundBps}`);
  }
  const total = toMicros(amount);
  const refund = (total * BigInt(refundBps)) / 10_000n;
  return { refund: fromMicros(refund), release: fromMicros(total - refund) };
}
