import type {
  Agreement,
  Adjudication,
  CaseRecord,
  CreatePurchaseInput,
  Delivery,
  Dispute,
  Evidence,
  NetworkStatus,
  Order,
  OrderDossier,
  OpenDisputeInput,
  Settlement,
  SubmitDeliveryInput,
} from "@/lib/types";

/**
 * The single surface the UI is allowed to talk to.
 *
 * Every page and component reads through this interface. Swapping the demo
 * adapter for a real backend adapter must not require touching the UI.
 */
export interface RecourseApi {
  readonly name: string;

  /* reads */
  getNetworkStatus(): Promise<NetworkStatus>;
  listOrders(): Promise<Order[]>;
  getOrder(orderId: string): Promise<Order | null>;
  getOrderDossier(orderId: string): Promise<OrderDossier | null>;
  getAgreement(orderId: string): Promise<Agreement | null>;
  getDelivery(orderId: string): Promise<Delivery | null>;
  getEvidence(orderId: string): Promise<Evidence[]>;
  listDisputes(): Promise<Dispute[]>;
  getDispute(disputeId: string): Promise<Dispute | null>;
  getDisputeDossier(disputeId: string): Promise<OrderDossier | null>;
  getAdjudicationStatus(disputeId: string): Promise<Adjudication | null>;
  getSettlement(orderId: string): Promise<Settlement | null>;
  listCases(): Promise<CaseRecord[]>;

  /* writes — shapes the backend must eventually accept */
  createPurchase(input: CreatePurchaseInput): Promise<Order>;
  submitDelivery(input: SubmitDeliveryInput): Promise<Delivery>;
  openDispute(input: OpenDisputeInput): Promise<Dispute>;
}
