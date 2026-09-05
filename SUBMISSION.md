# Agent Tank submission — copy/paste guide

Everything the form at
[portal.genlayer.foundation/agent-tank/hackathon/submit](https://portal.genlayer.foundation/agent-tank/hackathon/submit)
asks for, pre-written. Closes **Sep 17, 15:30 UTC**.

---

## 00 · Track

> **Agentic Commerce Infrastructure**

The track description is *"Payments, escrow, identity and insurance for agents trading with
agents"* — that is literally the product. It also matches a listed open idea almost word for word:

> **"Stablecoin payments with chargeback. One dispute API across cards, x402 and any chain."**

Recourse is that idea, built: x402 payments wrapped in an enforceable agreement, with one dispute
API that does not care which rail carried the money (`PaymentRail` is a port; the dispute logic
never learns which implementation was used).

**Not Onchain Justice.** That track is *"disputes, appeals and rule enforcement decided from
evidence"* — the case is the product there. Here the case is a subordinate state that a protected
transaction can enter, and most transactions never enter it. Submitting into Onchain Justice would
put this next to Internet Court and Verdict, where it is the weakest framing of the work; in
Agentic Commerce Infrastructure it is the strongest.

---

## 01 · GitHub repository

`https://github.com/<your-username>/recourse` — must be public and owned by your linked account.

## 01 · Identity

**Logo:** `public/logo.png` (1024×1024 PNG, inside the 128–2048 px limit)

**Project name:** `Recourse`

## 02 · One-liner (180 max)

```
The programmable chargeback layer for autonomous commerce. Payments got autonomous. Refunds didn't.
```
*(100 characters)*

## 03 · Description (1000 max)

**995 / 1000 characters — verified, pastes without truncation.**

```
An AI agent can pay in 400ms without asking anyone. If what arrives is wrong it has no move: no chargeback, no dispute form, no card network. Recourse makes the payment conditional on the promise.

Two agents agree machine-readable terms, hashed BEFORE payment is escrowed, so neither side can change what was agreed. Delivery is verified deterministically: counting sources and comparing dates is arithmetic, and code settles it instantly. That layer imports only node:crypto - it cannot call a model.

Only a semantic question reaches GenLayer: were 2 of 5 sources a MATERIAL breach? Deterministic findings travel with it as facts it may not recompute.

Each validator re-runs the judgment itself and must independently reach the same decision - it does not rubber-stamp the leader. On the live network it rules both ways: buyer refunded on a real breach, merchant paid on an unjustified complaint.

x402 is wrapped, not replaced: payTo is the escrow, so payment arrives bound to an agreement.
```

## 04 · Demo video (optional, YouTube)

Strongly recommended. 90 seconds, screen recording, no narration required:

1. `/` — the thesis, 5 seconds.
2. `/demo` — pick **Promise breached**, hit run. Let it sit on `AWAITING CONSENSUS`; say
   out loud that this is a real wait for real validators.
3. Settlement lands `REFUNDED`. Click through to the dossier.
4. `/disputes/dsp_rc-000042` — scroll to **Validator set and consensus**: five real validator
   addresses, three agree, real transaction hash.
5. Switch to **Promise satisfied** and run it: released in ~2 seconds, no adjudication.

That last step is the one that wins arguments: it proves the layer is not a buyer-side tax.

## 05 · How-to (one step per box)

The form gives each step an **optional heading** and an **instruction**. Use the heading
column for the short label and paste the instruction beside it.

| # | Heading | Instruction |
| --- | --- | --- |
| 01 | Open the live demo | Go to https://recourse-production-bf02.up.railway.app/demo and choose "Promise breached". No wallet, API key or setup is needed. |
| 02 | Read the agreement first | The panel lists five machine-readable terms: at least 5 sources, sources under 30 days old, Lagos scope, exactly 4 sections, and material accuracy. Only the last one is semantic. |
| 03 | Run the protected purchase | Press "Run protected purchase". $1.00 USDC is escrowed against a hash of that agreement before the merchant delivers anything. |
| 04 | Watch the split | The header reports "4 resolved locally / 1 referred to GenLayer". The merchant delivered 2 of 5 sources; the protocol records 2 < 5 as a BREACH in code, with no model involved. |
| 05 | Wait for real consensus | The run pauses at ADJUDICATING for roughly 25-60 seconds. This is a genuine wait for GenLayer validators on Bradbury, not an animation. Escrow stays held throughout. |
| 06 | Check the ruling | The ruling is BUYER_WINS and $1.00 is REFUNDED. Open the dispute dossier to see the transaction hash and each validator address with the vote it cast, exactly as the network reported them. |
| 07 | Confirm the merchant can win | Choose "Promise satisfied" and run again. Every mandatory term passes, no adjudication happens at all, and the merchant is paid in about 2 seconds. |
| 08 | Verify the contract | The RecourseAdjudicator Intelligent Contract is at https://explorer-bradbury.genlayer.com/address/0xed3493996D6cfEA8100efa31422Fb0a1f0988989 |
| 09 | Run it yourself (optional) | git clone https://github.com/timmyspurs12/recourse && cd recourse && npm install && npm run seed && npm run dev |
| 10 | Run the tests (optional) | npm test runs 41 tests covering the lifecycle, adversarial cases and agent authentication. npm run test:live submits two real adjudications on-network, one ruling for the buyer and one for the merchant. |

## 06 · Review verification — expected outcome (500 max)

**487 / 500 characters — verified.**

```
Open https://recourse-production-bf02.up.railway.app/demo, choose "Promise breached", press Run. Header shows "4 resolved locally / 1 referred to GenLayer". Verification records 2 < 5 as BREACH in code; the contested term goes to RecourseAdjudicator on GenLayer Bradbury (0xed3493996D6cfEA8100efa31422Fb0a1f0988989). After real consensus the ruling is BUYER_WINS and $1.00 is REFUNDED, with a real tx hash and validator votes. "Promise satisfied" instead releases to the merchant in ~2s.
```

## 06 · Contract links (optional — but add it)

```
https://explorer-bradbury.genlayer.com/address/0xed3493996D6cfEA8100efa31422Fb0a1f0988989
```

Deployed `RecourseAdjudicator` on GenLayer Testnet Bradbury — a public testnet with a public
explorer, so a reviewer can verify the rulings without taking anything on trust.

## 07 · Project links

- **Website (required):** your deployed URL — see `DEPLOY.md`
- **GitHub:** the same repo as 01

---

## Where this sits against the six builds already in the tank

Checked against
[the builds page](https://portal.genlayer.foundation/agent-tank/hackathon/builds/):

| Build | Track | Overlap with Recourse |
| --- | --- | --- |
| **Agentic commerce escrow** (freeze listing + delivery URLs, LLM-adjudicate frozen evidence) | Agentic Commerce Infrastructure | **The real one.** Same neighbourhood: escrow + frozen evidence + LLM adjudication |
| **DomainRiskManager** | Agentic Commerce Infrastructure | Low — semantic conflicts and scheduling overlaps in commitments, not payment recourse |
| **Verdict** (trust registry from adjudicated evidence) | Onchain Justice | Low — reputation output; Recourse moves money, and could feed a registry like it |
| **Internet Court** (listed as live in ecosystem) | Onchain Justice | Low — courtroom/jury framing; Recourse is deliberately not that |
| **RainGuard** | Prediction Markets | None |
| **forgeContract**, **AgentMandate** | Autonomous Protocols | None |

### The one you have to differentiate from, honestly

That escrow build shares the core loop. Four things separate Recourse, all demonstrable in the
repo rather than asserted:

1. **Arithmetic never reaches the model.** They LLM-adjudicate the frozen evidence. Recourse
   settles every measurable term in code — `2 < 5` is a `BREACH` decided by
   `domain/verification/engine.ts`, which cannot call a model — and refers only the materiality
   judgment. A test asserts the 4-deterministic/1-semantic split so it cannot regress. This is
   cheaper, instant, and impossible to argue with.
2. **The validator does real work.** Each validator re-runs the judgment and must independently
   reach the same decision and materiality finding; a coherent-but-wrong ruling
   ("buyer wins, pay the merchant") is rejected on both sides of the wire. A validator check that
   only asks "is this valid JSON?" is theatre.
3. **It is a payment-rail integration, not a bespoke escrow.** The x402 v2 handshake is real —
   402 with `PaymentRequirements`, EIP-3009 `TransferWithAuthorization` signed as EIP-712, signer
   recovery, replay and tamper rejection — implemented directly against the spec with `viem`
   rather than pulled in as an `@x402/*` dependency. `PaymentRail` is a port, which is what makes
   "one dispute API across rails" true rather than a slogan. Settlement is **not** broadcast and
   the UI says so.
4. **It is shipped as infrastructure.** `@recourse/sdk` with signed agent identity, a documented
   HTTP API, a Postgres schema, 39 tests, and an adversarial security analysis. The deliverable is
   something another team integrates, not an app you visit.

**Positioning line for the panel:** *they built an escrow that asks an AI to judge; we built the
recourse layer a payment rail plugs into, where the AI is only consulted for the one question code
cannot answer.*

---

## Honesty checklist (do not soften these)

The build's credibility rests on being straight about what is real. Keep saying so:

- **Real:** GenLayer adjudication — deployed contract, real transactions, real validator consensus,
  rules both directions.
- **Real:** x402 cryptography — signatures verified by recovery; tampering, expiry and replay
  rejected.
- **Not performed:** on-chain settlement. No funded facilitator, so escrow movement is recorded as
  `SIGNATURE_VERIFIED_LOCAL_ESCROW` with a **null** transaction hash. There is not one invented
  hash in the repository.
- **Seeded, not fake:** ledger records come from executing the real protocol and are labelled
  `SEEDED RUN`; live demo runs are labelled `LIVE`.

`JUDGE_AUDIT.md` scores the build 88/100 against ten dimensions, answers eighteen hostile
questions, and lists fourteen defects found and fixed during self-review. Point the panel at it.
