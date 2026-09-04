import { createHttpAdapter } from "@/lib/adapters/http";
import { serverAdapter } from "@/lib/adapters/server";
import type { RecourseApi } from "@/lib/api/contract";

/**
 * Adapter resolution. The UI imports `api` and nothing else.
 *
 *   RECOURSE_ADAPTER=server  (default) reads the protocol in-process
 *   RECOURSE_ADAPTER=http    reads a remote Recourse deployment over /api
 *
 * Both adapters satisfy the same interface, so no page or component knows or
 * cares which one is in use.
 */

const adapterName = process.env.RECOURSE_ADAPTER ?? "server";
const baseUrl = process.env.RECOURSE_API_URL ?? "";

export const api: RecourseApi =
  adapterName === "http" ? createHttpAdapter(baseUrl) : serverAdapter;

/** True when the records on screen were seeded rather than produced by a live run. */
export const isDemoAdapter = false;

export type { RecourseApi } from "@/lib/api/contract";
