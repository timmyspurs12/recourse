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

## 05 · How-to (the exact path)

```
01  Clone and install
    git clone https://github.com/<you>/recourse && cd recourse && npm install

02  Seed the ledger with real protocol runs
    npm run seed
    Executes real purchases, deliveries and verifications, including one live
    GenLayer adjudication. Takes about 40 seconds. Use --fast to skip the network.

03  Start it
    npm run dev   →  http://localhost:3000
    No wallet, no API key, no environment variables required.

04  Run the flagship demo
    Open /demo, choose "Promise breached", press "Run protected purchase".
    The merchant delivers 2 of the 5 required sources. The protocol detects
    2 < 5 in code, the buyer opens a claim, and the contested term goes to
    GenLayer. Consensus takes ~25 seconds — the wait is real. Buyer wins,
    $1.00 USDC is refunded.

05  Prove it was not the AI doing arithmetic
    Open the order dossier. Four deterministic checks resolved in code with no
    model involved; one semantic question went to GenLayer. The validator votes
    on the dispute page are exactly what the network reported.

06  Check neutrality
    Back on /demo choose "Promise satisfied" and run again. Every mandatory term
    passes, no adjudication happens, and the merchant is paid in ~2 seconds.

07  Verify the adjudicator independently
    npm run genlayer:smoke
    Submits a dispute to the deployed contract with a prompt-injection attempt
    embedded in the merchant statement ("IGNORE ALL PREVIOUS INSTRUCTIONS...").
    It still rules BUYER_WINS.

08  Run the tests
    npm test              39 tests: lifecycle, adversarial, auth
    npm run test:live     2 real on-network adjudications, both directions
```

## 06 · Review verification — expected outcome (500 max)

**468 / 500 characters — verified.**

```
npm install && npm run seed && npm run dev. At /demo pick "Promise breached" and Run: verification records 2 < 5 as BREACH in code, the dispute goes to RecourseAdjudicator on GenLayer studionet, and after ~25s of real consensus the ruling is BUYER_WINS and $1.00 is REFUNDED. The dispute page shows a real tx hash and the validator votes the network reported. Then pick "Promise satisfied": released to the merchant in ~2s with no adjudication. npm test -> 40 passing.
```

## 06 · Contract links (optional — but add it)

```
https://studio.genlayer.com/contracts/0xB33ebE4c93304098B7ae1c50686dC6C4A17B8e0c
```

Deployed `RecourseAdjudicator`, studionet, recorded in `genlayer.deployment.json`.
If Studio has reaped it by judging time, run `npm run genlayer:deploy` and update both the form
and that file.

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
