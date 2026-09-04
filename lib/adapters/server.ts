import "server-only";
import type { RecourseApi } from "@/lib/api/contract";
import type {
  Adjudication,
  Agreement,
  CaseRecord,
  CreatePurchaseInput,
  Delivery,
  Dispute,
  Evidence,
  NetworkStatus,
  OpenDisputeInput,
  Order,
  OrderDossier,
  Settlement,
  SubmitDeliveryInput,
} from "@/lib/types";
import { getRuntime } from "@/server/runtime";
import {
  presentCase,
  presentDossier,
} from "@/server/presenter";
import { BRIEF_TERMS } from "@/server/scenario";
import type { AgreementTerm } from "@/domain/model";

/** Maps the UI's purchase configuration onto machine-readable terms. */
function termsFrom(config: CreatePurchaseInput["agreement"]): AgreementTerm[] {
  const overrides: Record<string, string | number> = {
    minimum_sources: config.minimumSources,
    max_source_age_days: config.maxSourceAgeDays,
    required_sections: config.requiredSections,
    geography: config.geography,
  };
  return BRIEF_TERMS.map((term) =>
    overrides[term.id] === undefined ? term : { ...term, expected: overrides[term.id] },
  );
}

/**
 * Server adapter.
 *
 * Server components read the protocol directly through this adapter — no HTTP
 * hop, no serialisation round trip. The same protocol instance backs the public
 * /api routes, so the UI and the SDK can never drift apart.
 */

let blockHeightCache: { value: number | null; at: number } = { value: null, at: 0 };

async function readBlockHeight(): Promise<number | null> {
  const { forum } = getRuntime();
  if (!forum.available) return null;
  if (Date.now() - blockHeightCache.at < 15_000) return blockHeightCache.value;

  const endpoints: Record<string, string> = {
    studionet: "https://studio.genlayer.com/api",
    "testnet-asimov": "https://rpc-asimov.genlayer.com",
    "testnet-bradbury": "https://rpc-bradbury.genlayer.com",
    localnet: "http://127.0.0.1:4000/api",
  };
  const url = endpoints[process.env.GENLAYER_NETWORK ?? "studionet"];
  if (!url) return null;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    const body = (await response.json()) as { result?: string };
    const value = body.result ? Number.parseInt(body.result, 16) : null;
    blockHeightCache = { value: Number.isFinite(value) ? value : null, at: Date.now() };
    return blockHeightCache.value;
  } catch {
    blockHeightCache = { value: null, at: Date.now() };
    return null;
  }
}

async function dossierFor(orderId: string): Promise<OrderDossier | null> {
  const { protocol } = getRuntime();
  const order = await protocol.getOrder(orderId);
  if (!order) return null;
  return presentDossier(await protocol.dossier(orderId));
}

export const serverAdapter: RecourseApi = {
  name: "server",

  async getNetworkStatus(): Promise<NetworkStatus> {
    const { info } = getRuntime();
    const height = await readBlockHeight();

    return {
      mode: info.mode,
      label: info.adjudication.network ?? "NO ADJUDICATION FORUM",
      chain: info.adjudication.available ? "GenLayer" : "none",
      adapter: `${info.payment.rail} + ${info.adjudication.available ? "genlayer" : "unavailable"}`,
      blockHeight:
        height === null
          ? {
              value: null,
              provenance: "NOT_AVAILABLE",
              note: "No adjudication network is connected.",
            }
          : { value: height, provenance: "LIVE" },
    };
  },

  async listOrders(): Promise<Order[]> {
    const { protocol } = getRuntime();
    const orders = await protocol.listOrders();
    const dossiers = await Promise.all(orders.map((order) => protocol.dossier(order.id)));
    return dossiers.map((dossier) => presentDossier(dossier).order);
  },

  async getOrder(orderId: string): Promise<Order | null> {
    return (await dossierFor(orderId))?.order ?? null;
  },

  async getOrderDossier(orderId: string): Promise<OrderDossier | null> {
    return dossierFor(orderId);
  },

  async getAgreement(orderId: string): Promise<Agreement | null> {
    return (await dossierFor(orderId))?.agreement ?? null;
  },

  async getDelivery(orderId: string): Promise<Delivery | null> {
    return (await dossierFor(orderId))?.delivery ?? null;
  },

  async getEvidence(orderId: string): Promise<Evidence[]> {
    return (await dossierFor(orderId))?.delivery?.evidence ?? [];
  },

  async listDisputes(): Promise<Dispute[]> {
    const { protocol } = getRuntime();
    const disputes = await protocol.listDisputes();
    const dossiers = await Promise.all(
      disputes.map((dispute) => protocol.dossier(dispute.orderId)),
    );
    return dossiers
      .map((dossier) => presentDossier(dossier).dispute)
      .filter((dispute): dispute is Dispute => dispute !== null);
  },

  async getDispute(disputeId: string): Promise<Dispute | null> {
    const { protocol } = getRuntime();
    const dossier = await protocol.dossierByDispute(disputeId);
    return dossier ? presentDossier(dossier).dispute : null;
  },

  async getDisputeDossier(disputeId: string): Promise<OrderDossier | null> {
    const { protocol } = getRuntime();
    const dossier = await protocol.dossierByDispute(disputeId);
    return dossier ? presentDossier(dossier) : null;
  },

  async getAdjudicationStatus(disputeId: string): Promise<Adjudication | null> {
    const { protocol } = getRuntime();
    const dossier = await protocol.dossierByDispute(disputeId);
    return dossier ? (presentDossier(dossier).dispute?.adjudication ?? null) : null;
  },

  async getSettlement(orderId: string): Promise<Settlement | null> {
    return (await dossierFor(orderId))?.settlement ?? null;
  },

  async listCases(): Promise<CaseRecord[]> {
    const { protocol } = getRuntime();
    const disputes = await protocol.listDisputes();
    const dossiers = await Promise.all(
      disputes.map((dispute) => protocol.dossier(dispute.orderId)),
    );
    return dossiers
      .map((dossier) => presentCase(dossier))
      .filter((record): record is CaseRecord => record !== null);
  },

  async createPurchase(input: CreatePurchaseInput): Promise<Order> {
    const { protocol } = getRuntime();
    const dossier = await protocol.createProtectedPurchase({
      buyer: { handle: "shopper.agent" },
      merchant: { handle: input.merchantHandle },
      resource: { name: input.title, type: "digital_report" },
      amount: input.amount,
      currency: input.currency,
      terms: termsFrom(input.agreement),
    });
    return presentDossier(dossier).order;
  },

  async submitDelivery(input: SubmitDeliveryInput): Promise<Delivery> {
    const { protocol } = getRuntime();
    const dossier = await protocol.submitDelivery({
      orderId: input.orderId,
      statement: input.statement,
      artifactHash: `0x${"00".repeat(32)}`,
      assertions: {
        sourceCount: input.evidence.length,
        geography: "",
        sectionCount: 0,
        maxSourceAgeDays: 0,
        format: "JSON",
        summary: input.statement,
      },
      evidence: input.evidence.map((item) => ({
        kind: item.kind,
        source: item.source,
        sourceAgeDays: item.sourceAgeDays ?? null,
      })),
    });
    const presented = presentDossier(dossier).delivery;
    if (!presented) throw new Error("Delivery was not recorded");
    return presented;
  },

  async openDispute(input: OpenDisputeInput): Promise<Dispute> {
    const { protocol } = getRuntime();
    const dossier = await protocol.openDispute({
      orderId: input.orderId,
      claim: input.claim,
    });
    const presented = presentDossier(dossier).dispute;
    if (!presented) throw new Error("Dispute was not recorded");
    return presented;
  },
};
