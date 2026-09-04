# @recourse/sdk

**Programmable chargebacks for autonomous commerce.**

Your agent can already pay. This is how it gets its money back when what arrives is not what was
promised — without a support ticket, a human reviewer or a card network.

```bash
npm install @recourse/sdk
```

---

## The idea in one diff

An unprotected agent purchase is a payment and a hope:

```ts
await pay(merchant, "1.00");        // money gone
const brief = await fetchBrief();   // hope it is what you asked for
```

A protected one states the promise first, and keeps the money conditional on it:

```ts
import { RecourseClient, term } from "@recourse/sdk";
import { privateKeyToAccount } from "viem/accounts";

// Writes are signed as your agent. The key never leaves your process — the
// client only asks it to sign a canonical description of each request.
const account = privateKeyToAccount(process.env.AGENT_KEY as `0x${string}`);

const recourse = new RecourseClient({
  baseUrl: "https://your-recourse-deployment",
  signer: { handle: "shopper.agent", sign: (m) => account.signMessage({ message: m }) },
});

const { order } = await recourse.createProtectedPurchase({
  buyer: { handle: "shopper.agent" },
  merchant: { handle: "merchant.agent" },
  resource: { name: "Lagos Consumer Commerce Brief", type: "digital_report" },
  amount: "1.00",
  terms: [
    term.atLeast("minimum_sources", "Minimum sources", 5),
    term.atMost("max_source_age_days", "Maximum source age", 30, { unit: "days" }),
    term.matches("geography", "Geographic scope", "Lagos, Nigeria"),
    term.equals("required_sections", "Required sections", 4),
    term.judgment(
      "material_accuracy",
      "Material accuracy",
      "No material misstatement of the Lagos consumer market",
    ),
  ],
});
```

The agreement is canonicalised and hashed before any money moves, then locked at capture.
`order.id` looks like `RC-000042`; `agreement.hash` is a sha256 you can recompute yourself.

---

## Authentication

Every mutating call is signed; reads are public. The client builds and signs this canonical
string, so you never assemble it yourself:

```
recourse-request-v1
POST
/api/orders/RC-000042/disputes
1757000000000
<sha256 of the raw request body, hex>
```

sent as `x-recourse-agent`, `x-recourse-timestamp` and `x-recourse-signature`. Any EIP-191
`personal_sign` signer works — viem, ethers, or a browser wallet.

Because the signature covers a digest of the body, a proxy that rewrites your request breaks the
signature rather than silently changing what you agreed to. Signatures are single-use and expire
after five minutes.

**Authorization is separate and enforced by the protocol**, not by your client:

| Action | Who may do it |
| --- | --- |
| Submit a delivery | Only the merchant named in the locked agreement |
| Open a dispute | Either party — and the claimant is taken from your key, not your JSON |
| Refer to the forum | Either party |
| Settle | Either party (the outcome is already fixed by state) |
| Read anything | Anyone |

A handle is bound to a key in the deployment's registry. Ask the operator to register yours
(`npm run agents register <handle> <address>`), or — on deployments that allow it — let the first
signed request bind it automatically. Either way: pick your handle once and keep the key. If the
deployment runs with `RECOURSE_STRICT_REGISTRY=1`, an unregistered handle is refused outright.

## Terms

Term builders declare how a term is decided. This matters more than it looks:

| Builder | Operator | Decided by |
| --- | --- | --- |
| `term.atLeast(id, label, n)` | `GTE` | Arithmetic, in the protocol |
| `term.atMost(id, label, n)` | `LTE` | Arithmetic, in the protocol |
| `term.equals(id, label, v)` | `EQ` | Comparison, in the protocol |
| `term.matches(id, label, s)` | `MATCH` | Comparison, in the protocol |
| `term.judgment(id, label, q)` | `JUDGMENT` | An adjudication forum |

**Prefer deterministic terms.** They are instant, free, and impossible to argue with. Only
`term.judgment` can ever reach a model, and only when it is genuinely in contention. Counting
sources is not a judgment call, and the protocol will not treat it as one — an agreement that
tries to mark a comparison operator as semantic is rejected.

Every term is `mandatory: true` by default; pass `{ mandatory: false }` for terms that should be
reported but not breach the agreement.

---

## The full lifecycle

```ts
// MERCHANT: deliver, and declare what was delivered.
await recourse.submitDelivery(order.id, {
  statement: "Brief delivered in JSON.",
  artifactHash: "0x" + "a4".repeat(32),
  assertions: {
    sourceCount: 2,          // ← short by three
    geography: "Lagos, Nigeria",
    sectionCount: 4,
    maxSourceAgeDays: 11,
    format: "JSON",
    summary: "Consumer demand, pricing, channel and competitive set.",
  },
  evidence: [
    { kind: "survey", source: "Lagos Household Consumption Panel", sourceAgeDays: 9 },
    { kind: "pricing", source: "Kestrel Lagos price sweep", sourceAgeDays: 11 },
  ],
});

// Verification runs automatically. Read what it found:
const dossier = await recourse.getOrder(order.id);
dossier.verification?.checks;
// [{ termId: "minimum_sources", expression: "2 < 5", result: "BREACH", ... }, ...]

// BUYER: open a claim while the recourse window is open.
const { dispute } = await recourse.openDispute(order.id, {
  claim: "Five independent sources were required and two were supplied.",
});

// Refer the contested terms to the forum, then wait for consensus.
await recourse.submitAdjudication(dispute.id);
const adjudication = await recourse.awaitRuling(dispute.id, { timeoutMs: 300_000 });

if (adjudication.ruling?.decision === "BUYER_WINS") {
  const settled = await recourse.settle(order.id);
  settled.settlement?.outcome; // "REFUNDED"
}
```

`settle()` is idempotent. Call it twice and you get the same settlement, not two payouts.

---

## Paying with x402

If you already speak x402, Recourse slots in front of it. Create the order unfunded, do the
handshake, and pay:

```ts
const { order } = await recourse.createProtectedPurchase({ ...input, deferFunding: true });

// The resource answers 402 with real PaymentRequirements.
const requirements = await recourse.getPaymentRequirements(order.id);

// Sign an EIP-3009 TransferWithAuthorization with your own signer, then:
await recourse.pay(order.id, {
  scheme: "exact",
  network: requirements.network,
  payload: { authorization, signature },
});
```

The only difference from a bare x402 payment: `payTo` is the protocol escrow, not the merchant.
The money arrives already bound to the agreement, and where it ends up depends on whether the
promise was kept.

---

## Waiting honestly

`awaitRuling` polls until the forum reaches finality or the timeout expires. It never fabricates
progress. If it returns with `status: "PENDING"`, the ruling genuinely has not happened and the
escrow is still held — display that, do not round it up to a result.

```ts
const adjudication = await recourse.awaitRuling(dispute.id, { timeoutMs: 120_000 });

switch (adjudication.status) {
  case "FINALIZED": /* adjudication.ruling is present */ break;
  case "PENDING":   /* still in consensus; escrow held */ break;
  case "FAILED":    /* adjudication.failureReason explains why; escrow held */ break;
}
```

Validator detail (`adjudication.votes`, `networkStatus`, `transactionHash`) is passed through
exactly as the network reported it, and is `null` when the network has not reported it.

---

## Errors

Every failure is a `RecourseError` with a protocol-specific `code`, so callers can branch on the
invariant they hit rather than parsing strings.

```ts
import { RecourseError } from "@recourse/sdk";

try {
  await recourse.openDispute(order.id, { claim });
} catch (error) {
  if (error instanceof RecourseError) {
    switch (error.code) {
      case "DISPUTE_ALREADY_OPEN":   break;
      case "DISPUTE_WINDOW_CLOSED":  break;
      case "AGREEMENT_MUTATED":      break; // the stored promise no longer matches its hash
      default: throw error;
    }
  }
}
```

Common codes: `UNAUTHORIZED`, `RATE_LIMITED`, `AGREEMENT_MUTATED`, `EVIDENCE_MUTATED`,
`EVIDENCE_TOO_LARGE`, `INVALID_STATE_TRANSITION`, `DISPUTE_ALREADY_OPEN`,
`DISPUTE_WINDOW_CLOSED`, `DELIVERY_ALREADY_SUBMITTED`, `SETTLEMENT_UNAVAILABLE`,
`SETTLEMENT_ALREADY_EXECUTED`, `PAYMENT_INVALID`, `PAYMENT_REPLAYED`,
`ADJUDICATION_UNAVAILABLE`.

---

## Knowing what you are connected to

```ts
const info = await recourse.getNetworkInfo();
info.adjudication; // { available, network, contractAddress, description }
info.payment;      // { rail, network, settlesOnchain, note }
```

`settlesOnchain: false` means authorizations are cryptographically verified but nothing is
broadcast. Surface that to your users rather than implying a transfer occurred.

---

## API surface

| Method | Purpose |
| --- | --- |
| `createProtectedPurchase(input)` | Draft + hash + lock the agreement, capture escrow. Pass `deferFunding: true` to pay separately over x402 |
| `getPaymentRequirements(orderId)` | Perform the x402 402 handshake |
| `pay(orderId, authorization)` | Fund an accepted order with a signed authorization |
| `submitDelivery(orderId, input)` | Post fulfillment; runs deterministic verification |
| `openDispute(orderId, input)` | Open a recourse claim |
| `submitAdjudication(disputeId)` | Refer contested terms to the forum |
| `getAdjudication(disputeId)` | One poll |
| `awaitRuling(disputeId, opts)` | Poll to finality |
| `settle(orderId)` | Execute release or refund (idempotent) |
| `getOrder` · `listOrders` · `getDispute` · `listDisputes` | Reads |
| `getNetworkInfo()` | What this deployment is connected to |
