import type { AgreementTerm } from "../domain/model";

/**
 * The demo scenario.
 *
 * One brief, one price, five conditions — chosen so that a judge can hold the
 * whole agreement in their head while watching it be enforced.
 */

export const BRIEF_TERMS: AgreementTerm[] = [
  {
    id: "minimum_sources",
    label: "Minimum sources",
    operator: "GTE",
    expected: 5,
    mandatory: true,
    evaluation: "DETERMINISTIC",
    description: "Independent sources corroborating the findings.",
  },
  {
    id: "max_source_age_days",
    label: "Maximum source age",
    operator: "LTE",
    expected: 30,
    unit: "days",
    mandatory: true,
    evaluation: "DETERMINISTIC",
    description: "No source older than the stated window.",
  },
  {
    id: "geography",
    label: "Geographic scope",
    operator: "MATCH",
    expected: "Lagos, Nigeria",
    mandatory: true,
    evaluation: "DETERMINISTIC",
    description: "The brief must cover the contracted market.",
  },
  {
    id: "required_sections",
    label: "Required sections",
    operator: "EQ",
    expected: 4,
    mandatory: true,
    evaluation: "DETERMINISTIC",
    description: "Demand, pricing, channel and competition.",
  },
  {
    id: "material_accuracy",
    label: "Material accuracy",
    operator: "JUDGMENT",
    expected: "No material misstatement of the Lagos consumer market",
    mandatory: true,
    evaluation: "SEMANTIC",
    description: "The only term the protocol cannot settle with arithmetic.",
  },
];

export const AGENTS = {
  /*
   * No settlement addresses are declared for the demo agents. Inventing one
   * would put a plausible-looking hex string on screen that corresponds to
   * nothing. The payer address shown after a run is the real ephemeral signer
   * that produced the x402 authorization.
   */
  shopper: { handle: "shopper.agent", operator: "Northwind Retail Ops" },
  merchant: { handle: "merchant.agent", operator: "Kestrel Research Collective" },
  procure: { handle: "procure.agent", operator: "Meridian Supply Desk" },
  datasmith: { handle: "datasmith.agent", operator: "Datasmith Labs" },
  atlas: { handle: "atlas.agent", operator: "Atlas Field Research" },
  ledgerworks: { handle: "ledgerworks.agent", operator: "Ledgerworks Data" },
} as const;

export const BRIEF = {
  name: "Lagos Consumer Commerce Brief",
  type: "digital_report",
  price: "1.00",
} as const;

/** A delivery that satisfies every mandatory term. */
export const GOOD_DELIVERY = {
  statement:
    "Brief delivered in JSON. Six independent sources, all within 30 days, Lagos-scoped, four required sections present.",
  artifactHash: `0x${"a4".repeat(32)}`,
  artifactUrl: "https://kestrel.example/briefs/lagos-consumer-commerce.json",
  assertions: {
    sourceCount: 6,
    geography: "Lagos, Nigeria",
    sectionCount: 4,
    maxSourceAgeDays: 12,
    format: "JSON",
    summary:
      "Consumer demand, pricing bands, channel mix and competitive set for Lagos, corroborated across six sources.",
  },
  evidence: [
    { kind: "survey", source: "Lagos Household Consumption Panel, wave 42", sourceAgeDays: 9 },
    { kind: "registry", source: "Nigeria Bureau of Statistics retail index", sourceAgeDays: 12 },
    { kind: "pricing", source: "Kestrel Lagos price sweep, 61 SKUs", sourceAgeDays: 4 },
    { kind: "interview", source: "Distributor interviews, Ikeja and Lekki", sourceAgeDays: 7 },
    { kind: "registry", source: "Corporate Affairs Commission filings", sourceAgeDays: 11 },
    { kind: "pricing", source: "Open marketplace listing scrape", sourceAgeDays: 3 },
  ],
} as const;

/**
 * A delivery that breaches exactly one mandatory term.
 *
 * Deliberately not fraudulent: the geography is right, the sources are fresh,
 * every section is present. It is short by three sources. A realistic
 * disagreement is far more instructive than an obvious scam.
 */
export const SHORT_DELIVERY = {
  statement:
    "Brief delivered in JSON. Lagos-scoped with all four sections. Two sources were available within the window; the remaining corroboration could not be secured before the deadline.",
  artifactHash: `0x${"b7".repeat(32)}`,
  artifactUrl: "https://kestrel.example/briefs/lagos-consumer-commerce-partial.json",
  assertions: {
    sourceCount: 2,
    geography: "Lagos, Nigeria",
    sectionCount: 4,
    maxSourceAgeDays: 11,
    format: "JSON",
    summary:
      "Consumer demand, pricing bands, channel mix and competitive set for Lagos, corroborated across two sources.",
  },
  evidence: [
    { kind: "survey", source: "Lagos Household Consumption Panel, wave 42", sourceAgeDays: 9 },
    { kind: "pricing", source: "Kestrel Lagos price sweep, 61 SKUs", sourceAgeDays: 11 },
  ],
} as const;

export const BUYER_CLAIM =
  "The agreement required at least five independent sources because this brief sizes a market entry. Two were supplied. The corroboration I paid for is not present.";
