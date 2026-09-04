import type { Delivery, EvidenceItem, MerchantAssertions } from "../model";
import { documentHash, hashEquals, type Json } from "../shared/canonical";
import { newDeliveryId, newEvidenceId } from "../shared/ids";
import { fail } from "../shared/errors";

/** Hard ceilings. Evidence is attacker-controlled; treat it like a file upload. */
export const EVIDENCE_LIMITS = {
  maxItems: 64,
  maxFieldChars: 2_000,
  maxSummaryChars: 4_000,
  maxTotalChars: 64_000,
} as const;

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Prompt-injection defence.
 *
 * Merchant text is DATA. It is never allowed to look like instructions, policy
 * or protocol output. We strip control characters, neutralise the delimiters we
 * use to frame untrusted blocks, and defang the phrasings that try to talk to
 * the model rather than describe the delivery.
 */
export function sanitizeUntrusted(input: string, maxChars: number = EVIDENCE_LIMITS.maxFieldChars): string {
  let text = String(input ?? "").replace(CONTROL_CHARS, " ");

  // Our framing delimiters must not be forgeable from inside the payload.
  text = text.replace(/<\/?untrusted[^>]*>/gi, "[removed]");
  text = text.replace(/```/g, "'''");

  // Instruction-shaped phrasing is annotated, not silently deleted, so the
  // dossier still shows what the merchant actually submitted.
  text = text.replace(
    /\b(ignore|disregard|override|forget)\s+(all\s+|any\s+|the\s+|previous\s+|above\s+|prior\s+)*(instructions?|rules?|prompts?|context|agreements?|terms?)\b/gi,
    "[instruction-shaped text removed]",
  );
  text = text.replace(
    /\b(system|developer|assistant)\s*(prompt|message|role)\b/gi,
    "[role-reference removed]",
  );
  text = text.replace(
    /\b(you\s+(are|must|should|will)\s+(now\s+)?(a|an|the)?\s*\w+)/gi,
    "[directive removed]",
  );
  text = text.replace(
    /\b(rule|decide|ruling|verdict|judgment)\s+(in\s+favou?r\s+of|for)\s+(the\s+)?(merchant|buyer|seller|shopper)\b/gi,
    "[outcome-directive removed]",
  );

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}…[truncated]`;
  }
  return text.trim();
}

export function evidenceChecksum(item: Omit<EvidenceItem, "checksum">): string {
  return documentHash({
    deliveryId: item.deliveryId,
    orderId: item.orderId,
    index: item.index,
    kind: item.kind,
    source: item.source,
    submittedAt: item.submittedAt,
    sourceAgeDays: item.sourceAgeDays,
  } as unknown as Json);
}

/** Hash over the whole delivery, fixing the evidence set at submission time. */
export function deliveryEvidenceHash(input: {
  deliveryId: string;
  orderId: string;
  artifactHash: string;
  assertions: MerchantAssertions;
  evidence: EvidenceItem[];
  submittedAt: string;
}): string {
  return documentHash({
    deliveryId: input.deliveryId,
    orderId: input.orderId,
    artifactHash: input.artifactHash,
    assertions: input.assertions as unknown as Json,
    evidence: input.evidence.map((item) => item.checksum),
    submittedAt: input.submittedAt,
  } as unknown as Json);
}

export interface EvidenceDraft {
  kind: string;
  source: string;
  sourceAgeDays?: number | null;
}

export interface BuildDeliveryInput {
  orderId: string;
  statement: string;
  artifactUrl?: string | null;
  artifactHash: string;
  assertions: MerchantAssertions;
  evidence: EvidenceDraft[];
  submittedAt: string;
  unavailableReason?: string | null;
}

function assertUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("EVIDENCE_INVALID", `Artifact URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    fail("EVIDENCE_INVALID", `Artifact URL must be http(s), received ${parsed.protocol}`);
  }
  return parsed.toString();
}

function assertHash(value: string): string {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) {
    fail("EVIDENCE_INVALID", `Artifact hash must be a 32-byte hex digest, received "${value}"`);
  }
  return value.toLowerCase();
}

/**
 * Builds an immutable delivery record. Everything merchant-supplied is
 * sanitised and bounded before it is stored, then hashed so later mutation is
 * detectable.
 */
export function buildDelivery(input: BuildDeliveryInput): Delivery {
  if (input.evidence.length > EVIDENCE_LIMITS.maxItems) {
    fail(
      "EVIDENCE_TOO_LARGE",
      `Delivery declares ${input.evidence.length} evidence items; the limit is ${EVIDENCE_LIMITS.maxItems}`,
    );
  }

  const totalChars =
    input.statement.length +
    input.assertions.summary.length +
    input.evidence.reduce((sum, item) => sum + item.source.length + item.kind.length, 0);
  if (totalChars > EVIDENCE_LIMITS.maxTotalChars) {
    fail("EVIDENCE_TOO_LARGE", `Delivery payload exceeds ${EVIDENCE_LIMITS.maxTotalChars} characters`);
  }

  const deliveryId = newDeliveryId();

  const assertions: MerchantAssertions = {
    sourceCount: Math.max(0, Math.trunc(Number(input.assertions.sourceCount) || 0)),
    sectionCount: Math.max(0, Math.trunc(Number(input.assertions.sectionCount) || 0)),
    maxSourceAgeDays: Math.max(0, Math.trunc(Number(input.assertions.maxSourceAgeDays) || 0)),
    geography: sanitizeUntrusted(input.assertions.geography, 120),
    format: sanitizeUntrusted(input.assertions.format, 40),
    summary: sanitizeUntrusted(input.assertions.summary, EVIDENCE_LIMITS.maxSummaryChars),
  };

  const evidence: EvidenceItem[] = input.evidence.map((draft, index) => {
    const base = {
      id: newEvidenceId(),
      deliveryId,
      orderId: input.orderId,
      index: index + 1,
      kind: sanitizeUntrusted(draft.kind, 60),
      source: sanitizeUntrusted(draft.source, 400),
      submittedAt: input.submittedAt,
      sourceAgeDays:
        draft.sourceAgeDays === null || draft.sourceAgeDays === undefined
          ? null
          : Math.max(0, Math.trunc(Number(draft.sourceAgeDays))),
    };
    return { ...base, checksum: evidenceChecksum(base) };
  });

  const artifactHash = assertHash(input.artifactHash);

  return {
    id: deliveryId,
    orderId: input.orderId,
    statement: sanitizeUntrusted(input.statement, EVIDENCE_LIMITS.maxFieldChars),
    artifactUrl: assertUrl(input.artifactUrl),
    artifactHash,
    assertions,
    evidence,
    evidenceHash: deliveryEvidenceHash({
      deliveryId,
      orderId: input.orderId,
      artifactHash,
      assertions,
      evidence,
      submittedAt: input.submittedAt,
    }),
    submittedAt: input.submittedAt,
    unavailableReason: input.unavailableReason ?? null,
  };
}

/** Detects any post-submission tampering with evidence. */
export function assertDeliveryIntegrity(delivery: Delivery): void {
  for (const item of delivery.evidence) {
    const { checksum, ...rest } = item;
    const recomputed = evidenceChecksum(rest);
    if (!hashEquals(recomputed, checksum)) {
      fail("EVIDENCE_MUTATED", `Evidence item ${item.index} does not match its checksum`, {
        expected: checksum,
        recomputed,
      });
    }
  }

  const recomputed = deliveryEvidenceHash({
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    artifactHash: delivery.artifactHash,
    assertions: delivery.assertions,
    evidence: delivery.evidence,
    submittedAt: delivery.submittedAt,
  });
  if (!hashEquals(recomputed, delivery.evidenceHash)) {
    fail("EVIDENCE_MUTATED", "Delivery evidence hash does not match the stored evidence", {
      expected: delivery.evidenceHash,
      recomputed,
    });
  }
}
