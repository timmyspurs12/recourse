#!/usr/bin/env tsx
/**
 * Deploys the RecourseAdjudicator Intelligent Contract to a GenLayer network.
 *
 *   npm run genlayer:deploy                                    # Studio Next
 *   npm run genlayer:deploy -- --network testnet-bradbury --key 0x...
 *   npm run genlayer:deploy -- --pin py-genlayer:<hash>         # force a runner
 *
 * Consensus v0.6 changed three things about deploying, and each one bites
 * silently if it is done the old way:
 *
 *  1. **A deploy carries a fee.** The deposit is quoted from a measured fee
 *     profile plus the network's live prices, and submitted unchanged. The
 *     Transaction Kit performs that quote here, over a private-key-backed
 *     provider — the same path the running protocol uses, so what is verified
 *     in production is what is verified at deploy time.
 *  2. **The deployed address moved.** Studios report it in
 *     `data.contract_address`; v0.6 receipts carry it in
 *     `txDataDecoded.contractAddress`. Reading only one of those loses the
 *     address of a deployment that actually succeeded — and a lost address is
 *     indistinguishable from a failed deployment unless we check both.
 *  3. **Success is two facts.** `ACCEPTED`/`FINALIZED` says the network
 *     decided; `FINISHED_WITH_RETURN` says the contract ran. `isSuccessful`
 *     requires both.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import type { Hash } from "genlayer-js/types";
import { generatePrivateKey } from "viem/accounts";
import { loadGenLayerConfig } from "../integrations/genlayer/config";
import { createForumKit, formatGen } from "../integrations/genlayer/fees";
import { ADJUDICATOR_SOURCE } from "../integrations/genlayer/config";
import {
  KNOWN_PY_GENLAYER_RUNNERS,
  STUDIO_NEXT_PY_GENLAYER_PIN,
  checkRunnerPin,
  negotiateRunnerPin,
  runnerPinProblems,
  runnerPinsInHeader,
  withRunnerPin,
} from "../integrations/genlayer/runner-pin";

/*
 * Flags as well as environment variables.
 *
 * `VAR=value npm run ...` is bash-only: it fails in PowerShell and cmd, which is
 * where most Windows users end up. Flags work everywhere.
 */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : undefined;
}

const env: Record<string, string | undefined> = { ...process.env };
if (flag("network")) env.GENLAYER_NETWORK = flag("network");
if (flag("key")) env.GENLAYER_PRIVATE_KEY = flag("key");

const config = loadGenLayerConfig(env);

/*
 * Validate the key here rather than letting the curve library fail with
 * "invalid private key, expected hex or 32 bytes, got string", which says
 * nothing about what to do next. Pasting the placeholder from the docs is an
 * easy and very common mistake.
 */
const rawKey = env.GENLAYER_PRIVATE_KEY?.trim();
if (rawKey !== undefined) {
  const normalized = rawKey.startsWith("0x") ? rawKey.slice(2) : rawKey;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    console.error(`That is not a private key: "${rawKey}"`);
    console.error("");
    if (/YOUR|KEY|xxx|<|>/i.test(rawKey)) {
      console.error("It looks like a placeholder was pasted literally.");
    }
    console.error("A key is 64 hex characters, usually written with a 0x prefix.");
    console.error("");
    console.error("Generate one with:   npm run wallet");
    console.error("Then fund it at:     https://testnet-faucet.genlayer.foundation/");
    process.exit(1);
  }
}

const privateKey = rawKey
  ? ((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`)
  : generatePrivateKey();
const account = createAccount(privateKey);
if (!rawKey) {
  console.log("No GENLAYER_PRIVATE_KEY set — using an ephemeral account for this deployment.");
}

console.log(`network:  ${config.networkLabel} (chain ${config.chainId})`);
console.log(`rpc:      ${config.rpcUrl}`);
console.log(`deployer: ${account.address}`);
console.log(`contract: ${ADJUDICATOR_SOURCE}`);
for (const warning of config.warnings) console.log(`warning:  ${warning}`);

/* ------------------------------------------------------------ runner pin */

/*
 * The runner pin is checked before anything is sent: a pin the network cannot
 * decode aborts the deployment after consensus, when the only evidence left is
 * `invalid_contract runner malformed` on a finalized transaction with no
 * traceback and nothing deployed. Checking it here costs nothing and names the
 * offending character.
 */
const code = readFileSync(ADJUDICATOR_SOURCE, "utf-8");
const pinProblems = runnerPinProblems(code);
if (pinProblems.length > 0) {
  console.error("\nThe contract's runner pin cannot be loaded by GenVM:");
  for (const problem of pinProblems) console.error(`  ${problem}`);
  console.error(
    "\nThe pin is the first comment in the contract, e.g." +
      `\n  # { "Depends": "${STUDIO_NEXT_PY_GENLAYER_PIN}" }`,
  );
  console.error("Nothing was sent to the network.");
  process.exit(1);
}

const pins = runnerPinsInHeader(code);
for (const pin of pins) console.log(`runner:   ${pin}`);

/*
 * `--pin` deploys the same contract under a different runner, for a network
 * whose GenVM release this repository does not know yet. Only the header line
 * changes; the contract body is exactly what the tests ran.
 */
let deployCode = code;
let deployedPin: string | null = pins.find((pin) => pin.startsWith("py-genlayer:")) ?? null;
const forcedPin = flag("pin");
if (forcedPin) {
  const problem = checkRunnerPin(forcedPin);
  if (problem) {
    console.error(`\n--pin ${forcedPin} cannot be loaded by GenVM: ${problem}`);
    console.error("Nothing was sent to the network.");
    process.exit(1);
  }
  deployCode = withRunnerPin(code, forcedPin);
  deployedPin = forcedPin;
  console.log(`runner:   forced to ${forcedPin} (--pin); the file on disk is unchanged`);
} else if (pins.length === 1 && pins[0] !== STUDIO_NEXT_PY_GENLAYER_PIN) {
  console.log(`note:     the newest runner this repository knows is ${STUDIO_NEXT_PY_GENLAYER_PIN}`);
}

const client = createClient({ chain: config.chain, account });

/* ------------------------------------------------------- network-side probe */

/*
 * Ask the network to resolve the contract before paying it to.
 *
 * Every check above is local: shape, alphabet, canonical gvm32. None of them can
 * answer the only question that decides the deployment — does *this* network
 * have the runner that hash names? GenVM repackages the python runner between
 * releases, so a pin that was official last week is refused today with
 * `invalid_contract runner malformed`: zero storage written, no traceback, and a
 * transaction that still FINALIZES with consensus "Accepted". Discovering that
 * costs a fee deposit and a full round trip through consensus.
 *
 * `getContractSchemaForCode` compiles the source against the live runner cache
 * and costs nothing, so it goes first. A runner-shaped refusal stops the deploy
 * here with the fix named. Anything else — an unsupported method, a rate limit,
 * a transport hiccup — is reported and the deploy continues, because an
 * inconclusive probe is not evidence of a bad contract.
 */
if (env.RECOURSE_SKIP_SCHEMA_PROBE === "1") {
  console.log("probe:    skipped (RECOURSE_SKIP_SCHEMA_PROBE=1)");
} else if (forcedPin) {
  console.log("probe:    skipped for a forced --pin; the deployment itself will tell");
} else {
  /*
   * Runner negotiation. The contract's own pin is probed first; only if the
   * network answers "no such runner" are the other known runners tried, newest
   * first. Studio moved from rc7's runner to rc9's in October 2026, so a
   * network can be on either side of that change on any given day — this is
   * what lets one command deploy to both without editing the contract.
   */
  const negotiation = await negotiateRunnerPin(code, async (candidate) => {
    try {
      const schema = await client.getContractSchemaForCode(candidate);
      const methods = Object.keys(schema?.methods ?? {});
      return {
        status: "ok" as const,
        detail: `${methods.length} method(s)` + (methods.length > 0 ? `: ${methods.join(", ")}` : ""),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return /runner|invalid_contract|malformed/i.test(message)
        ? { status: "runner-missing" as const, detail: message.slice(0, 300) }
        : { status: "inconclusive" as const, detail: message.slice(0, 300) };
    }
  });

  for (const attempt of negotiation.attempts) {
    const release = KNOWN_PY_GENLAYER_RUNNERS.find((runner) => runner.pin === attempt.pin)?.genvm;
    console.log(
      `probe:    ${attempt.pin}${release ? ` (GenVM ${release})` : ""} → ${attempt.result.status}` +
        (attempt.result.detail ? ` — ${attempt.result.detail}` : ""),
    );
  }

  if (negotiation.pin === null) {
    console.error("\nThe network could not load this contract under any runner this repository knows:");
    for (const attempt of negotiation.attempts) console.error(`  ${attempt.pin}: ${attempt.result.detail}`);
    console.error(
      "\nA well-formed pin naming a runner this network does not ship fails exactly" +
        "\nlike this, before one line of the contract runs. The hash tracks the network's" +
        "\nGenVM release, not the contract: find the py-genlayer runner the target network" +
        "\nships and re-run with --pin py-genlayer:<hash>.",
    );
    console.error("\nNothing was sent and no fee was taken.");
    console.error("Re-run with RECOURSE_SKIP_SCHEMA_PROBE=1 to skip this check.");
    process.exit(1);
  }

  if (negotiation.attempts.at(-1)?.result.status === "inconclusive") {
    console.log("probe:    inconclusive; deploying with the contract's own pin");
  } else if (negotiation.pin !== deployedPin) {
    console.log(
      `runner:   this network does not carry ${deployedPin}; deploying with ${negotiation.pin}` +
        " (header rewritten for this deployment only)",
    );
  }
  deployCode = negotiation.code;
  deployedPin = negotiation.pin;
}

/* ------------------------------------------------------------------ funding */

/*
 * Studio sandboxes can fund an account themselves; public testnets cannot, and
 * an unfunded wallet there fails deep inside the RPC layer with a message that
 * buries the word "funds". So: on Studio, top up through the sandbox facility;
 * everywhere else, check the balance and stop with instructions.
 */
try {
  const balance = BigInt(await client.getBalance({ address: account.address }));
  console.log(`balance:  ${formatGen(balance) ?? `${balance} wei`}`);

  if (config.isStudio) {
    if (rawKey === undefined) {
      // Ephemeral account: fund it through the sandbox so the deploy can pay
      // whatever the quote asks for.
      await client.request({ method: "sim_fundAccount", params: [account.address, 50] });
      console.log("funding:  Studio funded this ephemeral account with 50 GEN");
    } else if (balance < 10n ** 19n) {
      // A provided key that is nearly empty on a sandbox: top it up the same
      // way, rather than failing at the fee quote. Sandbox-only; a public
      // testnet key is never topped up from anywhere.
      await client.request({ method: "sim_fundAccount", params: [account.address, 50] });
      console.log("funding:  Studio topped this key up with 50 GEN (balance was under 10 GEN)");
    }
  } else if (balance === 0n) {
    console.error("\nThis wallet has no GEN, so the deployment will be rejected.");
    console.error("Fund it at https://testnet-faucet.genlayer.foundation/");
    console.error(`  address: ${account.address}`);
    console.error("\nThen run this command again.");
    process.exit(1);
  }
} catch (error) {
  console.log(
    `balance:  could not be read or funded (${error instanceof Error ? error.message : String(error)}); attempting the deployment anyway`,
  );
}

/* -------------------------------------------------------------------- deploy */

const { kit, profile } = createForumKit(config, privateKey, {
  allowUnverified: process.env.RECOURSE_ALLOW_UNVERIFIED_FEES === "1",
});

if (profile.note) console.log(`fee note: ${profile.note}`);

const deployTx = { kind: "deploy" as const, code: deployCode, args: [] as unknown[] };

const quote = await kit.estimate({ preset: "standard" }, deployTx);
console.log(
  `fee:      deposit ${formatGen(quote.feeValue) ?? `${quote.feeValue} wei`}` +
    ` (${quote.source === "developer" ? "measured profile" : "network default"})` +
    ` · policy ${quote.verification.status}` +
    (quote.gasless ? " · gasless" : ""),
);

if (quote.verification.status === "mismatch" && process.env.RECOURSE_ALLOW_UNVERIFIED_FEES !== "1") {
  console.error("\nThe quote does not match the network's live fee policy:");
  console.error(`  quoted against: ${quote.verification.expectedHash}`);
  console.error(`  network now:    ${quote.verification.actualHash}`);
  console.error("\nDeploying anyway risks a transaction that is cancelled at activation.");
  console.error("Re-run to take a fresh quote, or set RECOURSE_ALLOW_UNVERIFIED_FEES=1 to override.");
  process.exit(1);
}

const { genlayerTxId } = await kit.submit(quote, deployTx);
console.log(`deploy tx: ${genlayerTxId}`);

const tracked = await kit.track(genlayerTxId, (status) => {
  if (status.queuePosition !== undefined) {
    console.log(`  ${status.phase} · queue position ${status.queuePosition}`);
  } else {
    console.log(`  ${status.phase}${status.statusName ? ` · ${status.statusName}` : ""}`);
  }
}, { until: "finalized" });

/*
 * Read the receipt for the address: `track` reports what the SDK normalised,
 * and the receipt is the source of truth if it disagrees.
 */
const receipt = await client.getTransaction({ hash: genlayerTxId as unknown as Hash });
const receiptShape = receipt as {
  txDataDecoded?: { contractAddress?: string };
  data?: { contract_address?: string };
  txExecutionResultName?: string;
  txExecutionResult?: number;
  consensus_data?: { leader_receipt?: Array<{ genvm_result?: { stderr?: string } }> };
};
const address =
  tracked.contractAddress ?? receiptShape.txDataDecoded?.contractAddress ?? receiptShape.data?.contract_address ?? null;

/*
 * FINALIZED says the network decided. It does not say the contract ran, and a
 * deployment whose execution errored still carries a contract address in its
 * receipt — an address with no code behind it. Recording it would report a
 * contract that does not exist, which is worse than reporting no deployment, so
 * the execution result is checked before any file is written.
 */
const EXECUTION_RESULT_NUMBER_TO_NAME: Record<number, string> = {
  0: "NOT_VOTED",
  1: "FINISHED_WITH_RETURN",
  2: "FINISHED_WITH_ERROR",
  3: "TIMEOUT",
  4: "NONDET_DISAGREE",
};
const execution =
  tracked.executionResultName ??
  receiptShape.txExecutionResultName ??
  (receiptShape.txExecutionResult !== undefined
    ? EXECUTION_RESULT_NUMBER_TO_NAME[receiptShape.txExecutionResult]
    : undefined) ??
  null;

if (execution !== "FINISHED_WITH_RETURN") {
  console.error(`\nThe deployment did not run: execution was ${execution ?? "not reported"}.`);
  console.error(`  status:    ${tracked.statusName ?? tracked.phase ?? "not reported"}`);
  console.error(`  execution: ${execution ?? "not reported"}`);
  console.error(`  tx:        ${genlayerTxId}`);
  if (address) {
    console.error(
      `  address:   ${address} (reported by the receipt, but no code was stored — not usable)`,
    );
  }
  const stderr = receiptShape.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr;
  if (stderr) console.error(stderr.slice(0, 4000));
  console.error("\nNothing was written to the deployment files. Re-run when the contract executes.");
  process.exit(1);
}

if (!address) {
  console.error("\nThe deployment ran but no contract address was reported.");
  console.error(`execution: ${execution}`);
  const stderr = receiptShape.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr;
  if (stderr) console.error(stderr.slice(0, 4000));
  console.error("\nNothing was written to the deployment files. Re-run when the network is healthy.");
  process.exit(1);
}

/* ------------------------------------------------------------- verification */

/*
 * A deployed address is a claim; a contract that answers is evidence. v2
 * publishes its generation and remedy rules through get_policy, so read it
 * back before recording anything. A failed read is reported, not fatal:
 * reads can lag a fresh deployment by a few seconds.
 */
type Policy = { version?: string; remedy_modes?: string[]; agreement_tolerance_bps?: number };
let policy: Policy | null = null;
for (let attempt = 0; attempt < 5 && policy === null; attempt += 1) {
  try {
    const raw = await client.readContract({
      address: address as `0x${string}`,
      functionName: "get_policy",
      args: [],
    });
    policy = JSON.parse(String(raw)) as Policy;
  } catch (error) {
    if (attempt === 4) {
      console.log(
        `policy:   not readable yet (${error instanceof Error ? error.message.slice(0, 200) : String(error)})`,
      );
    } else {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}
if (policy) {
  console.log(
    `policy:   RecourseAdjudicator ${policy.version ?? "?"} · remedy modes ${(policy.remedy_modes ?? []).join(", ")}` +
      ` · tolerance ${policy.agreement_tolerance_bps ?? "?"} bps`,
  );
}

/* ----------------------------------------------------------------- recording */

const stamp = new Date().toISOString();
const explorer = config.explorer ? `${config.explorer}${address}` : null;

// Local record: what this machine deployed.
const localFile = config.deploymentFile;
mkdirSync(dirname(localFile), { recursive: true });
writeFileSync(
  localFile,
  `${JSON.stringify(
    {
      default: config.networkKey,
      deployments: {
        [config.networkKey]: {
          address,
          chainId: config.chainId,
          rpcUrl: config.rpcUrl,
          deployedAt: stamp,
          deployTx: genlayerTxId,
          deployer: account.address,
          explorer,
          runner: deployedPin,
          contractVersion: policy?.version ?? null,
        },
      },
    },
    null,
    2,
  )}\n`,
);

/*
 * Committed record: so a fresh clone — and the submission's contract link —
 * points at this deployment for this network instead of an older one, while
 * leaving deployments on other networks intact.
 */
const committedFile = config.committedDeploymentFile;
let committed: {
  note?: string;
  default?: string;
  deployments?: Record<string, unknown>;
} = {};
try {
  committed = JSON.parse(readFileSync(committedFile, "utf-8")) as typeof committed;
} catch {
  committed = {};
}
committed.note =
  "Default RecourseAdjudicator deployments, one per network. Override with GENLAYER_CONTRACT_ADDRESS, or redeploy with `npm run genlayer:deploy`.";
committed.default = config.networkKey;
/*
 * The previous deployment on this network is kept, not overwritten: its
 * rulings are still on-chain evidence, and in-flight disputes recorded
 * against it are still polled at their original address.
 */
const previousEntry = (committed.deployments?.[config.networkKey] ?? null) as
  | (Record<string, unknown> & { address?: string; history?: unknown[] })
  | null;
const history: unknown[] = [];
if (previousEntry?.address && previousEntry.address !== address) {
  const { history: older, ...rest } = previousEntry;
  history.push(rest, ...(Array.isArray(older) ? older : []));
}
committed.deployments = {
  ...(committed.deployments ?? {}),
  [config.networkKey]: {
    address,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    deployedAt: stamp,
    deployTx: genlayerTxId,
    explorer,
    deployer: account.address,
    runner: deployedPin,
    contractVersion: policy?.version ?? null,
    status: `${tracked.statusName ?? tracked.phase}, execution ${execution}`,
    ...(history.length > 0 ? { history } : {}),
  },
};
writeFileSync(committedFile, `${JSON.stringify(committed, null, 2)}\n`);

console.log(`\nRecourseAdjudicator deployed on ${config.networkLabel}`);
console.log(`  address:     ${address}`);
console.log(`  status:      ${tracked.statusName ?? tracked.phase}`);
console.log(`  execution:   ${tracked.executionResultName ?? "not reported"}`);
console.log(`  deposit:     ${formatGen(quote.feeValue) ?? `${quote.feeValue} wei`}`);
console.log(`  runner:      ${deployedPin ?? "not recorded"}`);
console.log(`  version:     ${policy?.version ?? "not confirmed"}`);
console.log(`  recorded in: ${localFile}`);
console.log(`  committed:   ${committedFile}`);
if (explorer) {
  console.log(`\nExplorer link (use this for the hackathon submission):\n  ${explorer}`);
}
console.log(`\nPin it in your deployment environment with:`);
console.log(`  GENLAYER_NETWORK=${config.networkKey}`);
console.log(`  GENLAYER_CONTRACT_ADDRESS=${address}`);
