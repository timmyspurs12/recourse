/**
 * Runner pins: the contract header that names the runtime GenVM must load.
 *
 * A GenLayer contract begins with a comment header — the version line and the
 * runner dependency JSON — because the contract's first line cannot run until
 * the network has loaded the runtime that executes it:
 *
 *   # v0.3.0
 *   # { "Depends": "py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0" }
 *
 * GenVM identifies a runner by content hash, encoded as Crockford Base32
 * ("gvm32": alphabet `0123456789abcdefghjkmnpqrstvwxyz`, no padding, i/l read
 * as 1, o as 0). Thirty-two bytes are 52 characters, and the four bits left
 * over in the final character are padding: they must be zero. An encoder that
 * wrote them as data produces a pin that looks plausible and is rejected when
 * the network reads it. That rejection happens before a single line of the
 * contract runs, so the deployment finalizes with an execution error, zero gas
 * used, no state hash and no Python traceback — reported only as
 * `invalid_contract runner malformed`.
 *
 * A pin can also be well-formed and still unusable: `:test`/`:latest` resolve
 * only in debug mode, and a hash for a runner the network does not ship fails
 * at load time. Both are checked here so that the failure lands on the terminal
 * running the deploy, not on the chain.
 *
 * The second case is the one that cannot be caught locally, and it is not
 * hypothetical. GenVM repackages the python runner between releases, so the
 * hash changes without the contract changing: Studio Next moved from
 * `9b8kjyda…` (GenVM v0.6.0-rc1/rc2) to `5jycge4q…` (v0.6.0-rc3, shipped by
 * Studio v0.123.0-rc.5+), and in October 2026 to `babwp9t3…` (v0.6.0-rc9).
 * A contract pinning a superseded hash is
 * byte-for-byte valid, decodes cleanly, and still finalizes with
 * `invalid_contract runner malformed` and nothing stored — the same symptom as
 * a malformed pin, from a completely different cause. Only the network can
 * answer whether it has the runner, so `scripts/genlayer-deploy.mts` asks it
 * (`getContractSchemaForCode`) before paying a fee to find out.
 */

/** Crockford Base32, as GenVM encodes hashes (`gvm32`). */
const GVM32_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** The hash GenVM expects: base32 characters, base32 length is 52 for 32 bytes. */
const GVM32_LENGTH = 52;

/**
 * py-genlayer runners by GenVM release, newest first.
 *
 * The hash tracks the network's GenVM release, not the contract: GenVM
 * repackages the python runner between releases, so the same contract needs a
 * different pin on a network that has upgraded. Studio Next has carried three:
 *
 *  - `babwp9t3…` — GenVM v0.6.0-rc9 (released 2026-10-08; Studio moved to it on
 *    2026-10-14).
 *  - `5jycge4q…` — GenVM v0.6.0-rc3 through rc7 (Studio v0.123.0-rc.5+). The
 *    v1 RecourseAdjudicator was deployed with this one.
 *  - `9b8kjyda…` — GenVM v0.6.0-rc1/rc2. Superseded; the fleet rejects it.
 *
 * A stale pin fails with no local symptom at all, so `scripts/genlayer-deploy.mts`
 * asks the network which of these it can load (`negotiateRunnerPin`) before
 * paying for a deployment.
 */
export const KNOWN_PY_GENLAYER_RUNNERS: ReadonlyArray<{
  pin: string;
  genvm: string;
  superseded: boolean;
}> = [
  {
    pin: "py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0",
    genvm: "v0.6.0-rc9",
    superseded: false,
  },
  {
    pin: "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng",
    genvm: "v0.6.0-rc3..rc7",
    superseded: false,
  },
  {
    pin: "py-genlayer:9b8kjyda2ycxyq4ea6g4yfpnydxhd52gqba5rb8dw7krkh5mn9p0",
    genvm: "v0.6.0-rc1/rc2",
    superseded: true,
  },
];

/**
 * The newest py-genlayer runner this repository knows about, and the one the
 * contract pins. Confirm it against the release the target network is actually
 * running before trusting a deployment to it.
 */
export const STUDIO_NEXT_PY_GENLAYER_PIN = KNOWN_PY_GENLAYER_RUNNERS[0].pin;

/**
 * Decodes a gvm32 string, or returns null when it is not a canonical encoding.
 *
 * "Canonical" is the whole point: a decoder that ignored trailing bits would
 * round-trip `...09h6` and `...09h0` as the same hash, while GenVM rejects the
 * non-canonical one. Returning null for both malformed and non-canonical input
 * keeps a caller from treating "close enough" as usable.
 */
export function decodeGvm32(value: string): Uint8Array | null {
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;

  for (const raw of value.toLowerCase()) {
    if (raw === "-") continue; // gvm32 ignores dashes
    const char = raw === "o" ? "0" : raw === "i" || raw === "l" ? "1" : raw;
    const digit = GVM32_ALPHABET.indexOf(char);
    if (digit === -1) return null;

    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }

  // Whatever is left must be zero: those bits are padding, not value.
  if (accumulator !== 0) return null;
  return Uint8Array.from(bytes);
}

/**
 * Why a runner id cannot be used, or null when it is usable.
 *
 * Mirrors GenVM's own resolution order: shape, then hash characters, then the
 * strict gvm32 decode, then the debug-only aliases.
 */
export function checkRunnerPin(runnerId: string): string | null {
  const separator = runnerId.indexOf(":");
  if (separator <= 0 || separator !== runnerId.lastIndexOf(":") || separator === runnerId.length - 1) {
    return "not a `<name>:<hash>` runner id";
  }

  const name = runnerId.slice(0, separator);
  const hash = runnerId.slice(separator + 1);

  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    return `runner name "${name}" contains characters GenVM does not accept`;
  }
  if (hash === "test" || hash === "latest") {
    return `":${hash}" resolves only on networks running in debug mode`;
  }
  if (!/^[A-Za-z0-9_=-]+$/.test(hash)) {
    return `hash "${hash}" contains characters GenVM does not accept`;
  }
  if (hash.length !== GVM32_LENGTH) {
    return `hash "${hash}" is ${hash.length} characters; a 32-byte hash is ${GVM32_LENGTH}`;
  }

  const decoded = decodeGvm32(hash);
  if (decoded === null) {
    return `hash "${hash}" is not canonical gvm32 (Crockford base32) — the network rejects it before the contract runs`;
  }
  if (decoded.length !== 32) {
    return `hash "${hash}" decodes to ${decoded.length} bytes, not 32`;
  }
  return null;
}

/**
 * Runner ids declared by a contract's leading comment header.
 *
 * GenVM reads the whole leading comment block, so every `Depends` in it —
 * including the ones inside a `Seq` block — is a runner the network must load.
 */
export function runnerPinsInHeader(source: string): string[] {
  const header: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(\/\/|#|--)(.*)$/.exec(line);
    if (!match) break;
    header.push(match[2]);
  }

  const text = header.join("\n");
  const pins: string[] = [];
  for (const match of text.matchAll(/"Depends"\s*:\s*"([^"]+)"/g)) pins.push(match[1]);
  return pins;
}

/** Every problem that would stop this contract's runner from loading. */
export function runnerPinProblems(source: string): string[] {
  const pins = runnerPinsInHeader(source);
  if (pins.length === 0) {
    return ['the contract header declares no runner ("Depends"), so GenVM cannot pick a runtime'];
  }

  const problems: string[] = [];
  for (const pin of pins) {
    const problem = checkRunnerPin(pin);
    if (problem) problems.push(`runner "${pin}": ${problem}`);
  }
  return problems;
}

/**
 * The same source with its py-genlayer runner replaced.
 *
 * Only the header changes, and only the `py-genlayer:` dependency: the contract
 * itself is byte-for-byte what was tested.
 */
export function withRunnerPin(source: string, pin: string): string {
  const lines = source.split(/(\r?\n)/);
  let inHeader = true;
  return lines
    .map((line) => {
      if (!inHeader || /^\r?\n$/.test(line)) return line;
      if (!/^\s*(\/\/|#|--)/.test(line)) {
        inHeader = false;
        return line;
      }
      return line.replace(/"Depends"\s*:\s*"py-genlayer:[^"]+"/, `"Depends": "${pin}"`);
    })
    .join("");
}

export type PinProbeResult =
  | { status: "ok"; detail?: string }
  | { status: "runner-missing"; detail: string }
  | { status: "inconclusive"; detail: string };

export interface PinNegotiation {
  /** The pin to deploy with, or null when no candidate loaded. */
  pin: string | null;
  /** The source to deploy: the original, or the original re-pinned. */
  code: string;
  attempts: Array<{ pin: string; result: PinProbeResult }>;
}

/**
 * Finds a runner pin the target network can load, cheapest first.
 *
 * The contract's own pin is probed first. Only if the network says that runner
 * is missing are the other known, non-superseded runners tried, newest first.
 * An inconclusive probe (unsupported method, rate limit, transport error) stops
 * the negotiation and keeps the current pin: it is not evidence that any pin is
 * wrong, and re-pinning on a guess would be worse than deploying as tested.
 */
export async function negotiateRunnerPin(
  source: string,
  probe: (code: string) => Promise<PinProbeResult>,
  runners: ReadonlyArray<{ pin: string; superseded: boolean }> = KNOWN_PY_GENLAYER_RUNNERS,
): Promise<PinNegotiation> {
  const declared = runnerPinsInHeader(source).find((pin) => pin.startsWith("py-genlayer:")) ?? null;
  const candidates = [
    ...(declared ? [declared] : []),
    ...runners.filter((runner) => !runner.superseded).map((runner) => runner.pin),
  ].filter((pin, index, all) => all.indexOf(pin) === index);

  const attempts: PinNegotiation["attempts"] = [];
  for (const pin of candidates) {
    const code = pin === declared ? source : withRunnerPin(source, pin);
    const result = await probe(code);
    attempts.push({ pin, result });
    if (result.status === "ok") return { pin, code, attempts };
    if (result.status === "inconclusive") {
      return { pin: declared, code: source, attempts };
    }
  }
  return { pin: null, code: source, attempts };
}
