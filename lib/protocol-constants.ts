/**
 * Stable references into the seeded ledger.
 *
 * `npx tsx server/seed.ts` starts the order sequence at 38, so these ids are
 * deterministic across reseeds. Pages link to them; nothing depends on their
 * contents.
 */
export const FLAGSHIP_DISPUTE_ORDER_ID = "RC-000042";
export const FLAGSHIP_SUCCESS_ORDER_ID = "RC-000041";
export const FLAGSHIP_DISPUTE_ID = "dsp_rc-000042";
