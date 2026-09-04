"use client";

import { useEffect } from "react";
import { PageContainer } from "@/components/layout/Footer";
import { ProtocolErrorState } from "@/components/system/States";
import { ActionButton, ActionLink } from "@/components/system/Actions";

/**
 * Protocol-specific failure state. "Something went wrong" tells an operator
 * nothing; this states what the frontend was reading and what it did not get.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[recourse] render failure", error);
  }, [error]);

  return (
    <PageContainer>
      <div className="py-20">
        <ProtocolErrorState
          code={error.digest ? `DIGEST ${error.digest}` : "ADAPTER_READ_FAILED"}
          title="Protocol record unavailable"
          description="The interface could not read this record from the configured data adapter, so nothing is being displayed rather than a partial or invented state."
          detail={error.message}
          action={
            <div className="flex flex-wrap gap-3">
              <ActionButton variant="primary" size="md" onClick={reset}>
                Retry read
              </ActionButton>
              <ActionLink href="/orders" variant="secondary" size="md">
                Return to ledger
              </ActionLink>
            </div>
          }
        />
      </div>
    </PageContainer>
  );
}
