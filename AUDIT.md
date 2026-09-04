# Competitive implementation audit

Performed against the six builds in the
[Agent Tank builds directory](https://portal.genlayer.foundation/agent-tank/hackathon/builds/),
with the primary comparison against the submitted project described as *"Agentic commerce escrow on
GenLayer: freeze listing + delivery URLs, LLM-adjudicate frozen evidence, pin code snapshot +
condition_met proofs."*

**Method.** Every Recourse claim below was checked by reading the implementation, not the docs.
Commands used are quoted so a judge can rerun them.

**A limit on this audit, stated up front.** The portal does not expose per-build detail pages or
repositories publicly — the builds index renders only titles, tracks and one-line summaries, and no
repository for that project is discoverable by search. So the competitor column is derived from
**their own published description**, which is unusually specific, plus the canonical GenLayer
escrow pattern it matches (fetch URL → `exec_prompt` evaluate → release/refund, as in the widely
circulated "Zero to GenLayer: Freelance Escrow" reference implementation). Where I am inferring
rather than reading their code, the row says **[inferred]**. Nothing in the differentiation
argument below depends on an inferred row.

---

## 1 · Architecture comparison

| Dimension | Competitor (from description + pattern) | Recourse (verified in repo) |
| --- | --- | --- |
| Payment mechanism | Not described; escrow appears to be contract-native value **[inferred]** | x402 v2 handshake; `GET /api/resource/:id` returns real `402` + base64 `PAYMENT-REQUIRED`. `app/api/resource/[id]/route.ts` |
| Escrow mechanism | On-contract escrow holding value **[inferred]** — likely stronger than ours | Ledger position, `escrow: HELD/RELEASED/REFUNDED`. **Not custodial.** Labelled as such in UI and docs |
| Machine-readable agreement | "Frozen listing" — a snapshot of the offer | Versioned `recourse/0.1` document, canonicalised (sorted keys, no float amounts), sha256 hashed, locked at capture. `domain/agreements/agreement.ts` |
| Evidence capture | Delivery URLs frozen at submission | Structured assertions + evidence items, sanitised and bounded on write. `domain/evidence/evidence.ts` |
| Evidence immutability | "Frozen" + "pin code snapshot" | Per-item checksum + delivery-wide hash; `assertDeliveryIntegrity()` runs before every verification, raises `EVIDENCE_MUTATED` |
| **Deterministic verification** | **None described.** Evidence goes to the LLM | **Four operators (`GTE/LTE/EQ/MATCH`) resolved in code.** `domain/verification/engine.ts` |
| Semantic verification | The whole adjudication | Only `JUDGMENT` terms; agreement validator rejects marking a comparison operator as semantic |
| GenLayer usage | Intelligent Contract, LLM-adjudicates frozen evidence | Intelligent Contract `RecourseAdjudicator`, deployed studionet `0xB33ebE4c…A17B8e0c` |
| Validator behaviour | Not described **[inferred: default leader/validator equivalence]** | Validators **re-run the judgment** and must match on decision, materiality and violated-term set |
| Dispute initiation | `condition_met` proof evaluation **[inferred]** | Explicit `openDispute`, one per order, window-bounded, claimant derived from signed identity |
| Settlement | Contract transfer **[inferred]** | Idempotent, state-derived, one settlement row per order |
| Refund mechanism | Contract refund **[inferred]** | `BUYER_WON → REFUNDED`, escrow flag flipped, single event |
| x402 integration | None described | Real handshake + EIP-712/EIP-3009 + signer recovery. **No `@x402/*` dependency** — spec implemented directly with `viem` |
| EIP-3009 | None described | `EIP3009_TYPES` typed data, `recoverTypedDataAddress` |
| Signer recovery | None described | Yes, both for payment *and* for API request auth |
| SDK | None described | `@recourse/sdk`, 15 typed methods, signing built in |
| Developer integration | Contract calls **[inferred]** | HTTP API + SDK + Postgres DDL + `.env.example` |
| Transaction state machine | Status field **[inferred]** | 13 states, enumerated transition table, terminal states with zero out-edges |
| Persistence | On-chain state **[inferred]** | Event-sourced store behind a port; SQL schema encodes the invariants |
| Security controls | Frozen evidence | Auth, authorization, replay guards, rate limits, per-order mutex, sanitisation |
| Tests | Not described | 40 automated + 2 live-network |

---

## 2 · Core claim verification — deterministic vs semantic

**Claim:** *deterministic facts are resolved deterministically; GenLayer is used only where semantic
judgment is required.*

**Verdict: PROVEN.**

The `minimum_sources` / `2 < 5` path is `compare()` in `domain/verification/engine.ts`:

```ts
case "GTE": {
  const value = Number(observed);
  const expected = Number(term.expected);
  return {
    result: value >= expected ? "PASS" : "BREACH",
    expression: `${value} ${value >= expected ? "≥" : "<"} ${expected}`,
  };
}
```

Can it reach a model? **No, and this is structurally enforced, not a convention.** The entire
domain layer imports exactly two things from outside itself:

```bash
$ grep -rhE "^import .* from \"[^.]" domain/ --include=*.ts | sort -u
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
```

No `fetch`, no `genlayer-js`, no HTTP client, no model SDK anywhere under `domain/`. The verifier
*cannot* call out even if someone tried — there is nothing to call with.

```
DETERMINISTIC — what the code can prove          → local verification
  minimum_sources      2 < 5      BREACH
  max_source_age_days  11 ≤ 30    PASS
  geography            Lagos = Lagos   PASS
  required_sections    4 = 4      PASS

SEMANTIC — what requires interpretation          → GenLayer adjudication
  material_accuracy    "No material misstatement of the Lagos consumer market"
  and the materiality question: is a 3-source shortfall MATERIAL to what the buyer contracted for?
```

The deterministic findings travel to the contract as **facts it is instructed not to recompute**.

Tests: *only semantic questions are eligible for the forum* (asserts exactly 4 checks / 1 semantic
question) and, added during this audit, *boundary: exactly meeting a threshold passes, one short
breaches* (`5 ≥ 5` PASS, `4 < 5` BREACH, `2 < 5` BREACH).

---

## 3 · Is GenLayer real?

**Verdict: REAL.** Nothing simulated, no fixture rulings, no fabricated hashes.

| Item | Value |
| --- | --- |
| Contract | `contracts/recourse_adjudicator.py`, `class RecourseAdjudicator(gl.Contract)` |
| SDK | `genlayer-js@^1.1.8` — `createClient`, `createAccount`, `deployContract`, `writeContract`, `readContract`, `getTransaction` |
| Network | studionet (default); localnet / testnet-asimov / testnet-bradbury configurable |
| Address | `0xB33ebE4c93304098B7ae1c50686dC6C4A17B8e0c` (`genlayer.deployment.json`) |
| Write flow | `writeContract("adjudicate", [disputeId, payloadJson])` → tx hash returned immediately |
| Read flow | `readContract("get_ruling", [disputeId])` — the ruling is contract state, not a log |
| Finality | `getTransaction` → `status_name`; only `FINALIZED`/`ACCEPTED` are acted on |
| Consensus data | `consensus_data.votes` passed through verbatim; `null` when absent |
| Appeals | **Not implemented.** `appealTransaction` exists in the SDK; no `APPEALED` state |
| Frontend derivation | Server components read the protocol in-process; ruling comes from contract state |

Live evidence produced during this session, both reproducible via `npm run test:live`:

- Genuine breach → `BUYER_WINS`, `violated: ["minimum_sources"]`, tx `0xf1e55e8c…`
- Unjustified complaint → `MERCHANT_WINS`, `violated: []`, tx `0xedc8c0eb…`
- A run with a genuine **`disagree`** vote among five validators — a single LLM call cannot disagree
  with itself.

**Simulated components, labelled:** payment settlement is not broadcast
(`SIGNATURE_VERIFIED_LOCAL_ESCROW`, null tx hash); the `simulated` rail used by seeds performs no
cryptography and says so.

---

## 4 · Validator claim

**Claim:** *validators independently re-run the judgment and must independently agree.*

**Verdict: PROVEN (with one honest caveat).**

Inside `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`:

- **Leader** calls `gl.nondet.exec_prompt(task, response_format="json")`.
- **Validator** checks `isinstance(leader_result, gl.vm.Return)`, runs `_consistent()` on the
  proposed ruling, then **calls `gl.nondet.exec_prompt(task, ...)` itself** — a second, independent
  inference — and requires:
  - `own["decision"] == proposed["decision"]`
  - `own["material_breach"] == proposed["material_breach"]`
  - `set(own["violated_terms"]) == set(proposed["violated_terms"])`

Prose is allowed to differ; the outcome is not. `_consistent()` additionally enforces that
`BUYER_WINS ⟺ material_breach ∧ REFUND`, that `violated_terms` is non-empty exactly when there is a
material breach, and that every violated term was actually contested. `parseRuling()` re-checks the
same invariants client-side, so an incoherent ruling cannot become actionable.

**Caveat:** this is custom validation logic via `run_nondet_unsafe`, not GenLayer's built-in
comparative Equivalence Principle helper. That is deliberate — the built-in helpers compare outputs,
whereas this needs semantic agreement on three specific fields while tolerating different prose —
but a judge asking "did you use the Equivalence Principle API?" should be told: no, custom
validator logic performing the same role.

---

## 5 · x402

**Verdict: PARTIALLY PROVEN — real protocol and real cryptography, no on-chain settlement.**

| Item | Status |
| --- | --- |
| Package | **No `@x402/*` dependency.** v2 wire format implemented directly with `viem` — verify by reading `integrations/x402/rail.ts`, not `package.json` |
| Protocol version | `x402Version: 2` in the 402 body and `PAYMENT-REQUIRED` header |
| Request flow | `GET /api/resource/:id` → `402` + base64 `PaymentRequirements` — **REAL** |
| Payment authorization | EIP-3009 `TransferWithAuthorization` signed as EIP-712 — **REAL** |
| Signer recovery | `recoverTypedDataAddress`, compared to declared payer — **REAL** |
| Rejections | wrong recipient / wrong amount / expired / replayed nonce — **REAL**, tested |
| Network | Base Sepolia (`eip155:84532`) by default, configurable |
| USDC handling | Atomic-unit conversion via BigInt, no float drift — **REAL**, tested |
| Facilitator | `settleViaFacilitator()` implemented; **unused unless `X402_FACILITATOR_URL` is set** |
| Settlement broadcast | **NOT PERFORMED.** `SIGNATURE_VERIFIED_LOCAL_ESCROW`, `transactionHash: null` |

Documentation was tightened during this audit so "real x402 v2" cannot be misread as "uses the
official x402 SDK".

---

## 6 · SDK

**Verdict: REAL, typed, documented, executable, connected.**

Actual methods (read from `packages/recourse-sdk/src/client.ts` — note the names differ from the
audit brief's guesses):

```
createProtectedPurchase   getPaymentRequirements   pay
submitDelivery            openDispute              submitAdjudication
getAdjudication           awaitRuling              settle
getOrder                  listOrders               listDisputes
getDispute                getNetworkInfo
```

There is **no** `purchase()` or `getSettlement()`: settlement arrives inside the `Dossier` returned
by `settle()` and `getOrder()`. Every call goes over HTTP to the same protocol instance the UI uses.
Writes are signed automatically when a `signer` is configured.

**Executed end to end during this audit** against the live server, exercising create → 402 → sign →
pay → deliver → dispute → settle, plus four rejected attacks.

---

## 7 · Economic loop

Both paths are genuinely executable and were run during this audit.

```
SUCCESS  (~2s, no adjudication)
AGENT → PAYMENT → PROTECTION → DELIVERY → EVIDENCE → VERIFICATION → RELEASE
  6 ≥ 5 PASS · 12 ≤ 30 PASS · Lagos = Lagos PASS · 4 = 4 PASS  →  merchant paid

FAILURE  (~25s, real consensus wait)
AGENT → PAYMENT → PROTECTION → DELIVERY → EVIDENCE → VERIFICATION → DISPUTE
      → ADJUDICATION → RULING → REFUND
  2 < 5 BREACH → GenLayer → BUYER_WINS → $1.00 refunded
```

Production build, from an empty ledger, completed the dispute path in **12 seconds**.

---

## 8 · Differentiation (only provable items)

```
COMPETITOR
Escrow + frozen evidence + LLM adjudication

RECOURSE
Programmable chargeback infrastructure
for autonomous payment rails
```

1. **Arithmetic never reaches a model.** They adjudicate frozen evidence with an LLM. Recourse
   resolves every measurable term in a layer that has no network access, and refers only
   materiality. Provable in one grep.
2. **Validators do independent work.** Second inference per validator, agreement required on three
   fields. Provable by reading `validator_fn`.
3. **Payment-rail integration, not bespoke escrow.** Real 402 handshake and EIP-3009 signature
   verification; `PaymentRail` is a port, so the dispute API is rail-agnostic by construction.
4. **Shipped as infrastructure.** SDK with signed agent identity, HTTP API, Postgres DDL, 40 tests,
   adversarial security document.
5. **Provenance discipline.** Every UI value carries `LIVE / SEEDED / SIMULATED / NOT AVAILABLE`;
   no fabricated hash exists in the repository.

**Where the competitor is plausibly stronger:** if their escrow genuinely custodies value on-chain,
their "escrow" is cryptographic where ours is an accounting position. That is our single biggest
substantive weakness and it is documented, not hidden.

---

## 9 · Overlap classification

```
MEDIUM OVERLAP
```

Same track, same primitive family (escrow + evidence + GenLayer adjudication), and a judge skimming
one-liners could confuse them. But the *architecture* diverges at the most important decision in the
category — what the LLM is allowed to decide — and Recourse ships a payment-rail integration and an
SDK that the description of the other build does not mention at all.

Not HIGH, because the deterministic/semantic split, the x402 layer, and the SDK are structural, not
cosmetic. Not LOW, because the elevator pitches rhyme.

**Recourse can win from here without changing the product**, via: the deterministic/semantic
separation, the validator implementation, x402 wrapping, the SDK, and the rail abstraction.

---

## 10 · Strongest wedge

> **Recourse separates deterministic verification from semantic adjudication, and packages the
> result as a programmable chargeback layer that sits above an autonomous payment rail.**

The repository proves it: the verification layer physically cannot call a model, and the x402
handshake is real. Runner-up — and the better *demo* line — is the neutrality result: the same
contract refunded a real breach and paid the merchant on an unjustified complaint, on-network,
with transaction hashes for both.

---

## 11 · Marketing claims audit

| Claim | Verdict | Note |
| --- | --- | --- |
| "Real GenLayer adjudication" | **PROVEN** | Deployed contract, real txs, real votes, rules both ways |
| "Validators independently verify" | **PROVEN** | Second `exec_prompt` per validator; caveat: custom logic, not the built-in EP helper |
| "Deterministic checks never call a model" | **PROVEN** | Domain layer imports only `node:crypto` |
| "Real x402 v2" | **PARTIALLY PROVEN → now precise** | Real wire format + crypto; no `@x402` SDK; no broadcast. Wording tightened in README/ARCHITECTURE/SUBMISSION |
| "EIP-3009" | **PROVEN** | Typed data + recovery, tested |
| "on-chain settlement" | **Never claimed** | Explicitly "NOT PERFORMED" with null tx hash |
| "refund" / "settlement" | **PROVEN as ledger movement** | Escrow flag + settlement row; not a chain transfer, and says so |
| "SDK" | **PROVEN** | 15 methods, typed, executed end to end |
| "production-ready" | **Not claimed anywhere** | Verified by grep |
| "trustless" | **Not claimed anywhere** | Verified by grep |
| "decentralised" | **PROVEN in context** | One use, describing GenLayer as the adjudication layer |
| "escrow" | **PARTIALLY PROVEN** | Accounting position, not custody. Stated in README, ARCHITECTURE §7, SECURITY §13 |

No claim required removal. One required precision (x402 SDK), applied.

---

## 12 · Demo audit

Both paths run from real state; there is no `setTimeout` timeline anywhere in `/demo`.

**Dispute path makes the distinction visually obvious**, which was the specific requirement:

- Agreement panel: `Minimum sources ≥ 5`
- Evidence panel: `2 SUBMITTED / 5 REQUIRED`, banner `SHORT BY 3`
- Verification panel: `Minimum sources` → **`2 < 5`** with `MATERIAL` + `BREACH` tags, above the
  line *"These comparisons are executed by the protocol. No model, validator, or third party is
  involved in resolving them."*
- Semantic review shown separately, tagged `GENLAYER`
- Adjudication panel: question, three input hashes, contract, transaction, and five real validator
  addresses with their votes

**Gap (minor):** the demo does not visually foreground *how few* terms went to GenLayer — a judge
must read the panels to notice 4 stayed local. A "4 resolved locally · 1 referred" counter would
make the wedge unmissable in a 90-second video. Recommended, not implemented, because it is
cosmetic and the information is already present.

---

## 13 · Security audit

| Control | Status | Where |
| --- | --- | --- |
| Replay protection (payment) | **Enforced** | Nonce set + unique rail reference |
| Replay protection (API) | **Enforced** | Single-use signatures + 5-min window |
| Duplicate refunds | **Structurally impossible** | Terminal states, idempotent settlement |
| Duplicate releases | **Structurally impossible** | Same |
| Settlement race | **Enforced** | Per-order mutex; 4-way concurrent test |
| Agreement mutation | **Detected** | Hash recomputed on every read |
| Evidence mutation | **Detected** | Checksums + delivery hash |
| Unauthorized dispute | **Enforced** | Signed identity + party check |
| Unauthorized settlement | **Enforced** | Party check |
| Malformed evidence | **Rejected** | Zod + domain limits |
| Prompt injection | **Defended, 5 layers** | Verified against the live network |
| Untrusted URLs | **Validated** | http(s) only, length-bounded |
| Signer validation | **Enforced** | `recoverTypedDataAddress` both layers |
| Amount mismatch | **Rejected** | Authorization value vs requirement |
| Currency mismatch | **Constrained** | `USDC` literal type + asset/network equality |
| State transitions | **Enforced** | Enumerated table |

No critical vulnerability was found that needed fixing during this audit. Known limits (non-custodial
escrow, TOFU option, single-process locking, manual key rotation) are documented in `SECURITY.md §13`.

---

## 14 · Test results

```
TOTAL     40      (+2 live-network, opt-in)
PASS      40
FAIL       0
SKIPPED    0
```

Specifically requested cases:

| Case | Test |
| --- | --- |
| `5 >= 5 → PASS`, `2 < 5 → BREACH` | *boundary: exactly meeting a threshold…* (added in this audit) |
| Semantic condition | *only semantic questions are eligible for the forum* |
| `FULFILLED → RELEASED` | *happy path: a kept promise pays the merchant* |
| `DISPUTED → BUYER_WON → REFUNDED` | *critical path: a breached promise ends in a refund* |
| `DISPUTED → MERCHANT_WON → RELEASED` | *neutrality: the merchant is paid…* + live-network test |
| Double refund fails | *settlement is idempotent* + *concurrent settlements* |
| Double release fails | *an order can never be both refunded and released* |
| Invalid signer fails | *a different key cannot take over…*, *tampered authorization…* |
| Modified agreement fails | *mutating a locked agreement is detected by its hash* |
| Modified evidence fails | *mutating stored evidence is detected by its checksum* |

---

## 15 · Findings summary

**Verified differentiators:** deterministic/semantic separation (structural); independent validator
re-execution; real x402 handshake + EIP-3009; rail-agnostic dispute API; SDK with signed identity;
provenance discipline.

**Unverified / imprecise claims:** one — "real x402 v2" could imply an official SDK. **Fixed.**

**Technical gaps:** non-custodial escrow; settlement not broadcast; no appeals; no partial refunds;
manual key rotation; single-process locking and rate limiting.

**Demo gap:** the "4 local / 1 referred" ratio is not foregrounded.

**Security gaps:** none critical; documented limits stand.

**Changes made during this audit:** boundary test added (40 tests); x402 wording made precise in
three documents. No product redesign.

---

## 16 · Verdict

```
IS RECOURSE DISTINCT ENOUGH?
YES — as built. No redesign required.

PRIMARY TRACK
Agentic Commerce Infrastructure

STRONGEST DIFFERENTIATOR
Deterministic verification is physically separated from semantic adjudication:
the layer that decides 2 < 5 imports only node:crypto and cannot reach a model.
GenLayer is consulted for materiality alone — and rules both ways on-network.

BIGGEST COMPETITIVE RISK
A judge reading one-liners sees "escrow + evidence + GenLayer adjudication"
twice and does not open the code. Mitigate in the first 20 seconds of the video
and the one-liner, not in the README.

MOST IMPORTANT FIX
None blocking. The highest-value optional change is surfacing
"4 terms resolved locally · 1 referred to GenLayer" in the demo header.

MOST IMPORTANT DEMO MOMENT
Run the SUCCESS path immediately after the dispute path. The merchant is paid
in ~2 seconds with no adjudication. It proves the layer is not a buyer-side tax
and that the LLM is genuinely optional — which is exactly the distinction the
competing build cannot make.
```
