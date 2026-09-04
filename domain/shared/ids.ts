import { randomUUID } from "node:crypto";

/**
 * Human-inspectable identifiers.
 *
 * Order ids are sequential and readable (RC-000042) because a judge, a support
 * engineer and a merchant all have to be able to say them out loud. Everything
 * else is prefixed and opaque.
 */
export const ORDER_ID_PREFIX = "RC-";

export function formatOrderId(sequence: number): string {
  return `${ORDER_ID_PREFIX}${String(sequence).padStart(6, "0")}`;
}

export function orderRef(orderId: string): string {
  return orderId.replace(ORDER_ID_PREFIX, "RC/");
}

export function parseOrderSequence(orderId: string): number | null {
  if (!orderId.startsWith(ORDER_ID_PREFIX)) return null;
  const n = Number.parseInt(orderId.slice(ORDER_ID_PREFIX.length), 10);
  return Number.isFinite(n) ? n : null;
}

export function isOrderId(value: string): boolean {
  return /^RC-\d{6}$/.test(value);
}

function suffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export const newAgreementId = () => `agr_${suffix()}`;
export const newDeliveryId = () => `dlv_${suffix()}`;
export const newEvidenceId = () => `evd_${suffix()}`;
export const newDisputeId = (orderId: string) => `dsp_${orderId.toLowerCase()}`;
export const newAdjudicationId = () => `adj_${suffix()}`;
export const newSettlementId = () => `stl_${suffix()}`;
export const newEventId = () => `evt_${suffix()}`;
export const newPaymentId = () => `pay_${suffix()}`;
export const newIdempotencyKey = () => `idem_${suffix()}`;
