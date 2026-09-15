import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  localnet,
  studioDevnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
} from "genlayer-js/chains";
import type { GenLayerChain } from "genlayer-js/types";

/**
 * GenLayer configuration.
 *
 * The hackathon runs on **Studio Next** (Consensus v0.6, chain id 61997). That
 * is the default here, because a submission that does not run on it is not
 * eligible.
 *
 * Two things about Studio Next are easy to get wrong, so both are handled
 * explicitly rather than left to a reader's judgement:
 *
 *  1. Chain identity and consensus contract addresses move together. The
 *     released RC's `studioDevnet` definition serves the same chain (61997) at
 *     the `studio-dev` hostname; `GENLAYER_RPC_URL`/the studio-next preset only
 *     changes the endpoint and the label, never the consensus contracts.
 *  2. Every deploy and write must carry a fee distribution and its quoted fee
 *     value. The quote is produced from a measured fee profile plus live
 *     network prices (see `fees.ts`), not from arithmetic done at submission
 *     time.
 */

export type NetworkKey =
  | "studio-next"
  | "studio-dev"
  | "localnet"
  | "studionet"
  | "testnet-asimov"
  | "testnet-bradbury";

/** Studio Next's canonical JSON-RPC endpoint, as published in the hackathon brief. */
export const STUDIO_NEXT_RPC_URL = "https://studio-next.genlayer.com/api";
export const STUDIO_NEXT_CHAIN_ID = 61997;

export interface NetworkDefinition {
  chain: GenLayerChain;
  label: string;
  /** Where a stranger can verify a ruling. Null when there is no public explorer. */
  explorer: string | null;
  /**
   * Whether deploy/write can be expected to need funds. This is a *description*
   * of the network and never a substitute for the live quote: a Studio
   * deployment can be gasless, and that is detected from the estimate result
   * rather than from the network's name.
   */
  feeBearing: boolean;
}

/*
 * Studio Next: the same chain object as the RC's studioDevnet (same chain id,
 * same consensus/fee-manager contracts) with the endpoint the brief publishes.
 */
const studioNext = {
  ...studioDevnet,
  name: "GenLayer Studio Next",
  rpcUrls: {
    default: {
      http: [STUDIO_NEXT_RPC_URL],
    },
  },
} as GenLayerChain;

const NETWORKS: Record<NetworkKey, NetworkDefinition> = {
  "studio-next": {
    chain: studioNext,
    label: "GENLAYER STUDIO NEXT",
    explorer: "https://explorer-studio-dev.genlayer.com/address/",
    feeBearing: true,
  },
  "studio-dev": {
    chain: studioDevnet as GenLayerChain,
    label: "GENLAYER STUDIO DEV",
    explorer: null,
    feeBearing: true,
  },
  localnet: {
    chain: localnet as GenLayerChain,
    label: "GENLAYER LOCALNET",
    explorer: null,
    feeBearing: false,
  },
  studionet: {
    chain: studionet as GenLayerChain,
    label: "GENLAYER STUDIONET",
    explorer: "https://studio.genlayer.com/contracts/",
    feeBearing: false,
  },
  "testnet-asimov": {
    chain: testnetAsimov as GenLayerChain,
    label: "GENLAYER TESTNET ASIMOV",
    explorer: "https://explorer-asimov.genlayer.com/address/",
    feeBearing: true,
  },
  "testnet-bradbury": {
    chain: testnetBradbury as GenLayerChain,
    label: "GENLAYER TESTNET BRADBURY",
    explorer: "https://explorer-bradbury.genlayer.com/address/",
    feeBearing: true,
  },
};

export const DEFAULT_NETWORK: NetworkKey = "studio-next";

export interface GenLayerConfig {
  networkKey: NetworkKey;
  chain: GenLayerChain;
  networkLabel: string;
  chainId: number;
  rpcUrl: string;
  explorer: string | null;
  isStudio: boolean;
  feeBearing: boolean;
  contractAddress: string | null;
  privateKey: `0x${string}` | null;
  /** Where the deploy script records the address it actually deployed to. */
  deploymentFile: string;
  /** Committed defaults, so a fresh clone points at a known deployment. */
  committedDeploymentFile: string;
  /** Measured fee profile consumed by the transaction kit, if one is committed. */
  feeProfileFile: string;
  /**
   * Anything the runtime had to decide on the operator's behalf — an unknown
   * network name, an ignored fee profile measured on a different chain, an RPC
   * override. Reported in `/api/network` rather than swallowed, because a
   * deployment that is quietly pointing at the wrong thing is worse than one
   * that says so.
   */
  warnings: string[];
}

interface DeploymentEntry {
  address?: string | null;
  deployedAt?: string | null;
  deployTx?: string | null;
}

interface DeploymentFile {
  network?: string;
  address?: string | null;
  deployments?: Record<string, DeploymentEntry>;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function resolveNetworkKey(requested: string | undefined): {
  key: NetworkKey;
  warning: string | null;
} {
  if (!requested || requested.trim() === "") {
    return { key: DEFAULT_NETWORK, warning: null };
  }
  const normalized = requested.trim().toLowerCase();
  if (normalized in NETWORKS) {
    return { key: normalized as NetworkKey, warning: null };
  }
  // `studio` and `studio-next` both mean the hackathon network; anything else
  // unknown falls back loudly rather than silently adjudicating elsewhere.
  if (normalized === "studio" || normalized === "studio_next" || normalized === "next") {
    return { key: "studio-next", warning: null };
  }
  return {
    key: DEFAULT_NETWORK,
    warning: `GENLAYER_NETWORK="${requested}" is not a known network (${Object.keys(NETWORKS).join(
      ", ",
    )}). Falling back to ${DEFAULT_NETWORK}.`,
  };
}

/**
 * The recorded deployment for a network, from the committed defaults or from a
 * deployment this machine made. Local deployments win: if a developer just
 * deployed, that address is the one they mean.
 */
export function resolveDeployedAddress(
  networkKey: NetworkKey,
  files: { local: DeploymentFile | null; committed: DeploymentFile | null },
): { address: string | null; source: "local" | "committed" | null } {
  const fromEntry = (file: DeploymentFile | null): string | null => {
    if (!file) return null;
    // New shape: { default, deployments: { [network]: { address } } }
    const entry = file.deployments?.[networkKey];
    if (entry?.address) return entry.address;
    // Legacy flat shape: { network, address }
    if (file.network === networkKey && file.address) return file.address;
    return null;
  };

  const local = fromEntry(files.local);
  if (local) return { address: local, source: "local" };
  const committed = fromEntry(files.committed);
  if (committed) return { address: committed, source: "committed" };
  return { address: null, source: null };
}

/** Environment-shaped input, so callers (including tests) can pass a literal. */
export type EnvLike = Record<string, string | undefined>;

export function loadGenLayerConfig(env: EnvLike = process.env): GenLayerConfig {
  const { key: networkKey, warning: networkWarning } = resolveNetworkKey(env.GENLAYER_NETWORK);
  const definition = NETWORKS[networkKey];
  const warnings: string[] = [];
  if (networkWarning) warnings.push(networkWarning);

  const rpcOverride = env.GENLAYER_RPC_URL?.trim();
  const chain = rpcOverride
    ? ({
        ...definition.chain,
        rpcUrls: { default: { http: [rpcOverride] } },
      } as GenLayerChain)
    : definition.chain;
  if (rpcOverride) {
    warnings.push(
      `GENLAYER_RPC_URL overrides the ${networkKey} endpoint (${definition.chain.rpcUrls.default.http[0]}).`,
    );
  }

  const deploymentFile = join(process.cwd(), ".recourse", "genlayer.json");
  const committedDeploymentFile = join(process.cwd(), "genlayer.deployment.json");
  const feeProfileFile = env.RECOURSE_FEE_PROFILE?.trim() || join(process.cwd(), "fee-profile.json");

  const explicit = env.GENLAYER_CONTRACT_ADDRESS?.trim();
  const resolved = explicit
    ? { address: explicit, source: "env" as const }
    : resolveDeployedAddress(networkKey, {
        local: readJson<DeploymentFile>(deploymentFile),
        committed: readJson<DeploymentFile>(committedDeploymentFile),
      });

  const rawKey = env.GENLAYER_PRIVATE_KEY?.trim();
  const privateKey = rawKey
    ? ((rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`)
    : null;

  if (definition.feeBearing && !privateKey) {
    warnings.push(
      `${definition.label} can charge fees and no GENLAYER_PRIVATE_KEY is set, so writes will be attempted with an unfunded ephemeral account. Whether any fee is actually charged is read from the live quote, not assumed.`,
    );
  }

  return {
    networkKey,
    chain,
    networkLabel: definition.label,
    chainId: chain.id,
    rpcUrl: chain.rpcUrls.default.http[0],
    explorer: definition.explorer,
    isStudio: Boolean((chain as GenLayerChain & { isStudio?: boolean }).isStudio),
    feeBearing: definition.feeBearing,
    contractAddress: resolved.address,
    privateKey,
    deploymentFile,
    committedDeploymentFile,
    feeProfileFile,
    warnings,
  };
}

export const ADJUDICATOR_SOURCE = join(process.cwd(), "contracts", "recourse_adjudicator.py");
