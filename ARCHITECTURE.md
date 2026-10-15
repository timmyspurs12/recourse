# Architecture

Every section is marked so a reader can tell implementation from intention:

- **[LIVE]** — implemented and exercised by tests or a real network call
- **[DEMO FIXTURE]** — real protocol execution, but seeded counterparties rather than real ones
- **[NOT PERFORMED]** — deliberately not done in this build, and never faked
- **[FUTURE]** — designed for, not built

---

## 1. The shape of the thing

Recourse is a protocol with a UI attached, not an app with some protocol logic in it. The
dependency direction is enforced:

```
app/ (routes, React)  ─────┐
packages/recourse-sdk ─────┼──▶  server/  ──▶  domain/  ──▶  ports (interfaces)
external callers (HTTP) ───┘                                      ▲
                                                                  │
                                        integrations/ + infra/ ───┘
```

`domain/` imports no framework, performs no I/O, and knows nothing about React, Next, GenLayer,
x402 or Postgres. It depends on three interfaces declared in `domain/ports.ts`:

| Port | Implementations |
| --- | --- |
| `RecourseStore` | `infra/store/json-store.ts` **[LIVE]** · Postgres **[FUTURE]**, DDL already written |
| `PaymentRail` | `integrations/x402/rail.ts` **[LIVE]** · `integrations/simulated/rail.ts` **[LIVE]** |
| `AdjudicationForum` | `integrations/genlayer/forum.ts` **[LIVE]** · `UnavailableForum` **[LIVE]** |

This is what makes the claim "one dispute API across payment rails" structural rather than
marketing: the dispute logic never learns which rail was used.

---

## 2. The protected transaction **[LIVE]**

The primary object is an order, and its life is a state machine with no illegal edges
(`domain/orders/state-machine.ts`):

```
OFFERED → ACCEPTED → ESCROWED → DELIVERED → VERIFICATION_PENDING ─┬─→ FULFILLED → RELEASED
                                                                  │
                                                                  └─→ DISPUTED → ADJUDICATING
                                                                                   │
                                                  ┌──── PROVISIONAL_RULING ◀───────┤  (v0.2)
                                                  │        │        ▲              │
                                                  │        ▼        │              │
                                                  │      APPEALED ──┘              │
                                                  ▼                                ▼
                                   ruled on finality only:  BUYER_WON    → REFUNDED
                                                            MERCHANT_WON → RELEASED
                                                            SPLIT_AWARDED → PARTIALLY_REFUNDED
```

**v0.2: an accepted ruling is provisional.** GenLayer reports a transaction `ACCEPTED` when
validators agree, but until its finality window closes the result can be appealed and recomputed.
So a ruling first lands in `PROVISIONAL_RULING`; an appeal moves it to `APPEALED` and back; and
the ruled states are entered **only on finality**. There is no edge from `PROVISIONAL_RULING` or
`APPEALED` to any settlement state, so settling on a ruling that can still change is not merely
refused by a check — it is unreachable. (`ADJUDICATING` may still go straight to a ruled state,
because a poll can first see a transaction after its window has already closed.)

`REFUNDED`, `PARTIALLY_REFUNDED`, `RELEASED` and `CANCELLED` are terminal: they have **no
outgoing edges at all**.
Double settlement is not prevented by a check that could be forgotten — it is unreachable. The
`transition()` function is the only way an order's state changes, and it throws
`INVALID_STATE_TRANSITION` on any edge not in the table.

Every transition appends to an event ledger (`ORDER_CREATED`, `AGREEMENT_LOCKED`,
`PAYMENT_ESCROWED`, `DELIVERY_POSTED`, `VERIFICATION_STARTED`, `BREACH_DETECTED`,
`DISPUTE_OPENED`, `ADJUDICATION_SUBMITTED`, `RULING_PROVISIONAL`, `APPEAL_FILED`,
`APPEAL_RESOLVED`, `FINALIZATION_SUBMITTED`, `RULING_FINALIZED`, `REFUND_EXECUTED`,
`PARTIAL_REFUND_EXECUTED`, `MERCHANT_PAID`). `RULING_FINALIZED` is emitted only on true finality.
The dossier pages render that ledger directly.

---

## 3. Agreements: hashed before the money moves **[LIVE]**

`domain/agreements/agreement.ts`

An agreement is a versioned document (`recourse/0.2`; `recourse/0.1` documents keep verifying
against the hashes they were locked with) canonicalised with sorted keys, no
insignificant whitespace and no floating-point amounts — amounts are decimal strings, always.
The canonical form is hashed with sha256, so both agents can derive the same hash independently
from the same JSON.

Ordering matters and is deliberate:

1. Draft the agreement and compute its hash.
2. Capture payment **against that hash**.
3. Lock the agreement in the same critical section as escrow creation.

After `lockedAt` is set the document is frozen. Every read path calls
`assertAgreementIntegrity()`, which recomputes the hash and raises `AGREEMENT_MUTATED` if the
stored document no longer matches. A merchant who quietly lowers a threshold after being paid
does not get a lenient verification — they get a hard failure.

---

## 4. Evidence: untrusted by construction **[LIVE]**

`domain/evidence/evidence.ts`

Merchant-supplied content is treated the way a competent service treats a file upload:

- **Bounded** — 64 items, 2,000 chars per field, 64,000 chars total; over the limit is a
  rejection (`EVIDENCE_TOO_LARGE`), never a silent truncation.
- **Sanitised** — control characters stripped; the `<untrusted>` delimiters used to frame it in
  prompts are unforgeable from inside the payload; instruction-shaped phrasing ("ignore all
  previous instructions", "you are now…", "rule in favour of the merchant", "system prompt") is
  replaced with a visible marker rather than deleted, so the dossier still shows what was
  actually submitted.
- **Hashed** — each item gets a checksum, and the delivery gets a hash over the whole set, so
  post-submission tampering is detectable (`EVIDENCE_MUTATED`).

Evidence is data to be weighed. It is never policy.

---

## 5. Verification: arithmetic is not judgment **[LIVE]**

`domain/verification/engine.ts`

Terms declare their own evaluation mode. `GTE`, `LTE`, `EQ` and `MATCH` are `DETERMINISTIC` and
are settled in code. Only `JUDGMENT` terms are `SEMANTIC`, and the agreement validator refuses
any combination that would let arithmetic be delegated to a model.

The engine produces raw comparisons (`2 < 5`), not verdicts. A breach of a mandatory
deterministic term is material *by construction*, because the parties agreed in advance that
that term was mandatory.

**This function never calls a model.** That is the single most important property in the
codebase, and `tests/lifecycle.test.ts` asserts the split (4 deterministic checks, 1 semantic
question) so it cannot silently regress.

---

## 6. Adjudication on GenLayer **[LIVE]**

`contracts/recourse_adjudicator.py` · `integrations/genlayer/forum.ts`

The v2 contract stores each ruling under **`<submitter>/<dispute_id>`**, together with the inputs
hash it was made against, and exposes `adjudicate(dispute_id, payload_json)`,
`get_ruling(submitter, dispute_id)`, `get_inputs_hash(submitter, dispute_id)`, `get_policy()` and
`get_ruling_count()`. The payload carries the agreement hash, the evidence hash, the hash of the
whole payload, the contested terms, the deterministic findings, the remedy mode the locked
agreement allows, and the two parties' statements framed as untrusted blocks.

*Why the key changed.* v1 keyed rulings by dispute id alone and `adjudicate` was public and
idempotent, so the first write for an id won. Dispute ids are derived from order numbers
(`dsp_rc-000042`), which repeat after a reseed and across clones pointed at the shared default
contract — so the protocol could read a ruling made against inputs it never sent, whether stale or
deliberately pre-empted. v2 namespaces by sender and refuses a second request for the same key with
different inputs; the forum additionally checks that the ruling echoes the inputs hash and submitter
it expects (for v1 contracts, it compares the separately stored inputs hash instead).

**Validator logic verifies substance.** Inside `gl.vm.run_nondet_default` (which already runs the
validator in a sandbox), each validator:

1. votes down a leader that failed, so an incoherent proposal rotates to a fresh leader;
2. canonicalises the leader's ruling and checks cross-field coherence — `BUYER_WINS` requires a
   material breach and a full refund; `MERCHANT_WINS` no breach and a release; `SPLIT` a material
   breach, a refund strictly between 0 and 100%, and a `GRADUATED` agreement; every violated term
   must be one that was actually contested;
3. **re-runs the judgment itself** and requires the same materiality finding and violated-term
   set — and then either the same decision (all-or-nothing) or a refund within
   `AGREEMENT_TOLERANCE_BPS` = one 10-point step (graduated).

Prose is expected to differ between validators; the substance is not. A validator that only asked
"is this valid JSON?" would be theatre. The client re-validates the same invariants on receipt
(`parseRuling`), so an incoherent ruling can never become actionable even if the contract were
replaced.

**Finality and appeals (v0.2).** The forum maps the v0.6 status table (v0.1 carried the v0.5 one,
under which code 13 — a transaction still being decided — read as a timeout):

| Network | Forum | Protocol |
| --- | --- | --- |
| `PENDING`…`REVEALING`, `LEADER_REVEALING`, unknown codes | `PENDING` | waits |
| `ACCEPTED` | `DECIDED`, ruling read from **latest-nonfinal** state | `PROVISIONAL_RULING`, escrow held |
| `APPEAL_COMMITTING` / `APPEAL_REVEALING` | `APPEALED` | `APPEALED`, escrow held |
| `FINALIZED` | `FINALIZED`, ruling read from **latest-final** state | ruled state; settlement allowed |
| `UNDETERMINED`, timeouts, `CANCELED` | `FAILED` | back to `ADJUDICATING`; resubmittable |

An appeal is GenLayer's own: `canAppeal` → `getAppealCharge` (bond + funding) →
`appealTransaction` on the **same** transaction, bound to the active decision. The protocol allows
it only to a party the ruling went against (either party for a split), once per party, one at a
time. It then decides the appeal is over only on evidence the appeal round actually ran — a round
seen in flight, a higher round count, another failed appeal, a new decision id, or finality — and
records it `UPHELD` or `REVISED` by comparing awards. Off Studio, the forum submits
`finalizeTransaction` itself once the lifecycle reports `Finalize` (`RECOURSE_AUTO_FINALIZE`).

Rulings recorded by v0.1 on acceptance are labelled as such in the UI and re-confirmed on-chain
(`FINALIZED`, same award) before they can settle.

**What is reported, and only what is reported:** transaction hash, network status, lifecycle
(decision id, next action), round count when the receipt carries one, and per-validator votes
exactly as they appear in the receipt. If no contract is deployed, `UnavailableForum` refuses to
rule and the order stays `ADJUDICATING` with escrow held — an unavailable forum is a legitimate
protocol state; a fake one is not.

Consensus takes tens of seconds, so submission and polling are separate: `POST` broadcasts and
returns, `GET` polls. Nothing blocks a request waiting for a network.

---

## 7. Payments over x402 **[LIVE cryptography, NOT PERFORMED settlement]**

`integrations/x402/rail.ts` · `integrations/x402/signer.ts`

**Implemented directly, not via an SDK.** There is no `@x402/*` dependency: the v2 message shapes
(`PaymentRequirements`, `PaymentPayload`, `x402Version: 2`) and the EIP-3009 typed-data signing are
written out in `integrations/x402/rail.ts` and `signer.ts` against the specification, using `viem`
for the cryptography. That is a deliberate trade — fewer moving parts and an auditable
implementation, at the cost of not inheriting upstream changes automatically. Verify it by reading
the file, not by checking `package.json`.

Recourse **wraps** x402 rather than replacing it. The resource endpoint
(`GET /api/resource/:orderId`) answers `402` with a `PAYMENT-REQUIRED` header carrying base64
`PaymentRequirements` in x402 v2 shape. The buyer signs an EIP-3009
`TransferWithAuthorization` as EIP-712 typed data. `POST /api/orders/:id/payment` accepts the
`PAYMENT-SIGNATURE` header, recovers the signer, and rejects:

- a recovered address that does not match the declared payer,
- a `to` that is not the escrow address (fund redirection),
- an amount that does not equal the requirement,
- an authorization outside its validity window,
- a nonce that has already been captured (`PAYMENT_REPLAYED`).

The one change Recourse makes to the x402 flow: `payTo` is the **protocol escrow**, not the
merchant. The payment therefore arrives already bound to an agreement, and release or refund is
a separate movement decided by the outcome.

**[NOT PERFORMED]** Broadcasting. Moving real USDC needs a funded facilitator and a funded buyer
wallet. Without `X402_FACILITATOR_URL`, settlement is recorded with
`execution: SIGNATURE_VERIFIED_LOCAL_ESCROW` and `transactionHash: null`, and the settlement
receipt says so in words. There are no invented transaction hashes anywhere in this repository.

**[FUTURE]** With a funded facilitator the same code path posts to `/settle` and records the
returned transaction — the branch exists in `settleViaFacilitator()`.

---

## 8. Storage **[LIVE file-backed, FUTURE Postgres]**

`infra/store/json-store.ts` implements `RecourseStore` with atomic writes (temp file + rename),
a serialised write chain, and a **per-order mutex** (`withOrderLock`) so concurrent settlement
attempts queue instead of racing. `tests/security.test.ts` fires four simultaneous settlements
and asserts exactly one settlement event.

The entity layout — `orders`, `agreements`, `agreement_terms`, `payments`, `deliveries`,
`evidence`, `verifications`, `disputes`, `adjudications`, `settlements`, `events` — matches
`infra/store/schema.sql` key for key. That DDL encodes the invariants in the database rather
than only in application code: `UNIQUE` on `settlements.order_id` (one settlement per order),
`UNIQUE` on `payments.reference` (no replay), `UNIQUE` on `disputes.order_id` (one dispute per
order). Moving to Postgres is a driver swap behind the existing port.

Order ids are human-inspectable and sequential (`RC-000042`), because a judge, a support
engineer and a merchant all have to be able to say them out loud.

---

## 9. Identity and authorization **[LIVE]**

`server/auth.ts` · `domain/identity/authorization.ts`

Two questions, deliberately answered in different layers:

**Authentication — "is this really shopper.agent?"** An agent signs a canonical description of the
request (`recourse-request-v1`, method, path, timestamp, sha256 of the raw body) with its key. The
server recovers the signer and compares it to the address bound to that handle. No shared secret,
no bearer token to leak, and the signature covers the body, so a tampered request recovers a
different address and is refused. Timestamps outside a five-minute window are rejected and every
signature is single-use, which bounds replay.

Key binding has two modes. **REGISTERED** bindings are declared ahead of time
(`npm run agents generate <handle>`), so nothing is taken on trust. **TOFU** bindings are
established by the first signed request from an unknown handle — convenient for development, and
honest about what it gives you: not proof of who an agent is in the world, only a guarantee that
whoever arrived first is the only party who can keep acting as that handle. Setting
`RECOURSE_STRICT_REGISTRY=1` disables TOFU, after which an unregistered handle is simply refused.

Bindings are persisted alongside the ledger through the same `RecourseStore` port (`agents` table
in the SQL schema), so they survive restarts, and `npm run seed` deliberately carries them across
— reseeding demo data must not silently revoke every agent's identity. **[FUTURE]** A DID resolver
would drop in behind `AgentDirectory` without changing anything above it.

**Authorization — "may shopper.agent do this?"** This lives in the domain, not in route handlers,
because it is a protocol rule: only the merchant named in the locked agreement may deliver against
it; only a party to an order may dispute or settle it; and the claimant on a dispute is *derived
from the authenticated identity* rather than read from the request body, so a merchant cannot file
a claim in the buyer's name. Reads are public.

## 10. The UI layer **[LIVE]**

Server components read the protocol in-process through `lib/adapters/server.ts` — no HTTP hop.
The same protocol instance backs `/api`, so the UI and SDK cannot drift.

`server/presenter.ts` maps domain records to view models and is the only place provenance is
assigned. Its rule: anything the protocol does not know becomes an `Attested` value with
`NOT_AVAILABLE` and a human-readable reason. `LIVE` means a real network or a real computation
produced it; `DEMO_FIXTURE` means a seeded run produced it; `SIMULATED` means no cryptography
was involved.

`/demo` is not animated. The client asks the server to take the next legal step
(`POST /api/demo/advance`), the server decides what "next" means by reading actual order state,
and the page re-renders whatever comes back. When the dispute path reaches GenLayer, the spinner
is a genuine wait for consensus. There are no `setTimeout` stages anywhere in the demo.

---

## 11. Deliberately not built **[FUTURE]**

Named so a reviewer does not have to wonder whether they were forgotten:

- **Key rotation and revocation.** A registered binding can be replaced by an operator via the CLI,
  but there is no signed self-service rotation (prove control of the current key, nominate the
  next) and no revocation list.
- **Appellant-funded appeal bonds.** Appeals are real and on-chain, but the bond is paid by the
  protocol's adjudication key, and a successful appellant's reward accrues to that key. Charging
  the appellant (or its escrow) needs custody this release does not have.
- **Leader appeals.** `UNDETERMINED` and timeout outcomes can be appealed on GenLayer; the protocol
  treats them as failed referrals and lets the dispute be resubmitted instead.
- **Delivered in v0.2** (formerly listed here): partial refunds — `SPLIT` rulings and two-leg
  settlement — and appeals with an `APPEALED` state. See [`MILESTONE.md`](MILESTONE.md).
- **Merchant-initiated disputes.** The domain accepts `openedBy: "MERCHANT"`; no UI drives it.
- **Multi-item orders and subscriptions.** One agreement, one delivery, one settlement today.
- **Automatic release timers.** `recourseWindowEndsAt` is persisted and enforced for disputes,
  but nothing sweeps expired windows into automatic release — that needs a scheduler.
- **On-chain escrow.** Escrow is a protocol-ledger position, not a smart-contract balance. The
  honest version of this product custodies funds in a contract on the payment chain.
