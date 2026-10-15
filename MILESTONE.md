# Milestone — Recourse v0.2: contestable, final, proportional

| | |
| --- | --- |
| Project | **Recourse** — the programmable chargeback layer for autonomous commerce (GenLayer Agent Tank, accepted) |
| Accepted baseline | `main` @ [`220155a`](https://github.com/timmyspurs12/recourse/tree/220155aa0ca70f3472eb2e1ac955eacf05bb5659) (2026-09-17) · v1 contract `0x17DA09A8d79d5ef709655f71a5e6AC4c3885CD56` on Studio Next (chain 61997) |
| This milestone | v0.2.0 · branch `arena/5d3d9dea-recourse` · 2026-10-15 · full diff: [`CHANGELOG.md`](CHANGELOG.md) |
| Type | New contract functionality · security/architecture improvement · new deployment (v2 contract) |
| Traction | None claimed. Recourse has no external users yet. |

## In one paragraph

The accepted version settled escrow the moment GenLayer reported a ruling `ACCEPTED`. On GenLayer
an accepted ruling can still be appealed and recomputed until its finality window closes. v0.2
makes the protocol use that mechanism instead of skipping it:

- **Final:** money moves only on a `FINALIZED` ruling, read from finalized state.
- **Contestable:** the losing side can appeal a provisional ruling through GenLayer's own appeal
  mechanism, under rules the protocol enforces.
- **Proportional:** agreements can allow graduated remedies. Contract v2 can award a partial refund,
  validators agree on "how much" within one 10-point step, and escrow settles in two exact legs.

Along the way we found and closed a real hole in the v1 contract: a ruling could be pre-empted or
recycled. Every ruling is now bound to the request that asked for it.

## What changed, and why it matters

### 1. Settlement waits for finality — a correctness fix

- **Problem.** v0.1 treated `ACCEPTED` as final. It read the ruling from the latest *non-final*
  state and let settlement move escrow on it. Had the ruling been overturned on appeal, the money
  would already have gone the other way. The seeded flagship record shows this directly:
  `dsp_rc-000042` is stored `FINALIZED` while the network said `ACCEPTED`.
- **Change.**
  - New order states `PROVISIONAL_RULING` and `APPEALED`, with **no edge to any settlement state**.
    Ruled states are entered only on `FINALIZED`.
  - Final rulings are read from `latest-final` state.
  - `settle()` refuses a provisional ruling with the new code `RULING_NOT_FINAL`.
  - Rulings recorded on acceptance by v0.1 are labelled as such in the UI and re-confirmed on-chain
    before they can settle.
  - The forum also carried the Consensus v0.5 status table, under which v0.6's code 13 (still being
    decided) read as a timeout. It now uses the v0.6 table.
- **Why it matters.** A chargeback layer that pays out before the verdict is final is not a
  chargeback layer.
- **Where.**
  - `domain/orders/state-machine.ts`
  - `domain/orders/service.ts` (`pollAdjudication`, `settle`, `confirmLegacyFinality`)
  - `integrations/genlayer/forum.ts`
  - [SECURITY §14](SECURITY.md)

### 2. Appeals through GenLayer's Optimistic Democracy

- **Change.** The side a provisional ruling went against can appeal it. For a split, either side
  can.
  - Rules: once per party, one appeal at a time, and only while the network's `canAppeal` says the
    decision is still appealable.
  - The forum takes the network's quoted charge (`getAppealCharge`: bond plus funding) and calls
    `appealTransaction` on the **same** transaction, bound to the active decision. A larger
    validator committee then re-runs the contract's validator function, and the transaction is
    recomputed if its majority disagrees.
  - The protocol resolves an appeal only on evidence that its round actually ran (a status seen in
    flight, a higher round count, another failed appeal, a new decision id, or finality). It then
    records it `UPHELD` or `REVISED`.
- **Surface.**
  - `POST /api/disputes/:id/appeal` (signed; the appellant is the signer).
  - SDK `appeal()` and `awaitDecision()`.
  - An appeals panel on the dispute page, and an appeal button in the live demo.
  - `npm run genlayer:appeal` runs one real appeal end to end through the production adapter.
- **Why it matters.** Appeals are the part of GenLayer that makes a model's judgment contestable.
  v0.1 left them unused; v0.2 makes them part of the product.

### 3. Graduated remedies — contract v2

- **Change.**
  - An agreement can lock in `graduated_refund` before payment. New documents are `recourse/0.2`;
    `0.1` hashes still verify.
  - Contract v2 may then rule `SPLIT` with `refund_bps`. The model answers in 10-point steps, and
    the contract refuses a split in all-or-nothing mode.
  - Validators must agree **exactly** on materiality and on the violated terms, and on the refund
    **within one step** (`AGREEMENT_TOLERANCE_BPS = 1000`).
  - Settlement splits escrow in integer micro-units: the buyer's share is rounded down and the
    merchant gets the exact remainder. New states are `SPLIT_AWARDED` → `PARTIALLY_REFUNDED`.
- **Why it matters.** All-or-nothing remedies are wrong in exactly the common case of a delivery
  that is short but not worthless. Refunding everything pays the buyer for value it received;
  refunding nothing charges it for value it did not. A tolerance-based agreement rule is how
  GenLayer validators can agree on an amount without agreeing on prose.
- **Where.**
  - `contracts/recourse_adjudicator.py`
  - `domain/shared/money.ts`
  - The live demo's **Partial delivery** path

### 4. A ruling must belong to the request — a security fix

- **Problem.** In the v1 contract, rulings were keyed by dispute id alone, `adjudicate` was public,
  and a repeat call was a silent no-op. Dispute ids are predictable (`dsp_rc-000056` follows
  `RC-000056`), so anyone could store a ruling of their choosing first, and the protocol would read
  it and settle on it. Ids also repeat after a ledger reseed and across clones that share the
  committed default contract. The protocol could therefore read stale rulings with no attacker
  involved.
- **Change.**
  - v2 stores rulings under `<submitter>/<dispute_id>` together with their inputs hash, and refuses
    a repeat request with different inputs.
  - The forum rejects any ruling that does not echo the inputs hash it expects, and on v2 the
    submitter too. This also protects the v1 deployment, through its stored inputs hash.
  - In-flight disputes are polled at the contract address they were sent to, so they survive a
    redeploy.
- **Where.**
  - Contract `_key`, `adjudicate`
  - `rulingBindingProblem` in `integrations/genlayer/forum.ts`
  - [SECURITY §15](SECURITY.md)

### 5. Keeping up with the network

Studio moved from GenVM v0.6.0-rc7 to rc9 on 2026-10-14, which changes the python runner hash. The
v1 contract pins the rc3–rc7 runner (`5jycge4q…`).

- v2 pins rc9's runner (`babwp9t3…`).
- `npm run genlayer:deploy` **negotiates**: it probes the contract's own pin, falls back to the other
  known runners only when the network reports the runner missing, and records the pin it used.
- After deploying, it reads `get_policy` back to confirm the contract answers.
- Off Studio, the forum submits finalization itself once the window has elapsed.

### 6. Tests and CI

| Suite | Count | What it pins |
| --- | --- | --- |
| `tests/contracts/` (genlayer-test Direct Mode) | 28 | Stored rulings, refused rulings, how validators vote (tolerance, materiality, failed leaders), submitter namespacing, idempotency, injection framing, malformed input. Mutation-checked: widening the tolerance, dropping namespacing, allowing splits everywhere, or ignoring inputs each fails a test |
| `tests/v02.test.ts` | 33 | Finality gating, legacy re-confirmation, appeal rules and resolution timing (late registration; a round finishing between polls), graduated settlement (500 randomised splits), the forum against a fake genlayer-js client, runner negotiation |
| `npm test` total | 96 | v0.1's 63 tests, unchanged and passing, plus the 33 above |
| CI | — | `.github/workflows/ci.yml`: lint, types, `npm test`, contract tests on Python 3.12 with `GENVM_VERSION=v0.6.0-rc9` |

## Status — what is done, what is pending, what is not claimed

| Item | Status | Evidence |
| --- | --- | --- |
| Finality-gated settlement | **Done**, tested offline | `tests/v02.test.ts`, SECURITY §14 |
| Appeals: protocol, forum, API, SDK, UI | **Done**, tested offline against a scripted forum and a fake genlayer-js client | `tests/v02.test.ts`, SECURITY §16 |
| Contract v2: graduated remedies, binding, policy | **Done**, 28 Direct Mode tests | `tests/contracts/` |
| v2 contract deployed on Studio Next | **Done** · [run #1](evidence/run-1.md) | [`0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581`](https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581) · deploy tx [`0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3`](https://explorer-studio-dev.genlayer.com/tx/0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3) |
| Live adjudication on v2 (all-or-nothing + graduated) | **Done** · [run #1](evidence/run-1.md) | all-or-nothing [`0x576aa265cce7321944cee3ef2515707c8428e7ab93f7186efdc6661695e1844c`](https://explorer-studio-dev.genlayer.com/tx/0x576aa265cce7321944cee3ef2515707c8428e7ab93f7186efdc6661695e1844c) · graduated [`0x4b5e3ae37255bea81a5361a3b0921a370fae380abb5e937770c4804d6702da85`](https://explorer-studio-dev.genlayer.com/tx/0x4b5e3ae37255bea81a5361a3b0921a370fae380abb5e937770c4804d6702da85) |
| Live appeal on v2 | **Pending.** RUNBOOK §5 | tx + appeal charge + outcome: *fill in* |
| Live app (Railway) on v2 | **Pending.** RUNBOOK §7 | https://recourse-production-bf02.up.railway.app |
| CI on GitHub | **Green**: lint, types, 96 app tests, 28 contract tests on genlayer-test 0.30.0rc2 + GenVM v0.6.0-rc9 | [run 38734558429](https://github.com/timmyspurs12/recourse/actions/runs/38734558429) |
| The v1 contract still executing on Studio after the rc9 move | **Unknown.** Could not be checked from the build environment; the redeploy above supersedes it | — |

**How the offline parts were verified.**

- `npm test` (96/96), `npx eslint` and `npx tsc --noEmit` (after `next typegen`) all pass locally
  and in CI.
- The 28 contract tests pass in GitHub Actions with the **published** genlayer-test 0.30.0rc2 and
  the **GenVM v0.6.0-rc9** runner bundle (`GENVM_VERSION=v0.6.0-rc9`). Direct Mode resolves the
  runner named on line 2 of the contract from that bundle, so a green run also confirms rc9 ships
  `py-genlayer:babwp9t3…`.
  - [First CI run on this branch](https://github.com/timmyspurs12/recourse/actions/runs/38734558429):
    both jobs green.
- On-network results for v2 come from the GenLayer evidence workflow; each filled row links to the
  run that produced it, with full logs. Rows still marked **Pending** carry no on-network claim.

**Not claimed.**

- No users or traction.
- **Appeal bonds.** They are paid by the protocol's adjudication key, not charged to the appellant
  (documented, SECURITY §17). A successful appellant's reward also accrues to that key.
- **Leader appeals.** These would apply to `UNDETERMINED` or timed-out transactions; they are not
  used, and such referrals are resubmitted instead.
- **Escrow** is still a ledger position, not on-chain custody, as in v0.1.

## Evidence to cite (each value links to the run that printed it)

| Evidence | Value |
| --- | --- |
| v2 contract address (Studio Next, chain 61997) | [`0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581`](https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581) · [run #1](evidence/run-1.md) |
| v2 deploy tx · runner pin used | [`0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3`](https://explorer-studio-dev.genlayer.com/tx/0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3) · `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` · [run #1](evidence/run-1.md) |
| `get_policy` read back | `RecourseAdjudicator 2.0.0 · remedy modes ALL_OR_NOTHING, GRADUATED · tolerance 1000 bps` · [run #1](evidence/run-1.md) |
| Smoke: all-or-nothing ruling + prompt-injection refused | tx [`0x576aa265cce7321944cee3ef2515707c8428e7ab93f7186efdc6661695e1844c`](https://explorer-studio-dev.genlayer.com/tx/0x576aa265cce7321944cee3ef2515707c8428e7ab93f7186efdc6661695e1844c) · ruling `BUYER_WINS` although the merchant text ordered `MERCHANT_WINS` · [run #1](evidence/run-1.md) |
| Smoke: graduated ruling | tx [`0x4b5e3ae37255bea81a5361a3b0921a370fae380abb5e937770c4804d6702da85`](https://explorer-studio-dev.genlayer.com/tx/0x4b5e3ae37255bea81a5361a3b0921a370fae380abb5e937770c4804d6702da85) · ruling `SPLIT`, `refund_bps 4000` (40% back to the buyer) · [run #1](evidence/run-1.md) |
| Live appeal | adjudicate tx `0x…` · charge `… GEN` · provisional `…` → final `…` · `UPHELD`/`REVISED` |
| `npm run test:live` | 3 passed, 0 failed · [`0x735dfab4a2a1eeee505b14800fed0a0ff281db1f318f877c9ab8aafc27aa9a32`](https://explorer-studio-dev.genlayer.com/tx/0x735dfab4a2a1eeee505b14800fed0a0ff281db1f318f877c9ab8aafc27aa9a32) · [`0x1ce1bebe276b257ac22f02097c5301fe3c96a019f9b769389b19a1af9c333521`](https://explorer-studio-dev.genlayer.com/tx/0x1ce1bebe276b257ac22f02097c5301fe3c96a019f9b769389b19a1af9c333521) · [`0x599b03500d420af39edaf874eda637251ee2fcdcdbf57041e64288f6115a2d6c`](https://explorer-studio-dev.genlayer.com/tx/0x599b03500d420af39edaf874eda637251ee2fcdcdbf57041e64288f6115a2d6c) · [run #1](evidence/run-1.md) |
| Live demo on Railway | order `RC-…` (dispute path, provisional → final → refund), order `RC-…` (partial path → split) |

## Submission text (copy-paste)

**Title:** Recourse v0.2 — finality-gated settlement, GenLayer appeals, graduated refunds

**What changed:** Recourse no longer settles on a GenLayer ruling until it is final. An `ACCEPTED`
ruling is now provisional: escrow stays held, and the losing side can appeal through GenLayer's own
appeal mechanism. The protocol pays the network-quoted bond and follows the same transaction to
`FINALIZED` (`UPHELD`/`REVISED`). Contract v2 adds graduated remedies: agreements can allow partial
refunds, validators agree on materiality exactly and on the amount within one 10-point step, and
escrow settles in two exact legs. v2 also fixes a v1 hole where a ruling could be pre-empted or
recycled through predictable dispute ids: rulings are now bound to their submitter and inputs hash.
The deploy script negotiates the GenVM runner pin (Studio moved to rc9 on 2026-10-14).

**Why it matters:** A chargeback layer must not pay out before the verdict is final, a model's
judgment must be contestable, and partial delivery should get a partial remedy.

**Verify:** v2 contract `0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581` (deploy tx `0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3`); live appeal tx `0x…`; CHANGELOG.md and
MILESTONE.md in the repo; tests: 96 app tests and 28 contract tests (genlayer-test Direct Mode).

## How a reviewer can verify

```bash
npm ci && npm test                                   # 96 tests, no network
python3 -m pip install -r tests/contracts/requirements.txt
GENVM_VERSION=v0.6.0-rc9 python3 -m pytest tests/contracts -q   # 28 contract tests
npm run genlayer:smoke -- --graduated                # one real graduated ruling (Studio Next)
npm run genlayer:appeal                              # one real appeal, provisional → final
```
