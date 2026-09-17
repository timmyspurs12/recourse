import { getRuntime } from "@/server/runtime";
import { ok } from "@/server/http";

export const dynamic = "force-dynamic";

/** What this deployment is actually connected to. Never flattering. */
export async function GET() {
  const { info, forum } = getRuntime();

  /*
   * `info` is assembled once and cached for the life of the process, which is
   * right for everything in it that cannot change — chain, endpoint, contract
   * address — and wrong for the one field that can.
   *
   * The signing address is discovered when the forum first submits, not at
   * boot: on a fee-bearing network with no `GENLAYER_PRIVATE_KEY` it is an
   * ephemeral key generated per submission. A snapshot taken before the first
   * adjudication therefore reports `null` forever, on a deployment that may be
   * signing rulings happily. Read it at request time instead.
   *
   * Understating what the deployment can do is still not telling the truth
   * about it, and this endpoint is the one a reviewer checks.
   */
  return ok({
    ...info,
    adjudication: {
      ...info.adjudication,
      signer: forum.signer ?? null,
    },
  });
}
