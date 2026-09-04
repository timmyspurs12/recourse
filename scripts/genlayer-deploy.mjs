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

const networkKey = process.env.GENLAYER_NETWORK || "studionet";
const chain = CHAINS[networkKey];
if (!chain) {
  console.error(`Unknown GENLAYER_NETWORK "${networkKey}". Options: ${Object.keys(CHAINS).join(", ")}`);
  process.exit(1);
}

const key = process.env.GENLAYER_PRIVATE_KEY?.trim();
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

const hash = await client.deployContract({ code, args: [], leaderOnly: false });
console.log(`deploy tx: ${hash}`);

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  retries: 100,
  interval: 4000,
});

const execution = receipt?.consensus_data?.leader_receipt?.[0]?.execution_result;
const address = receipt?.data?.contract_address;

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

console.log(`\nRecourseAdjudicator deployed`);
console.log(`  address: ${address}`);
console.log(`  recorded in: ${outFile}`);
console.log(`\nSet GENLAYER_CONTRACT_ADDRESS=${address} to pin this deployment.`);
