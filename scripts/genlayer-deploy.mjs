#!/usr/bin/env node
/**
 * Deploys the RecourseAdjudicator Intelligent Contract to a GenLayer network
 * and records the resulting address in .recourse/genlayer.json.
 *
 *   npm run genlayer:deploy                     # studionet (no faucet needed)
 *   GENLAYER_NETWORK=testnet-asimov \
 *   GENLAYER_PRIVATE_KEY=0x... npm run genlayer:deploy
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const CHAINS = {
  localnet,
  studionet,
  "testnet-asimov": testnetAsimov,
  "testnet-bradbury": testnetBradbury,
};

/*
 * Accept flags as well as environment variables.
 *
 * `VAR=value npm run ...` is bash-only: it fails in PowerShell and cmd, which
 * is where most Windows users end up. Flags work everywhere.
 *
 *   npm run genlayer:deploy -- --network testnet-bradbury --key 0x...
 */
function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

const networkKey = flag("network") || process.env.GENLAYER_NETWORK || "studionet";
const chain = CHAINS[networkKey];
if (!chain) {
  console.error(`Unknown GENLAYER_NETWORK "${networkKey}". Options: ${Object.keys(CHAINS).join(", ")}`);
  process.exit(1);
}

const key = (flag("key") || process.env.GENLAYER_PRIVATE_KEY)?.trim();

/*
 * Validate the key here rather than letting the curve library fail with
 * "invalid private key, expected hex or 32 bytes, got string", which says
 * nothing about what to do next. Pasting the placeholder from the docs is an
 * easy and very common mistake.
 */
if (key !== undefined) {
  const normalized = key.startsWith("0x") ? key.slice(2) : key;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    console.error(`That is not a private key: "${key}"`);
    console.error("");
    if (/YOUR|KEY|xxx|<|>/i.test(key)) {
      console.error("It looks like a placeholder was pasted literally.");
    }
    console.error("A key is 64 hex characters, usually written with a 0x prefix.");
    console.error("");
    console.error("Generate one with:   npm run wallet");
    console.error("Then fund it at:     https://testnet-faucet.genlayer.foundation/");
    process.exit(1);
  }
}
const account = key ? createAccount(key.startsWith("0x") ? key : `0x${key}`) : createAccount();
if (!key) {
  console.log("No GENLAYER_PRIVATE_KEY set — using an ephemeral account for this deployment.");
}

const client = createClient({ chain, account });
const source = join(process.cwd(), "contracts", "recourse_adjudicator.py");
const code = readFileSync(source, "utf-8");

console.log(`network:  ${networkKey}`);
console.log(`deployer: ${account.address}`);
console.log(`contract: ${source}`);

/*
 * Pre-flight balance check.
 *
 * Public testnets charge fees. Without this, an unfunded wallet fails deep
 * inside the RPC layer with "Invalid parameters were provided" plus a buried
 * funds message, which is a miserable way to learn you need a faucet.
 */
const rpcUrl = chain.rpcUrls?.default?.http?.[0];
if (rpcUrl && networkKey.startsWith("testnet")) {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [account.address, "latest"],
      }),
    });
    const body = await response.json();
    const balance = BigInt(body.result ?? "0x0");
    console.log(`balance:  ${balance} wei`);
    if (balance === 0n) {
      console.error("\nThis wallet has no GEN, so the deployment will be rejected.");
      console.error(`Fund it at https://testnet-faucet.genlayer.foundation/`);
      console.error(`  address: ${account.address}`);
      console.error("\nThen run this command again.");
      process.exit(1);
    }
  } catch {
    console.log("balance:  could not be read; attempting deployment anyway");
  }
}

const hash = await client.deployContract({ code, args: [], leaderOnly: false });
console.log(`deploy tx: ${hash}`);

/*
 * Public testnets reach ACCEPTED quickly but can sit there for a long time
 * before FINALIZED, because finality waits out the appeal window. The contract
 * is usable at ACCEPTED, so wait for that and report the distinction honestly
 * rather than timing out on a deployment that actually succeeded.
 */
const receipt = await client.waitForTransactionReceipt({
  hash,
  status: networkKey.startsWith("testnet")
    ? TransactionStatus.ACCEPTED
    : TransactionStatus.FINALIZED,
  retries: 100,
  interval: 4000,
});

// Studionet: data.contract_address + consensus_data. Testnets: recipient +
// txExecutionResultName. Read whichever the network actually sent.
const execution =
  receipt?.consensus_data?.leader_receipt?.[0]?.execution_result ??
  (receipt?.txExecutionResultName?.startsWith("FINISHED") ? "SUCCESS" : receipt?.txExecutionResultName);
const address = receipt?.data?.contract_address ?? receipt?.recipient;
const statusLabel = receipt?.statusName ?? receipt?.status_name ?? receipt?.status;

if (execution !== "SUCCESS" || !address) {
  console.error(`Deployment failed. execution_result=${execution ?? "unknown"}`);
  const stderr = receipt?.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr;
  if (stderr) console.error(stderr.slice(0, 4000));
  process.exit(1);
}

const outFile = join(process.cwd(), ".recourse", "genlayer.json");
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `${JSON.stringify(
    { network: networkKey, address, deployedAt: new Date().toISOString(), deployTx: hash, deployer: account.address },
    null,
    2,
  )}\n`,
);

/*
 * Also update the committed default so a fresh clone — and the submission's
 * contract link — point at this deployment rather than a previous one.
 */
const committedFile = join(process.cwd(), "genlayer.deployment.json");
writeFileSync(
  committedFile,
  `${JSON.stringify(
    {
      note: "Default RecourseAdjudicator deployment. Override with GENLAYER_CONTRACT_ADDRESS, or redeploy with `npm run genlayer:deploy`.",
      network: networkKey,
      address,
      deployedAt: new Date().toISOString(),
      deployTx: hash,
    },
    null,
    2,
  )}\n`,
);

const EXPLORERS = {
  "testnet-asimov": "https://explorer-asimov.genlayer.com/address/",
  "testnet-bradbury": "https://explorer-bradbury.genlayer.com/address/",
  studionet: "https://studio.genlayer.com/contracts/",
};

console.log(`\nRecourseAdjudicator deployed`);
console.log(`  address:     ${address}`);
console.log(`  status:      ${statusLabel}`);
console.log(`  recorded in: ${outFile}`);
console.log(`  committed:   ${committedFile}`);
if (EXPLORERS[networkKey]) {
  console.log(`\nExplorer link (use this for the hackathon submission):`);
  console.log(`  ${EXPLORERS[networkKey]}${address}`);
}
console.log(`\nPin it with GENLAYER_CONTRACT_ADDRESS=${address}`);
