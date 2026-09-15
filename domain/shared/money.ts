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
