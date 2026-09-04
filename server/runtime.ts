import { join } from "node:path";
import { RecourseProtocol } from "../domain/orders/service";
import type { AdjudicationForum, PaymentRail } from "../domain/ports";
import { JsonStore } from "../infra/store/json-store";
import { GenLayerForum, UnavailableForum } from "../integrations/genlayer/forum";
import { loadGenLayerConfig } from "../integrations/genlayer/config";
import { SimulatedRail } from "../integrations/simulated/rail";
import { X402Rail, loadX402Config } from "../integrations/x402/rail";
import { StoreAgentDirectory, authRequired, strictRegistry } from "./auth";

/**
 * Composition root.
 *
 * One process-wide protocol instance, assembled from whichever adapters the
 * environment actually provides. Nothing here decides protocol behaviour; it
 * only decides which real-world systems the protocol is plugged into.
 */

const globalRef = globalThis as unknown as {
  __recourseRuntime?: Runtime;
};

export interface Runtime {
  protocol: RecourseProtocol;
  store: JsonStore;
  rail: PaymentRail;
  forum: AdjudicationForum;
  directory: StoreAgentDirectory;
  info: RuntimeInfo;
}

export interface RuntimeInfo {
  /** What the user is actually looking at. Drives the network indicator. */
  mode: "LIVE" | "DEMO" | "SIMULATED";
  adjudication: {
    forum: "GENLAYER";
    available: boolean;
    network: string | null;
    contractAddress: string | null;
    description: string;
  };
  payment: {
    rail: string;
    network: string;
    settlesOnchain: boolean;
    note: string;
  };
  storeFile: string;
  auth: {
    /** Whether mutating endpoints demand a signed agent request. */
    required: boolean;
    scheme: string;
  };
}

function buildRail(): PaymentRail {
  const railId = process.env.RECOURSE_RAIL ?? "x402";
  return railId === "simulated" ? new SimulatedRail() : new X402Rail(loadX402Config());
}

function buildForum(): { forum: AdjudicationForum; genlayer: ReturnType<typeof loadGenLayerConfig> } {
  const config = loadGenLayerConfig();
  if (!config.contractAddress) {
    return { forum: new UnavailableForum(), genlayer: config };
  }
  return { forum: new GenLayerForum(config), genlayer: config };
}

export function getRuntime(): Runtime {
  if (globalRef.__recourseRuntime) return globalRef.__recourseRuntime;

  const storeFile =
    process.env.RECOURSE_STORE_FILE ?? join(process.cwd(), ".recourse", "ledger.json");
  const store = new JsonStore(storeFile);
  const rail = buildRail();
  const { forum, genlayer } = buildForum();

  const protocol = new RecourseProtocol({
    store,
    rail,
    forum,
    resourceBaseUrl: process.env.RECOURSE_RESOURCE_URL ?? "https://recourse.local/resource",
  });

  const info: RuntimeInfo = {
    // Adjudication is genuinely on-network; payment settlement is not. The
    // indicator reports the weaker of the two rather than the flattering one.
    mode: forum.available ? "DEMO" : "SIMULATED",
    adjudication: {
      forum: "GENLAYER",
      available: forum.available,
      network: forum.available ? genlayer.networkLabel : null,
      contractAddress: genlayer.contractAddress,
      description: forum.description,
    },
    payment: {
      rail: rail.id,
      network: rail.network,
      settlesOnchain: rail.settlesOnchain,
      note: rail.settlesOnchain
        ? "Payments settle through the configured x402 facilitator."
        : "x402 authorizations are cryptographically verified; on-chain settlement requires a funded facilitator and is not performed in this environment.",
    },
    storeFile,
    auth: {
      required: authRequired(),
      scheme: strictRegistry()
        ? "secp256k1 request signature, registered agents only"
        : "secp256k1 request signature, trust-on-first-use handle binding",
    },
  };

  const runtime: Runtime = {
    protocol,
    store,
    rail,
    forum,
    directory: new StoreAgentDirectory(store),
    info,
  };
  globalRef.__recourseRuntime = runtime;
  return runtime;
}
