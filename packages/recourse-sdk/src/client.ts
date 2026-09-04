import { signRequest, type AgentSigner } from "./signing";
import {
  RecourseError,
  type Adjudication,
  type AgentRef,
  type AgreementTerm,
  type Dispute,
  type Dossier,
  type Order,
  type PaymentRequirements,
} from "./types";

/**
 * Recourse client.
 *
 * The whole point of this SDK is that adding recourse to an existing agent
 * purchase is a small diff. You already know how to pay; this adds the promise
 * the payment is conditional on, and the refund path if it is broken.
 *
 *   const recourse = new RecourseClient({ baseUrl });
 *   const order = await recourse.createProtectedPurchase({ ... });
 *   await recourse.submitDelivery(order.id, { ... });
 *   const dispute = await recourse.openDispute(order.id, { claim });
 *   const ruling = await recourse.awaitRuling(dispute.id);
 *   await recourse.settle(order.id);
 */

export interface RecourseClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /**
   * Signs mutating requests as a given agent.
   *
   * Deployments enforce this by default: an unsigned write is rejected with
   * UNAUTHORIZED. The key never leaves your process — the client only ever
   * asks it to sign a canonical description of the request.
   *
   *   import { privateKeyToAccount } from "viem/accounts";
   *   const account = privateKeyToAccount(process.env.AGENT_KEY);
   *   new RecourseClient({
   *     baseUrl,
   *     signer: { handle: "shopper.agent", sign: (m) => account.signMessage({ message: m }) },
   *   });
   */
  signer?: AgentSigner;
}

export interface CreateProtectedPurchaseInput {
  buyer: AgentRef;
  merchant: AgentRef;
  resource: { name: string; type: string };
  amount: string;
  currency?: "USDC";
  terms: AgreementTerm[];
  deliveryDeadlineHours?: number;
  recourseWindowHours?: number;
  /** Leave the order unfunded so it can be paid via the x402 handshake. */
  deferFunding?: boolean;
  /** A signed x402 authorization, when funding immediately. */
  payment?: { scheme: string; network: string; payload: Record<string, unknown> };
}

export interface SubmitDeliveryInput {
  statement: string;
  artifactUrl?: string | null;
  artifactHash: string;
  assertions: {
    sourceCount: number;
    geography: string;
    sectionCount: number;
    maxSourceAgeDays: number;
    format: string;
    summary: string;
  };
  evidence: Array<{ kind: string; source: string; sourceAgeDays?: number | null }>;
}

export interface OpenDisputeInput {
  claim: string;
  contestedTermIds?: string[];
  openedBy?: "BUYER" | "MERCHANT";
}

export class RecourseClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly signer?: AgentSigner;

  constructor(options: RecourseClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.signer = options.signer;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();
    const rawBody = typeof init?.body === "string" ? init.body : "";

    // Reads are public; writes are signed when a signer is configured.
    const signature =
      this.signer && method !== "GET"
        ? await signRequest(this.signer, { method, path, body: rawBody })
        : {};

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...signature,
        ...(init?.headers ?? {}),
      },
    });

    const text = await response.text();
    const body = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const error = (body as { error?: { code: string; message: string; detail?: unknown } }).error;
      throw new RecourseError(
        error?.code ?? "INTERNAL",
        error?.message ?? `Request failed with ${response.status}`,
        response.status,
        error?.detail,
      );
    }
    return body as T;
  }

  /* ------------------------------------------------------------- purchase */

  /** Creates a protected purchase: agreement hashed and locked, escrow funded. */
  async createProtectedPurchase(input: CreateProtectedPurchaseInput): Promise<Dossier> {
    return this.request<Dossier>("/api/orders", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * Fetches x402 payment requirements for an unfunded order by performing the
   * real handshake: the resource answers 402 with what it will accept.
   */
  async getPaymentRequirements(orderId: string): Promise<PaymentRequirements> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/resource/${orderId}`);
    if (response.status !== 402) {
      throw new RecourseError(
        "PAYMENT_NOT_REQUIRED",
        `Resource for ${orderId} is not awaiting payment (status ${response.status})`,
        response.status,
      );
    }
    const body = (await response.json()) as { accepts: PaymentRequirements[] };
    return body.accepts[0]!;
  }

  /** Funds an accepted order with a signed x402 authorization. */
  async pay(
    orderId: string,
    authorization: { scheme: string; network: string; payload: Record<string, unknown> },
  ): Promise<Dossier> {
    return this.request<Dossier>(`/api/orders/${orderId}/payment`, {
      method: "POST",
      body: JSON.stringify(authorization),
    });
  }

  /* ------------------------------------------------------------- delivery */

  /** Merchant-side: post fulfillment and trigger deterministic verification. */
  async submitDelivery(orderId: string, input: SubmitDeliveryInput): Promise<Dossier> {
    return this.request<Dossier>(`/api/orders/${orderId}/delivery`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /* -------------------------------------------------------------- dispute */

  /** Buyer-side: open a recourse claim while the window is open. */
  async openDispute(orderId: string, input: OpenDisputeInput): Promise<Dossier> {
    return this.request<Dossier>(`/api/orders/${orderId}/disputes`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Submits the contested terms to the adjudication forum. Returns immediately. */
  async submitAdjudication(disputeId: string): Promise<{ adjudication: Adjudication }> {
    return this.request<{ adjudication: Adjudication }>(
      `/api/disputes/${disputeId}/adjudication`,
      { method: "POST" },
    );
  }

  /** One poll of the forum. */
  async getAdjudication(disputeId: string): Promise<{ adjudication: Adjudication }> {
    return this.request<{ adjudication: Adjudication }>(`/api/disputes/${disputeId}/adjudication`);
  }

  /**
   * Polls until the forum reaches finality.
   *
   * Consensus takes tens of seconds. This never fabricates progress: if the
   * timeout is reached the adjudication is still PENDING and the escrow is
   * still held.
   */
  async awaitRuling(
    disputeId: string,
    options?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
  ): Promise<Adjudication> {
    const timeoutMs = options?.timeoutMs ?? 300_000;
    const intervalMs = options?.intervalMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;

    let latest = (await this.getAdjudication(disputeId)).adjudication;
    while (Date.now() < deadline) {
      if (latest?.status === "FINALIZED" || latest?.status === "FAILED") return latest;
      if (options?.signal?.aborted) throw new RecourseError("ABORTED", "Polling aborted", 499);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      latest = (await this.getAdjudication(disputeId)).adjudication;
    }
    return latest;
  }

  /* ------------------------------------------------------------ settlement */

  /** Executes release or refund. Idempotent: safe to retry. */
  async settle(orderId: string): Promise<Dossier> {
    return this.request<Dossier>(`/api/orders/${orderId}/settlement`, { method: "POST" });
  }

  /* ----------------------------------------------------------------- reads */

  async getOrder(orderId: string): Promise<Dossier> {
    return this.request<Dossier>(`/api/orders/${orderId}`);
  }

  async listOrders(): Promise<Order[]> {
    return (await this.request<{ orders: Order[] }>("/api/orders")).orders;
  }

  async listDisputes(): Promise<Dispute[]> {
    return (await this.request<{ disputes: Dispute[] }>("/api/disputes")).disputes;
  }

  async getDispute(disputeId: string): Promise<Dossier> {
    return this.request<Dossier>(`/api/disputes/${disputeId}`);
  }

  /** What this deployment is connected to: forum, network, payment rail. */
  async getNetworkInfo(): Promise<{
    mode: string;
    adjudication: {
      available: boolean;
      network: string | null;
      contractAddress: string | null;
      description: string;
    };
    payment: { rail: string; network: string; settlesOnchain: boolean; note: string };
  }> {
    return this.request("/api/network");
  }
}
