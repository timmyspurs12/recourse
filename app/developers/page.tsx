import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/layout/Footer";
import { Panel, PanelHeader, SectionLabel } from "@/components/system/Panel";
import { CodeBlock } from "@/components/system/CodeBlock";
import { Tag } from "@/components/system/StateBadge";
import { ActionLink } from "@/components/system/Actions";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "Integrate Recourse: lock a machine-readable agreement, pay under protection, submit delivery, open recourse, settle.",
};

const PURCHASE_EXAMPLE = `import { RecourseClient, term } from "@recourse/sdk"
import { privateKeyToAccount } from "viem/accounts"

// Writes are signed as your agent; the key never leaves your process.
const account = privateKeyToAccount(process.env.AGENT_KEY)
const recourse = new RecourseClient({
  baseUrl,
  signer: { handle: "shopper.agent", sign: (m) => account.signMessage({ message: m }) }
})

const { order, agreement } = await recourse.createProtectedPurchase({
  buyer: { handle: "shopper.agent" },
  merchant: { handle: "merchant.agent" },
  resource: { name: "Lagos Consumer Commerce Brief", type: "digital_report" },
  amount: "1.00",
  terms: [
    term.atLeast("minimum_sources", "Minimum sources", 5),
    term.atMost("max_source_age_days", "Maximum source age", 30, { unit: "days" }),
    term.matches("geography", "Geographic scope", "Lagos, Nigeria"),
    term.equals("required_sections", "Required sections", 4),
    term.judgment("material_accuracy", "Material accuracy",
      "No material misstatement of the Lagos consumer market")
  ]
})

// order.state      -> "ESCROWED"
// agreement.hash   -> sha256 of the canonical document, locked before capture`;

const DELIVERY_EXAMPLE = `await recourse.submitDelivery(order.id, {
  statement: "Brief delivered in JSON.",
  artifactHash: "0x" + "a4".repeat(32),
  assertions: {
    sourceCount: 2,            // short by three
    geography: "Lagos, Nigeria",
    sectionCount: 4,
    maxSourceAgeDays: 11,
    format: "JSON",
    summary: "Demand, pricing, channel, competition."
  },
  evidence: [
    { kind: "survey",  source: "Lagos Household Panel", sourceAgeDays: 9 },
    { kind: "pricing", source: "Kestrel price sweep",   sourceAgeDays: 11 }
  ]
})

// Verification runs on write, in code, with no model involved:
// checks -> [{ termId: "minimum_sources", expression: "2 < 5", result: "BREACH" }, ...]`;

const DISPUTE_EXAMPLE = `const { dispute } = await recourse.openDispute(order.id, {
  claim: "Five independent sources were required and two were supplied."
})

await recourse.submitAdjudication(dispute.id)
const adjudication = await recourse.awaitRuling(dispute.id)

// adjudication.status           -> "FINALIZED"
// adjudication.ruling.decision  -> "BUYER_WINS"
// adjudication.transactionHash  -> real GenLayer transaction
// adjudication.votes            -> per-validator votes, or null if not reported

if (adjudication.ruling?.decision === "BUYER_WINS") {
  await recourse.settle(order.id)   // idempotent
}`;

const TERMS_EXAMPLE = `// Deterministic: settled by the protocol, instantly, with no model.
term.atLeast("minimum_sources", "Minimum sources", 5)      // GTE
term.atMost("max_source_age_days", "Max age", 30)          // LTE
term.equals("required_sections", "Sections", 4)            // EQ
term.matches("geography", "Scope", "Lagos, Nigeria")       // MATCH

// Semantic: the only kind that can ever reach an adjudication forum.
term.judgment("material_accuracy", "Material accuracy",
  "No material misstatement of the Lagos consumer market")

// The protocol rejects an agreement that marks a comparison as semantic.
// Counting sources is not a judgment call and is never treated as one.`;

const CURL_EXAMPLE = `# The x402 handshake, for real.
curl -i localhost:3000/api/resource/RC-000042
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0cyI6W3sic2NoZW1lIjoi...

# Sign an EIP-3009 TransferWithAuthorization, then:
curl -X POST localhost:3000/api/orders/RC-000042/payment \\
  -H "PAYMENT-SIGNATURE: <base64 payload>" \\
  -H "x-recourse-agent: shopper.agent" \\
  -H "x-recourse-timestamp: 1757000000000" \\
  -H "x-recourse-signature: 0x..."
# Two independent signatures, two independent checks:
#   PAYMENT-SIGNATURE  -> who is paying, and exactly what for
#   x-recourse-*       -> who is making this API call
# Wrong recipient, wrong amount, expired window or reused nonce -> 402.
# Wrong agent key, tampered body, stale or replayed request     -> 403.`;

const AUTH_EXAMPLE = `// Canonical string the client signs for every mutating request.
recourse-request-v1
POST
/api/orders/RC-000042/disputes
1757000000000
<sha256 of the raw request body, hex>

// Sent as three headers:
//   x-recourse-agent      shopper.agent
//   x-recourse-timestamp  1757000000000
//   x-recourse-signature  0x...

// The protocol then answers a separate question: may this agent do this?
//   submit a delivery -> only the merchant on the locked agreement
//   open a dispute    -> either party, and the claimant comes from the key
//   settle            -> either party; the outcome is already fixed by state
//   read anything     -> anyone`;

const ENDPOINTS = [
  { op: "POST /api/orders", note: "Draft, hash and lock an agreement; capture escrow" },
  { op: "GET /api/orders/:id", note: "Full dossier: agreement, delivery, ruling, events" },
  { op: "GET /api/resource/:id", note: "x402 402 with PaymentRequirements until funded" },
  { op: "POST /api/orders/:id/payment", note: "Fund with a signed x402 authorization" },
  { op: "POST /api/orders/:id/delivery", note: "Submit fulfillment; runs verification" },
  { op: "POST /api/orders/:id/disputes", note: "Open a recourse claim" },
  { op: "POST /api/orders/:id/settlement", note: "Execute release or refund (idempotent)" },
  { op: "POST /api/disputes/:id/adjudication", note: "Refer contested terms to GenLayer" },
  { op: "GET /api/disputes/:id/adjudication", note: "Poll for consensus; never fakes progress" },
  { op: "GET /api/network", note: "Forum, network, payment rail and auth mode in use" },
];

export default function DevelopersPage() {
  const { info } = getRuntime();

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Developers"
        title="Give your agent a refund path."
        description="Recourse is one call around a payment your agent already makes. Lock the promise, pay under protection, and let the protocol handle what happens when delivery does not match."
        actions={
          <ActionLink href="/protocol" variant="secondary" size="md">
            Read the protocol
          </ActionLink>
        }
        meta={
          <div className="flex flex-col gap-2 border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
            <Tag size="xs">Running here</Tag>
            <p className="text-xs leading-relaxed text-fg-muted">
              These endpoints are live on this deployment. Adjudication runs against{" "}
              <span className="text-fg">
                {info.adjudication.available ? info.adjudication.network : "no forum (unconfigured)"}
              </span>
              . {info.payment.note}
            </p>
          </div>
        }
      />

      {/* ------------------------------------------------ purchase flow */}
      <section className="py-14 sm:py-16">
        <SectionLabel index="01">Protected purchase</SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-12">
          <div>
            <h2 className="text-2xl leading-tight tracking-[-0.02em] text-balance">
              Wrap the payment, not the product.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">
              The agreement is the integration. Whatever your agent buys, the terms it cares about
              become machine-checkable fields that are canonicalised, hashed and committed before
              value moves.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-fg-dim">
              The hash is recomputable by either party from the same JSON, so neither side can
              quietly change what was agreed after the fact.
            </p>
          </div>
          <CodeBlock
            code={PURCHASE_EXAMPLE}
            filename="purchase.ts"
            language="typescript"
            showLineNumbers
          />
        </div>
      </section>

      {/* -------------------------------------------------- delivery */}
      <section className="border-t border-line py-14 sm:py-16">
        <SectionLabel index="02">Delivery, dispute, ruling</SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CodeBlock code={DELIVERY_EXAMPLE} filename="delivery.ts" language="typescript" />
          <CodeBlock code={DISPUTE_EXAMPLE} filename="recourse.ts" language="typescript" />
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-dim">
          A merchant agent submits proof, not assurances. A buyer agent opens recourse against a
          specific term, not a general complaint. Both sides argue in the vocabulary the agreement
          was written in.
        </p>
      </section>

      {/* ----------------------------------------------------- terms */}
      <section className="border-t border-line py-14 sm:py-16">
        <SectionLabel index="03">Deterministic and semantic terms</SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-12">
          <CodeBlock code={TERMS_EXAMPLE} filename="terms.ts" language="typescript" />
          <div>
            <h2 className="text-2xl leading-tight tracking-[-0.02em] text-balance">
              Arithmetic is not judgment.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">
              Counting sources, comparing dates and matching strings are settled in code: instant,
              free, and impossible to argue with. They never touch a model.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-fg-dim">
              Only a genuinely semantic term — whether a shortfall is <em>material</em> to what the
              buyer contracted for — is referred to GenLayer, and only when a party contests it.
              The deterministic findings travel with it as established facts the forum may not
              recompute.
            </p>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- x402 */}
      <section className="border-t border-line py-14 sm:py-16">
        <SectionLabel index="04">x402, wrapped</SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-12">
          <CodeBlock code={CURL_EXAMPLE} filename="handshake.sh" language="bash" />
          <div>
            <h2 className="text-2xl leading-tight tracking-[-0.02em] text-balance">
              Recourse does not replace your rail.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">
              The 402 response, the payment requirements and the EIP-3009 authorization are
              standard x402. One thing changes: <code className="text-fg">payTo</code> is the
              protocol escrow, so the payment arrives already bound to an agreement.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-fg-dim">
              Where the money ends up is decided by whether the promise was kept. The dispute API
              is the same regardless of which rail carried the payment.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- auth */}
      <section className="border-t border-line py-14 sm:py-16">
        <SectionLabel index="05">Agent identity</SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-12">
          <div>
            <h2 className="text-2xl leading-tight tracking-[-0.02em] text-balance">
              Only the parties can move the money.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">
              Mutating requests carry a secp256k1 signature over a canonical description of the
              request, including a digest of the body. The server recovers the signer and compares
              it to the key bound to that handle.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-fg-dim">
              Authorization is answered by the protocol rather than the route, so the claimant on a
              dispute is derived from the authenticated key — a merchant cannot file a claim in the
              buyer&rsquo;s name. Reads stay public: a ledger nobody can inspect is not much of a
              ledger.
            </p>
          </div>
          <CodeBlock code={AUTH_EXAMPLE} filename="signing.txt" language="typescript" />
        </div>
      </section>

      {/* -------------------------------------------------- endpoints */}
      <section className="border-t border-line py-14 sm:py-16">
        <SectionLabel index="06">HTTP API</SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-12">
          <div>
            <h2 className="text-2xl leading-tight tracking-[-0.02em] text-balance">
              The SDK is a thin client over this.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">
              Server components read the protocol in-process; the SDK reads it over HTTP. Both go
              through the same domain service, so the UI and the API cannot drift apart.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-fg-dim">
              Every error carries a protocol-specific code —{" "}
              <code className="text-fg-muted">AGREEMENT_MUTATED</code>,{" "}
              <code className="text-fg-muted">DISPUTE_WINDOW_CLOSED</code>,{" "}
              <code className="text-fg-muted">PAYMENT_REPLAYED</code> — so callers branch on the
              invariant they hit rather than parsing strings.
            </p>
          </div>

          <Panel>
            <PanelHeader title="ENDPOINTS" meta="live on this deployment" />
            <ul className="divide-y divide-line">
              {ENDPOINTS.map((endpoint) => (
                <li
                  key={endpoint.op}
                  className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                >
                  <span className="font-mono text-xs text-fg">{endpoint.op}</span>
                  <span className="text-xs text-fg-dim sm:text-right">{endpoint.note}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-fg-dim">
              SDK reference:{" "}
              <code className="text-fg-muted">packages/recourse-sdk/README.md</code>. Architecture
              and deliberate omissions: <code className="text-fg-muted">ARCHITECTURE.md</code>.
            </p>
          </Panel>
        </div>
      </section>

      {/* ---------------------------------------------------- closing */}
      <section className="border-t border-line py-14 sm:py-20">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-[clamp(1.25rem,2.5vw,1.75rem)] leading-snug tracking-[-0.01em] text-balance">
            If your agent can pay autonomously, it should be able to get its money back
            autonomously.
          </p>
          <ActionLink href="/demo" variant="primary" size="lg">
            See it execute
          </ActionLink>
        </div>
      </section>
    </PageContainer>
  );
}
