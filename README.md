# Recourse

**The programmable chargeback layer for autonomous commerce.**

Payments got autonomous. Refunds didn't.

An AI agent can now pay for something in 400ms without asking anyone. If what arrives is wrong,
it has no move. There is no chargeback for an agent, no dispute form it can fill in, no card
network standing behind it. Autonomous payment without autonomous recourse is just a faster way
to lose money.

Recourse makes the payment conditional on the promise. The buyer's agent and the seller's agent
agree machine-readable terms; the money is captured into escrow against a hash of those terms;
the delivery is checked against them; and if a mandatory term is broken, the buyer's agent gets
its money back — no support ticket, no human reviewer, no card network.

```
AGENT → PAY → VERIFY → DISPUTE → ADJUDICATE → (APPEAL) → FINAL → REFUND / SPLIT / RELEASE
```

The product is the **protected transaction**. Not a court, not a jury — a purchase that can be
undone when the promise is broken.

---

**Submitting or deploying this?** [`SUBMISSION.md`](SUBMISSION.md) has the Agent Tank form
pre-filled and the differentiation analysis; [`DEPLOY.md`](DEPLOY.md) gets you a live URL in about
five minutes.

**What changed since the accepted hackathon version?** v0.2 — *contestable, final, proportional*:
settlement waits for GenLayer finality, the losing side can appeal through GenLayer's own appeal
mechanism, agreements can allow graduated (partial) refunds, and the v2 contract binds every
ruling to the request that asked for it. [`MILESTONE.md`](MILESTONE.md) has the delta and its
status; [`CHANGELOG.md`](CHANGELOG.md) the detail; [`RUNBOOK.md`](RUNBOOK.md) the steps to deploy
and verify it.

## Run it

```bash
npm install
npm run genlayer:deploy   # deploy RecourseAdjudicator to Studio Next (writes the address)
npm run seed              # ledger of real protocol runs (~40s, includes one live adjudication)
npm run dev               # http://localhost:3000
```

Creating a protected purchase works without the first step; **adjudication does
not**. Until a contract is deployed for the selected network the app reports the
forum as unavailable and says so on every surface, rather than showing a ruling
that never happened.

No wallet, no API key, no environment variables. Open `/demo` and press **Run protected
purchase**. The dispute path takes about 30 seconds, most of it spent waiting for real GenLayer
validators to rule.

```bash
npm test               # 96 domain, adversarial, auth, finality/appeal and forum tests, no network
npm run test:contract  # 28 contract tests in genlayer-test Direct Mode (Python ≥ 3.12)
npm run test:live      # opt-in: three real adjudications on-network (buyer wins, merchant wins, split)
npm run genlayer:appeal  # one real appeal: provisional ruling → appeal → final, via the protocol's adapter
npm run wallet                          # create a deployment wallet for a public testnet
npm run agents generate shopper.agent   # register an agent and print its key once
npm run agents list                     # who is bound to which key
npm run genlayer:deploy    # deploy to Studio Next: quotes the fee, tracks, records the address
npm run genlayer:smoke     # one real adjudication against the deployed contract
npm run seed:fast          # reseed without the network round trip
```

---

## What is real, and what is not

Judges should never have to guess. Neither should users — every surface in the UI carries a
provenance label, and anything the protocol does not know is shown as `NOT AVAILABLE` with a
reason rather than filled in with something plausible.

| Layer | Status | What actually happens |
| --- | --- | --- |
| State machine, agreements, verification, disputes, settlement | **Real** | Full domain implementation, persisted, 25 tests |
| Agreement + evidence hashing | **Real** | Canonical JSON (RFC 8785 style) → sha256, recomputable by either party |
| GenLayer adjudication | **Real** | `RecourseAdjudicator` Intelligent Contract deployed on GenLayer; real transactions, real validator consensus, real rulings |
| Finality (v0.2) | **Real** | An `ACCEPTED` ruling is recorded as *provisional* and read from the latest non-final state; money moves only once the network reports `FINALIZED` and the ruling is read from finalized state. Rulings recorded on acceptance by v0.1 are re-confirmed on-chain before they can settle |
| Appeals (v0.2) | **Real, through GenLayer** | The losing side of a provisional ruling can appeal once; the protocol asks the network whether the decision is still appealable, pays the bond it quotes (`appealTransaction`), and follows the same transaction until it is final — `UPHELD` or `REVISED`. The bond is paid by the protocol's key in this release |
| Graduated remedies (v0.2) | **Real; needs the v2 contract** | Agreements can lock in `graduated_refund`. The contract may then rule `SPLIT` with a refund in 10-point steps; validators must agree on materiality and violated terms exactly, and on the amount within one step. Settlement splits escrow in two exact legs |
| Consensus v0.6 fees | **Real, and quoted** | Every write carries a fee distribution and its quoted value, produced by `@genlayer/transaction-kit` from a measured profile (when one is committed) plus the network's live prices — and submitted unchanged. A quote that disagrees with the live fee policy is refused, not signed. The deposit the protocol escrowed is recorded as a deposit; consumption and refund are shown only when a receipt reports them, otherwise `NOT AVAILABLE` |
| Agent authentication | **Real cryptography** | Writes require a secp256k1 request signature. Handles are bound to keys in a persistent registry — pre-registered, or trust-on-first-use. Wrong party, forged, tampered, stale and replayed requests are all rejected |
| x402 payment authorization | **Real cryptography** | EIP-712 signature over an EIP-3009 `TransferWithAuthorization`, verified by signer recovery; replay, tampering and expiry rejected. The v2 wire format is implemented directly against the spec with `viem` — there is no `@x402/*` SDK dependency, so read `integrations/x402/rail.ts` rather than trusting a package name |
| x402 on-chain settlement | **Not performed** | Broadcasting needs a funded facilitator and a funded buyer wallet. Settlement is recorded as `SIGNATURE_VERIFIED_LOCAL_ESCROW` with a **null** transaction hash. No fake hashes anywhere |
| Seeded ledger records | **Real runs, local** | Produced by executing the real protocol, labelled `DEMO FIXTURE` because the counterparties are not real merchants |
| Storage | **File-backed** | Event-sourced JSON store behind a `RecourseStore` port; the Postgres schema it mirrors is in `infra/store/schema.sql` |

The network indicator in the header reports the *weaker* of adjudication and payment, not the
flattering one.

Adjudication is rate limited to 10 submissions per minute per client, because every one of them
is a real transaction executed by real validators.

Mutating endpoints require a signed agent request; reads are public, because a protocol whose
ledger cannot be inspected is not much of a protocol. The `/demo` endpoints act as the protocol
itself and are exempt, which is what lets a judge run the whole thing with no keys — disable them
with `RECOURSE_DEMO_ENDPOINTS=0` in a real deployment.

---

## The demo

One brief. One dollar. Five conditions.

> **Lagos Consumer Commerce Brief** — $1.00 USDC
> `minimum_sources ≥ 5` · `max_source_age_days ≤ 30` · `geography = Lagos, Nigeria` ·
> `required_sections = 4` · *material accuracy* (semantic)

**Promise satisfied** → six sources, every mandatory term passes, escrow releases to the
merchant. No adjudication, because arithmetic settled it. ~2 seconds.

**Promise breached** → two sources arrive. `2 < 5` is detected in code, the buyer opens a
claim, the contested terms go to GenLayer, validators reach a *provisional* `BUYER_WINS`, the
appeal window passes (or the merchant appeals from the console), the ruling finalizes, and the
dollar goes back. Consensus plus the finality window take as long as they take.

**Partial delivery** → three of five sources, under an agreement that allows a graduated remedy.
GenLayer can award part of the price back — say 40% — and escrow settles in two legs: $0.40 to
the buyer, $0.60 to the merchant.

Every path writes real records you can open at `/orders/[id]` afterwards.

---

## Why GenLayer is in this, and where it is not

Most of a broken promise is arithmetic. Counting sources, comparing dates, matching a string —
if code can settle a term, code settles it. Those checks are instant, free, and impossible to
argue with, and they never touch a model.

```
minimum_sources:      2 < 5    → BREACH      (deterministic, in code)
max_source_age_days:  11 ≤ 30  → PASS        (deterministic, in code)
geography:            Lagos = Lagos → PASS   (deterministic, in code)
required_sections:    4 = 4    → PASS        (deterministic, in code)
material_accuracy:    "is the shortfall material?" → GenLayer
```

What code cannot settle is whether a shortfall is *material* — whether two sources instead of
five defeats what the buyer actually contracted for. That is a judgment call about the meaning
of an agreement, and it is exactly what GenLayer's validators are for.

So the deterministic findings travel to the contract as **established facts it may not
recompute**, and the contract is asked one question. Validators do not merely check that the
leader returned valid JSON — each one re-runs the judgment itself and must independently reach
the same decision and materiality finding, then confirms the ruling is internally consistent and
stays inside the terms actually in contention. A ruling that says "the buyer wins, pay the
merchant" is rejected on both sides of the wire.

**An accepted ruling is not a final one.** GenLayer reports a transaction `ACCEPTED` when its
validators agree, but until the finality window closes the result can be appealed — a larger
committee re-runs the validator function — and recomputed. Recourse therefore treats `ACCEPTED`
as a provisional ruling, lets the losing side appeal it, and settles only on `FINALIZED`. Graduated
remedies use the same machinery: "was there a breach" must match exactly between validators;
"how much of the price" may differ by one 10-point step.

Contract: [`contracts/recourse_adjudicator.py`](contracts/recourse_adjudicator.py) — v2. Tested in
genlayer-test Direct Mode: [`tests/contracts/`](tests/contracts/).

---

## Architecture

```
app/                    Next.js routes — thin. No protocol logic lives here.
  api/                  Public HTTP API (also what the SDK speaks)
domain/                 The protocol. No framework imports, no I/O.
  orders/               State machine + RecourseProtocol service
  agreements/           Canonicalisation, hashing, locking
  evidence/             Untrusted input: sanitising, bounding, checksums
  verification/         Deterministic engine (never calls a model)
  ports.ts              Store, PaymentRail, AdjudicationForum interfaces
integrations/
  genlayer/             GenLayer client + forum adapter
  x402/                 x402 v2 rail, EIP-3009 signer, verification
  simulated/            Rail used by seeds and offline runs
infra/store/            JSON store + the Postgres DDL it mirrors
packages/recourse-sdk/  Client library for other people's agents
server/                 Composition root, presenter, seed, HTTP helpers
contracts/              The Intelligent Contract
tests/                  Lifecycle, adversarial, and opt-in live-network tests
```

The domain depends on three interfaces and nothing else. Swapping Postgres for the file store,
GenLayer for another forum, or x402 for a different rail is an adapter change — the protocol
does not know which one it is talking to. That is what makes "one dispute API across rails" true
rather than aspirational.

Full detail, including what is deliberately deferred: [`ARCHITECTURE.md`](ARCHITECTURE.md).
Adversarial analysis: [`SECURITY.md`](SECURITY.md).

---

## The SDK

```ts
import { RecourseClient, term } from "@recourse/sdk";
import { privateKeyToAccount } from "viem/accounts";

// Writes are signed. The key never leaves your process.
const account = privateKeyToAccount(process.env.AGENT_KEY as `0x${string}`);
const recourse = new RecourseClient({
  baseUrl: "http://localhost:3000",
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
    term.judgment("material_accuracy", "Material accuracy", "No material misstatement"),
  ],
});

// ...merchant delivers, buyer is unhappy...
const { dispute } = await recourse.openDispute(order.id, { claim: "Two of five sources." });
await recourse.submitAdjudication(dispute.id);

const provisional = await recourse.awaitDecision(dispute.id); // DECIDED: appealable
// the losing side may call recourse.appeal(dispute.id, { reason }) here
const final = await recourse.awaitRuling(dispute.id);          // FINALIZED
await recourse.settle(order.id); // refund, release or split; refused while provisional
```

Pass `remedy: "graduated_refund"` to `createProtectedPurchase` to let the forum award a partial
refund.

[`packages/recourse-sdk/README.md`](packages/recourse-sdk/README.md)

---

## Configuration

Everything has a working default. Set these only to change where it points.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GENLAYER_NETWORK` | `studio-next` | `studio-next` · `studio-dev` · `studionet` · `testnet-asimov` · `testnet-bradbury` · `localnet` |
| `GENLAYER_CONTRACT_ADDRESS` | `genlayer.deployment.json`, then `.recourse/genlayer.json` | Pin a deployed adjudicator |
| `GENLAYER_PRIVATE_KEY` | ephemeral account | Signer for adjudications, and the account that escrows the fee deposit |
| `RECOURSE_FEE_PROFILE` | `./fee-profile.json` | Measured fee profile for the transaction kit. Ignored unless it declares the active `chainId` — with the reason shown in `/api/network` |
| `RECOURSE_ALLOW_UNVERIFIED_FEES` | unset | Set to `1` to sign a quote that failed price verification. Off by default: a stale quote is refused |
| `RECOURSE_RAIL` | `x402` | `x402` or `simulated` |
| `X402_FACILITATOR_URL` | unset | Set to broadcast settlement for real |
| `X402_NETWORK` / `X402_ASSET_ADDRESS` | Base Sepolia USDC | Payment network and asset |
| `X402_ESCROW_ADDRESS` | `0x…0402` placeholder | Escrow `payTo`. A real deployment must set an address it controls |
| `RECOURSE_REQUIRE_AUTH` | `1` (enforced) | Set to `0` to run an open deployment for exploration |
| `RECOURSE_STRICT_REGISTRY` | `0` | Set to `1` to refuse any handle that was not pre-registered |
| `RECOURSE_DEMO_ENDPOINTS` | `1` | Set to `0` to disable the keyless demo endpoints in production |
| `RECOURSE_STORE_FILE` | `.recourse/ledger.json` | Ledger location |
| `RECOURSE_AUTO_FINALIZE` | on, except on Studio | Submit `finalizeTransaction` when the finality window has elapsed. Studio finalizes by itself; contract networks wait for someone to. `0` disables, `1` forces |

**Studio Next** (Consensus v0.6, chain 61997) is the default because it is the network the
hackathon requires. Its sandbox funds an account itself, so a fresh clone can run the full
adjudication path — deploy, escrow a fee deposit, wait for real validators — without a faucet.
Public testnets are supported for durable verification; stable Studionet remains available for
Consensus v0.5 comparisons.

---

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Zod · Tailwind v4 · Lucide · genlayer-js v2 (RC) ·
@genlayer/transaction-kit (RC) · viem · Python Intelligent Contract on GenLayer Studio Next
(Consensus v0.6).

---

Autonomous commerce needs more than autonomous payments. It needs autonomous recourse.
