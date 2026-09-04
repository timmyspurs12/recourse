import { getRuntime } from "@/server/runtime";
import { ok, problem } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { protocol } = getRuntime();
    return ok({ disputes: await protocol.listDisputes() });
  } catch (error) {
    return problem(error);
  }
}
