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
AGENT → PAY → VERIFY → DISPUTE → ADJUDICATE → REFUND / RELEASE
```

The product is the **protected transaction**. Not a court, not a jury — a purchase that can be
undone when the promise is broken.

---

## Run it

```bash
npm install
npm run seed        # writes a ledger of real protocol runs (~40s, includes one live adjudication)
npm run dev         # http://localhost:3000
```

No wallet, no API key, no environment variables. Open `/demo` and press **Run protected
purchase**. The dispute path takes about 30 seconds, most of it spent waiting for real GenLayer
validators to rule.

```bash
npm test               # 25 domain + adversarial tests, no network
npm run test:live      # opt-in: two real adjudications on-network (buyer wins, merchant wins)
npm run agents generate shopper.agent   # register an agent and print its key once
npm run agents list                     # who is bound to which key
npm run genlayer:deploy    # deploy RecourseAdjudicator to a GenLayer network
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
| Agent authentication | **Real cryptography** | Writes require a secp256k1 request signature. Handles are bound to keys in a persistent registry — pre-registered, or trust-on-first-use. Wrong party, forged, tampered, stale and replayed requests are all rejected |
| x402 payment authorization | **Real cryptography** | EIP-712 signature over an EIP-3009 `TransferWithAuthorization`, verified by signer recovery; replay, tampering and expiry rejected |
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
claim, the contested terms go to GenLayer, validators rule `BUYER_WINS`, and the dollar goes
back. ~30 seconds, because consensus takes as long as it takes.

Both paths write real records you can open at `/orders/[id]` afterwards.

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

Contract: [`contracts/recourse_adjudicator.py`](contracts/recourse_adjudicator.py)

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
const adjudication = await recourse.awaitRuling(dispute.id);
if (adjudication.ruling?.decision === "BUYER_WINS") await recourse.settle(order.id);
```

[`packages/recourse-sdk/README.md`](packages/recourse-sdk/README.md)

---

## Configuration

Everything has a working default. Set these only to change where it points.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GENLAYER_NETWORK` | `studionet` | `localnet` · `studionet` · `testnet-asimov` · `testnet-bradbury` |
| `GENLAYER_CONTRACT_ADDRESS` | from `.recourse/genlayer.json` | Pin a deployed adjudicator |
| `GENLAYER_PRIVATE_KEY` | ephemeral account | Required for faucet-funded testnets |
| `RECOURSE_RAIL` | `x402` | `x402` or `simulated` |
| `X402_FACILITATOR_URL` | unset | Set to broadcast settlement for real |
| `X402_NETWORK` / `X402_ASSET_ADDRESS` | Base Sepolia USDC | Payment network and asset |
| `X402_ESCROW_ADDRESS` | `0x…0402` placeholder | Escrow `payTo`. A real deployment must set an address it controls |
| `RECOURSE_REQUIRE_AUTH` | `1` (enforced) | Set to `0` to run an open deployment for exploration |
| `RECOURSE_STRICT_REGISTRY` | `0` | Set to `1` to refuse any handle that was not pre-registered |
| `RECOURSE_DEMO_ENDPOINTS` | `1` | Set to `0` to disable the keyless demo endpoints in production |
| `RECOURSE_STORE_FILE` | `.recourse/ledger.json` | Ledger location |

Studionet is the default because it is a real GenLayer network with real validators that needs
no faucet — a judge can run the full adjudication path with nothing configured.

---

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Zod · Tailwind v4 · Lucide · genlayer-js · viem ·
Python Intelligent Contract on GenLayer.

---

Autonomous commerce needs more than autonomous payments. It needs autonomous recourse.
