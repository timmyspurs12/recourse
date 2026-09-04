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
  RecourseErrorCode,
  Settlement,
  SubmitDeliveryInput,
} from "@/lib/types";
import type { OrderDossier as DomainDossier } from "@/domain/model";
import { presentCase, presentDossier } from "@/server/presenter";
import { RecourseError } from "@/lib/types";

/**
 * HTTP adapter.
 *
 * Reads a remote Recourse deployment over the same public API the SDK uses,
 * then runs the responses through the same presenter the in-process adapter
 * uses. One mapping, one set of provenance rules, regardless of transport.
 *
 * Enable with RECOURSE_ADAPTER=http and RECOURSE_API_URL=https://…
 */
export function createHttpAdapter(baseUrl: string): RecourseApi {
  const root = baseUrl.replace(/\/$/, "");

  async function get<T>(path: string): Promise<T | null> {
    const response = await fetch(`${root}${path}`, { cache: "no-store" });
    if (response.status === 404) return null;
    const body = await response.json();
    if (!response.ok) {
      const error = (body as { error?: { code: RecourseErrorCode; message: string } }).error;
      throw new RecourseError(
        error?.code ?? "INTERNAL",
        error?.message ?? `Request failed with ${response.status}`,
        `GET ${path}`,
      );
    }
    return body as T;
  }

  async function post<T>(path: string, payload: unknown): Promise<T> {
    const response = await fetch(`${root}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) {
      const error = (body as { error?: { code: RecourseErrorCode; message: string } }).error;
      throw new RecourseError(
        error?.code ?? "INTERNAL",
        error?.message ?? `Request failed with ${response.status}`,
        `POST ${path}`,
      );
    }
    return body as T;
  }

  const dossier = async (orderId: string): Promise<OrderDossier | null> => {
    const domain = await get<DomainDossier>(`/api/orders/${orderId}`);
    return domain ? presentDossier(domain) : null;
  };

  return {
    name: "http",

    async getNetworkStatus(): Promise<NetworkStatus> {
      const info = await get<{
        mode: NetworkStatus["mode"];
        adjudication: { available: boolean; network: string | null };
        payment: { rail: string };
      }>("/api/network");

      return {
        mode: info?.mode ?? "SIMULATED",
        label: info?.adjudication.network ?? "NO ADJUDICATION FORUM",
        chain: info?.adjudication.available ? "GenLayer" : "none",
        adapter: `http · ${info?.payment.rail ?? "unknown"}`,
        blockHeight: {
          value: null,
          provenance: "NOT_AVAILABLE",
          note: "Block height is not exposed over the public API.",
        },
      };
    },

    async listOrders(): Promise<Order[]> {
      const body = await get<{ orders: Array<{ id: string }> }>("/api/orders");
      const dossiers = await Promise.all((body?.orders ?? []).map((o) => dossier(o.id)));
      return dossiers.filter((d): d is OrderDossier => d !== null).map((d) => d.order);
    },

    async getOrder(orderId: string): Promise<Order | null> {
      return (await dossier(orderId))?.order ?? null;
    },

    getOrderDossier: dossier,

    async getAgreement(orderId: string): Promise<Agreement | null> {
      return (await dossier(orderId))?.agreement ?? null;
    },

    async getDelivery(orderId: string): Promise<Delivery | null> {
      return (await dossier(orderId))?.delivery ?? null;
    },

    async getEvidence(orderId: string): Promise<Evidence[]> {
      return (await dossier(orderId))?.delivery?.evidence ?? [];
    },

    async listDisputes(): Promise<Dispute[]> {
      const body = await get<{ disputes: Array<{ orderId: string }> }>("/api/disputes");
      const dossiers = await Promise.all((body?.disputes ?? []).map((d) => dossier(d.orderId)));
      return dossiers
        .map((d) => d?.dispute ?? null)
        .filter((d): d is Dispute => d !== null);
    },

    async getDispute(disputeId: string): Promise<Dispute | null> {
      const domain = await get<DomainDossier>(`/api/disputes/${disputeId}`);
      return domain ? presentDossier(domain).dispute : null;
    },

    async getDisputeDossier(disputeId: string): Promise<OrderDossier | null> {
      const domain = await get<DomainDossier>(`/api/disputes/${disputeId}`);
      return domain ? presentDossier(domain) : null;
    },

    async getAdjudicationStatus(disputeId: string): Promise<Adjudication | null> {
      const domain = await get<DomainDossier>(`/api/disputes/${disputeId}`);
      return domain ? (presentDossier(domain).dispute?.adjudication ?? null) : null;
    },

    async getSettlement(orderId: string): Promise<Settlement | null> {
      return (await dossier(orderId))?.settlement ?? null;
    },

    async listCases(): Promise<CaseRecord[]> {
      const body = await get<{ disputes: Array<{ orderId: string }> }>("/api/disputes");
      const dossiers = await Promise.all(
        (body?.disputes ?? []).map((d) => get<DomainDossier>(`/api/orders/${d.orderId}`)),
      );
      return dossiers
        .filter((d): d is DomainDossier => d !== null)
        .map(presentCase)
        .filter((record): record is CaseRecord => record !== null);
    },

    async createPurchase(input: CreatePurchaseInput): Promise<Order> {
      const created = await post<DomainDossier>("/api/orders", {
        buyer: { handle: "shopper.agent" },
        merchant: { handle: input.merchantHandle },
        resource: { name: input.title, type: "digital_report" },
        amount: input.amount,
        currency: input.currency,
        terms: [],
      });
      return presentDossier(created).order;
    },

    async submitDelivery(input: SubmitDeliveryInput): Promise<Delivery> {
      const updated = await post<DomainDossier>(`/api/orders/${input.orderId}/delivery`, input);
      const delivery = presentDossier(updated).delivery;
      if (!delivery) throw new RecourseError("INTERNAL", "Delivery was not recorded", "");
      return delivery;
    },

    async openDispute(input: OpenDisputeInput): Promise<Dispute> {
      const updated = await post<DomainDossier>(`/api/orders/${input.orderId}/disputes`, {
        claim: input.claim,
      });
      const dispute = presentDossier(updated).dispute;
      if (!dispute) throw new RecourseError("INTERNAL", "Dispute was not recorded", "");
      return dispute;
    },
  };
}
