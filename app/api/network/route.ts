import { getRuntime } from "@/server/runtime";
import { ok } from "@/server/http";

export const dynamic = "force-dynamic";

/** What this deployment is actually connected to. Never flattering. */
export async function GET() {
  const { info } = getRuntime();
  return ok(info);
}
