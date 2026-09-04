import { readFileSync } from "node:fs";
import { join } from "node:path";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";

/**
 * GenLayer configuration.
 *
 * Defaults to studionet because it is a real GenLayer network with real
 * validators that does not require faucet tokens — a judge can run the full
 * adjudication path with no wallet setup. Point GENLAYER_NETWORK at
 * testnet-asimov (and supply a funded key) for a public testnet run.
 */
export type NetworkKey = "localnet" | "studionet" | "testnet-asimov" | "testnet-bradbury";

const CHAINS = {
  localnet,
  studionet,
  "testnet-asimov": testnetAsimov,
  "testnet-bradbury": testnetBradbury,
} as const;

export interface GenLayerConfig {
  networkKey: NetworkKey;
  chain: (typeof CHAINS)[NetworkKey];
  networkLabel: string;
  contractAddress: string | null;
  privateKey: `0x${string}` | null;
  /** Where the deploy script records the address it actually deployed to. */
  deploymentFile: string;
}

const LABELS: Record<NetworkKey, string> = {
  localnet: "GENLAYER LOCALNET",
  studionet: "GENLAYER STUDIONET",
  "testnet-asimov": "GENLAYER TESTNET ASIMOV",
  "testnet-bradbury": "GENLAYER TESTNET BRADBURY",
};

function readDeployment(file: string): { address?: string; network?: string } | null {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as { address?: string; network?: string };
  } catch {
    return null;
  }
}

export function loadGenLayerConfig(): GenLayerConfig {
  const networkKey = (process.env.GENLAYER_NETWORK as NetworkKey) || "studionet";
  const chain = CHAINS[networkKey] ?? studionet;
  const deploymentFile = join(process.cwd(), ".recourse", "genlayer.json");

  /*
   * Resolution order: explicit env, then a deployment this machine made, then
   * the deployment committed to the repository. The last one exists so a judge
   * can clone and adjudicate immediately without running a deploy first; if it
   * has been reaped by the network, the forum reports that honestly rather than
   * pretending to rule.
   */
  const local = readDeployment(deploymentFile);
  const committed = readDeployment(join(process.cwd(), "genlayer.deployment.json"));
  const contractAddress =
    process.env.GENLAYER_CONTRACT_ADDRESS ||
    (local?.network === networkKey ? (local?.address ?? null) : null) ||
    (committed?.network === networkKey ? (committed?.address ?? null) : null) ||
    null;

  const rawKey = process.env.GENLAYER_PRIVATE_KEY?.trim();
  const privateKey = rawKey
    ? ((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`)
    : null;

  return {
    networkKey,
    chain,
    networkLabel: LABELS[networkKey] ?? networkKey.toUpperCase(),
    contractAddress,
    privateKey,
    deploymentFile,
  };
}

export const ADJUDICATOR_SOURCE = join(process.cwd(), "contracts", "recourse_adjudicator.py");
