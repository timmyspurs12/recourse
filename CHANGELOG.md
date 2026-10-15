# Changelog

All notable changes to Recourse. Dates are UTC.

## [0.2.0] — 2026-10-15 · *contestable, final, proportional*

Builds on the accepted Agent Tank version ([0.1.0], `main` @ `220155a`). Summary and status:
[`MILESTONE.md`](MILESTONE.md). Steps to deploy and verify: [`RUNBOOK.md`](RUNBOOK.md).

### Fixed — settlement no longer happens before finality

- v0.1 treated a GenLayer transaction reported `ACCEPTED` as final: it read the ruling from the
  latest **non-final** state and let settlement move escrow on it, although an accepted result can
  still be appealed and recomputed until the finality window closes. The seeded flagship record
  `RC-000042` shows it (`status: FINALIZED`, `networkStatus: ACCEPTED`).
- An accepted ruling is now **provisional**: new order states `PROVISIONAL_RULING` and `APPEALED`
  have no edge to any settlement state, ruled states are entered only on `FINALIZED`, and the final
  ruling is read from `latest-final` state. `settle()` refuses a provisional ruling with the new
  error code `RULING_NOT_FINAL`.
- Rulings recorded on acceptance by v0.1 are labelled as such in the UI and re-confirmed on-chain
  (`FINALIZED`, same award) before they can settle.
- The forum used the Consensus v0.5 status table. On v0.6, code 13 is `LEADER_REVEALING` (still
  being decided) and would have been read as `LEADER_TIMEOUT` → failed. The v0.6 table is used, and
  unknown codes are pending, never failed. Protocol-style names (`Accepted`, `AppealRevealing`)
  are normalised.

### Added — appeals through GenLayer's Optimistic Democracy

- `fileAppeal()` in the protocol, `POST /api/disputes/:id/appeal` (signed, rate limited),
  `POST /api/demo/appeal` (demo only) and `appeal()` / `awaitDecision()` in the SDK.
- The losing side of a provisional ruling (either side for a split) may appeal once per party,
  one appeal at a time, while the network's `canAppeal` allows it. The forum pays exactly the
  network's quoted charge (`getAppealCharge`, bond + funding) via `appealTransaction` on the same
  transaction, bound to the active decision.
- Appeals resolve only on evidence their round ran — a round seen in flight, a higher round count,
  another failed appeal, a new decision id, or finality — and are recorded `UPHELD` or `REVISED`.
- New events `RULING_PROVISIONAL`, `APPEAL_FILED`, `APPEAL_RESOLVED`, `FINALIZATION_SUBMITTED`;
  `RULING_FINALIZED` is now emitted only on true finality.
- Off Studio, the forum submits `finalizeTransaction` once the lifecycle reports `Finalize`
  (`RECOURSE_AUTO_FINALIZE`, default on except on Studio, which finalizes itself).
- `npm run genlayer:appeal`: one real appeal end to end, through the production adapter, printing
  the evidence to cite.

### Added — graduated remedies (contract v2)

- Agreements can lock in `refundPolicy.settlement: "graduated_refund"` (`remedy` on
  `POST /api/orders` and in the SDK). New agreement documents are `recourse/0.2`; `recourse/0.1`
  documents keep verifying.
- `RecourseAdjudicator` v2 can rule `SPLIT` with `refund_bps` (the model answers in 10-point steps)
  — only for graduated agreements. Validators must agree exactly on materiality and violated terms,
  and on the refund within `AGREEMENT_TOLERANCE_BPS` (one step).
- New states `SPLIT_AWARDED` → `PARTIALLY_REFUNDED`; settlement outcome `PARTIAL_REFUND` with two
  legs, computed in integer micro-units (buyer's share rounded down, merchant gets the exact
  remainder); escrow state `SPLIT`; event `PARTIAL_REFUND_EXECUTED`.
- A third demo path, **Partial delivery** (3 of 5 sources, graduated agreement), and an appeal
  button while a ruling is provisional.

### Security

- **Ruling pre-emption and stale rulings (v1 contract).** Rulings were keyed by dispute id alone,
  `adjudicate` was public and idempotent, and dispute ids are predictable and repeat after a
  reseed or across clones sharing the default contract — so the protocol could read and settle on
  a ruling made against inputs it never sent. v2 stores rulings under `<submitter>/<dispute_id>`
  with their inputs hash and refuses a repeat with different inputs; the forum rejects any ruling
  that does not echo the inputs hash (and, on v2, the submitter) it expects — including on the v1
  contract, via its stored inputs hash.
- Each adjudication is polled at the contract address it was sent to, so in-flight disputes
  survive a redeploy.
- The contract's validator uses `gl.vm.run_nondet_default` (sandboxed validator, the SDK's
  recommended API) and votes down failed or incoherent leader proposals so the round rotates.

### Changed

- Contract v2 views: `get_ruling(submitter, dispute_id)`, `get_inputs_hash(submitter, dispute_id)`,
  `get_policy()`, `get_ruling_count()`. **Breaking for direct callers** of the v1 one-argument
  views; the protocol detects the contract generation (`get_policy`, with a positive v1 probe) and
  reads both.
- Runner pin moved to `py-genlayer:babwp9t3…` (GenVM v0.6.0-rc9; Studio moved on 2026-10-14).
  `npm run genlayer:deploy` now negotiates: it probes the contract's own pin and falls back to
  other known runners only when the network reports the runner missing; `--pin` forces one. It
  reads `get_policy` back after deploying, and records the runner, the contract version, and the
  previous deployment under `history`.
- `npm run genlayer:smoke` reads v2 rulings by signer from finalized state; `--graduated` asks
  for a proportional remedy.
- On Studio, the submitting key is topped up through the sandbox even when it is a per-submission
  key.
- The Postgres DDL gains the new states, an `appeals` table and `settlement_legs`.

### Tests

- `tests/contracts/` — 28 contract tests in genlayer-test Direct Mode (validators, tolerance,
  namespacing, idempotency, injection framing, malformed input), mutation-checked.
- `tests/v02.test.ts` — 33 tests: finality gating, legacy re-confirmation, appeal rules and
  resolution timing, graduated settlement arithmetic (randomised), the forum against a fake
  genlayer-js client (status table, read variants, binding, generation detection,
  auto-finalization, appeal payment) and runner negotiation. `npm test`: 96 tests.
- `test:live` gains a graduated case and passes the submitter and inputs hash the v2 contract needs.
- `.github/workflows/ci.yml` runs lint, types, `npm test` and the contract tests (Python 3.12,
  `GENVM_VERSION=v0.6.0-rc9`).

## [0.1.0] — 2026-09-17 · Agent Tank submission (accepted)

The protected transaction: machine-readable agreements hashed and locked before payment, x402
authorization verified by signer recovery, deterministic verification, disputes referred to the
`RecourseAdjudicator` Intelligent Contract on Studio Next (`0x17DA09A8…`), validator re-judgment,
idempotent all-or-nothing settlement, signed agent requests, SDK, and the demo. See
[`SUBMISSION.md`](SUBMISSION.md).

[0.2.0]: https://github.com/timmyspurs12/recourse/compare/220155a...main
[0.1.0]: https://github.com/timmyspurs12/recourse/tree/220155aa0ca70f3472eb2e1ac955eacf05bb5659
