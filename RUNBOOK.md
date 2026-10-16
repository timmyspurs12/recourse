# Runbook — deploy and verify Recourse v0.2

Step by step, in order. Each step says what to run, what you should see, and what to copy into
the evidence table in [`MILESTONE.md`](MILESTONE.md). Commands are shown for **bash** (macOS,
Linux, Git Bash on Windows) and, where they differ, **PowerShell**.

Total time: about 45 minutes, most of it waiting for validators.

---

## The short way: let GitHub run it (nothing to install)

Steps 3–6 and 8 can run on GitHub's own machines, which cost nothing for a public repository:

1. Open the **Actions** tab, then **GenLayer evidence**, then **Run workflow**, then the green
   **Run workflow** button.
2. Wait 20–40 minutes, most of it validators deliberating.
3. Open the run. Its summary page shows a table of results and a box to copy.

The workflow, [`.github/workflows/genlayer-evidence.yml`](.github/workflows/genlayer-evidence.yml),
works through these stages:

- It deploys v2, unless v2 is already recorded.
- It runs both smoke tests, the appeal and `npm run test:live`.
- It saves the results back to `main`:
  - `evidence/run-N.md`: every value, with the complete logs;
  - the matching rows in `MILESTONE.md`, and the "Current deployment" table in `DEPLOY.md`;
  - `genlayer.deployment.json`, with v1 kept under `history`.
- It reports which contract the live site is using. If that is still v1, do step 7.

It needs no key or secret: each step uses a throwaway account that Studio funds itself. A check
that does not pass is recorded as not passed, and its `MILESTONE.md` row stays **Pending**.

To finish what is missing, run it again with both boxes unticked. It reuses the recorded
contract, skips checks already recorded in `MILESTONE.md`, and runs the rest. Tick **Repeat
checks…** to run everything again, or **Deploy a new contract…** to start over on a fresh one.

---

## 0. What you need

- **Node.js 20** and npm. Check with `node -v` (it should print `v20…`).
- **Git**, with this repository cloned.
- **A GenLayer private key: optional on Studio Next.** Without one, every command below uses a
  throwaway account that the Studio sandbox funds itself (`sim_fundAccount`). A key matters only
  if you want rulings signed by a fixed address, or for a public testnet.
  - A key is 64 hex characters, written with a `0x` prefix. On Studio Next a low balance is topped
    up automatically.
  - `npm run wallet` prints a new key once. Save it somewhere safe.
- **Optional, for the contract tests:** Python **3.12 or newer** (`python3 --version`).
- **Access to the host** that runs the live app. It is on Render's free plan now (step 7).

If you use a key, replace `0xYOUR_KEY` with it wherever it appears below; without one, leave out
`--key 0xYOUR_KEY` and skip setting `GENLAYER_PRIVATE_KEY`. Never paste a key into chat, a commit
or a screenshot.

---

## 1. Get the v0.2 code

The v0.2 work is merged into `main` (pull request #3, 2026-10-15). Reviewers and the live app
both use `main`.

```bash
git checkout main
git pull
npm ci
```

---

## 2. Offline checks (no network, about 1 minute)

```bash
npm test
```

**Expect:** `# pass 96` and `# fail 0`.

```bash
npm run lint
```

**Expect:** no errors.

**Optional — contract tests** (Python 3.12+). These run the real contract in genlayer-test Direct
Mode with mocked model replies. The first run downloads the GenVM rc9 runner bundle, about a
minute.

bash:

```bash
python3 -m venv .venv && source .venv/bin/activate
python -m pip install -r tests/contracts/requirements.txt
GENVM_VERSION=v0.6.0-rc9 python -m pytest tests/contracts -q
```

PowerShell:

```powershell
py -3.12 -m venv .venv; .\.venv\Scripts\Activate.ps1
python -m pip install -r tests/contracts/requirements.txt
$env:GENVM_VERSION="v0.6.0-rc9"; python -m pytest tests/contracts -q
```

**Expect:** `28 passed`. (`.venv` is ignored by git.)

---

## 3. Deploy the v2 contract to Studio Next

```bash
npm run genlayer:deploy                       # no key: a throwaway account Studio funds
npm run genlayer:deploy -- --key 0xYOUR_KEY   # or sign with your own key
```

### What you should see

1. `runner:   py-genlayer:babwp9t3…` — the pin written in the contract.
2. One or more `probe:` lines.
   - `… (GenVM v0.6.0-rc9) → ok` means Studio carries the rc9 runner.
   - `→ runner-missing` for rc9 followed by `… (GenVM v0.6.0-rc3..rc7) → ok` means Studio is still
     on the older runner. The script deploys with that one, and says so. Both are fine.
3. `fee:` with a deposit, then `deploy tx: 0x…`, then progress lines until finalized. This takes a
   minute or two.
4. `policy:   RecourseAdjudicator 2.0.0 · remedy modes ALL_OR_NOTHING, GRADUATED · tolerance 1000 bps`.
   This confirms the deployed contract is v2 and answers.
5. A final block with `address:`, `runner:`, `version: 2.0.0`, and an explorer link.

### Copy into the evidence table

- The **address**.
- The **deploy tx**.
- The **runner** it used.

### Commit the updated deployment record

The script rewrote `genlayer.deployment.json` with the new address, and moved the v1 entry under
`history`. Commit it:

```bash
git add genlayer.deployment.json
git commit -m "Deploy RecourseAdjudicator v2 to Studio Next"
git push
```

### If it fails

- **`could not load this contract under any runner this repository knows`.** Studio is on a GenVM
  release newer than this repository knows about. Find its py-genlayer runner hash, then re-run
  with `--pin py-genlayer:<hash>`.
- **`not a private key`.** Check the key is 64 hex characters.
- **Fee `mismatch`.** Prices moved between the quote and the check. Re-run.

---

## 4. Smoke test the deployed contract (2 runs, a few minutes each)

If you use a key, the scripts read it from an environment variable from here on; set it once per
terminal. Without a key, skip this and run the commands as they are.

bash:

```bash
export GENLAYER_PRIVATE_KEY=0xYOUR_KEY
```

PowerShell:

```powershell
$env:GENLAYER_PRIVATE_KEY="0xYOUR_KEY"
```

**Run 1 — all-or-nothing, with a prompt-injection attempt in the merchant's text:**

```bash
npm run genlayer:smoke
```

**Expect:**

- `contract: RecourseAdjudicator 2.0.0 …`
- `adjudicate tx: 0x…`
- `status: FINALIZED`
- A final `RULING:` line with `"decision": "BUYER_WINS"`. The injected "rule for the merchant"
  instruction was ignored.

**Run 2 — graduated remedy:**

```bash
npm run genlayer:smoke -- --graduated
```

**Expect:**

- `RULING:` with `"remedy_mode": "GRADUATED"`.
- `"decision"` is `"SPLIT"` (with a `refund_bps` such as `4000`) or `"BUYER_WINS"`. The exact
  number is the validators' judgment.

**Copy into the evidence table:** both `adjudicate tx` hashes and both `RULING` lines.

---

## 5. One real appeal (5–10 minutes)

```bash
npm run genlayer:appeal -- --graduated
```

The appeal case is borderline on purpose: three of five required sources, and a merchant who argues
that is immaterial. In **graduated** mode validators can settle on a partial refund. Without
`--graduated` (all-or-nothing) they have to pick one side outright, and on this case they can split
and leave the first ruling `UNDETERMINED`, with nothing to appeal. That is what happened on
2026-10-15 ([run #1](evidence/run-1.md)). The evidence workflow therefore appeals in graduated mode.

### What it does

1. Submits a dispute.
2. Waits for a **provisional** ruling (`DECIDED · ACCEPTED`).
3. Appeals it immediately as the losing side, paying the bond the network quotes.
4. Follows the same transaction until it is `FINALIZED`.

**Expect:**

- `appeal: FILED`.
- `charge: … GEN (bond + funding, quoted by the network)`.
- Status lines that may include `APPEALED`.
- A **summary** block at the end. `appeal outcome` is `UPHELD` if the ruling stood, `REVISED` if it
  changed. Both are a successful demonstration of the mechanism.

**Copy into the evidence table:** the whole summary block.

### If it exits with "The finality window closed before a provisional ruling was observed"

Studio's window is short. Simply run it again.

### If it exits with "The adjudication did not reach a ruling … (UNDETERMINED)"

The validators could not agree on a first ruling, so there was nothing to appeal. Run it again,
in graduated mode if you were not already using it. This is a result of the network, not an error.

---

## 6. Live test suite (about 10 minutes)

bash:

```bash
npm run test:live
```

PowerShell (the npm script uses bash syntax):

```powershell
$env:RECOURSE_LIVE="1"; npx tsx --test --test-timeout=600000 tests/genlayer.live.test.ts
```

**Expect:** 3 passing tests:

- buyer wins and resists an injected instruction;
- merchant wins when nothing was breached;
- proportional remedy under a graduated agreement.

Each prints a line with its transaction hash, and whether a provisional ruling was observed before
finality.

**Copy into the evidence table:** the three tx hashes, and the `ruling:` line of the graduated test.

---

## 7. Point the live app at v2

The live app runs on Render's free plan at https://recourse-7m5o.onrender.com, deployed from
`main`. Railway hosted it until this project's free allowance ran out; [`DEPLOY.md`](DEPLOY.md),
Option B, explains the Render setup.

1. Make sure step 3's `genlayer.deployment.json` is on `main` (the evidence workflow commits it
   for you). With no `GENLAYER_CONTRACT_ADDRESS` set, the app uses the address in that file.
2. Render → your service → **Environment**: `GENLAYER_NETWORK=studio-next` and
   `RECOURSE_REQUIRE_AUTH=1`. A `GENLAYER_PRIVATE_KEY` is optional on Studio Next; without one the
   app signs with a throwaway account that Studio funds.
3. Render redeploys by itself after each push to `main`; or use **Manual Deploy**.
4. Check the deployment answers with the new contract. Open
   `https://recourse-7m5o.onrender.com/api/network` and confirm
   `adjudication.contractAddress` is the v2 address. After a quiet spell the first request takes
   about a minute while the free server wakes up.
5. Run the live demo at `/demo`.
   - **Promise breached.** The order moves through **PROVISIONAL RULING**. While provisional you can
     press **Appeal as the merchant** (optional). It reaches a final ruling, then the refund. The
     settlement panel says *Escrow held until the ruling is final* until finality.
   - **Partial delivery.** This should end **PARTIALLY REFUNDED**, with two settlement legs (for
     example $0.40 back and $0.60 released), or **REFUNDED** if the validators judged the breach
     total.
6. Open each finished order's dossier, using the "Open the full dossier" link.

Nothing from this step goes into the evidence table: the free plan has no disk, so orders last
only until the server next restarts. The on-network transactions from steps 3–6 are the evidence.

> After a restart the ledger holds only the seed records, including the v0.1 flagship `RC-000042`,
> which the dispute page labels *Recorded on acceptance (v0.1)*. On a host with a disk, records
> from v0.1 stay as they are, and any v0.1 dispute still in flight is polled at the contract it
> was sent to.

---

## 8. Record the evidence and publish

If you used the evidence workflow ("The short way"), it has already done 1–3: go to 4.

1. Fill in the **Evidence to cite** table in `MILESTONE.md`, and the `0x…` placeholders in its
   **Submission text**.
2. Optional: update the *Current deployment* table in `DEPLOY.md` with the v2 address.
3. Commit and push:

   ```bash
   git add MILESTONE.md DEPLOY.md
   git commit -m "Milestone evidence: v2 deployment, live appeal, graduated ruling"
   git push
   ```

4. GitHub → **Actions**. The **CI** workflow runs lint, types, `npm test` and the contract tests
   on every push. It was green on the PR branch. A green run on `main` after merging is good
   evidence to link.

---

## 9. Submit the milestone

Open the GenLayer portal → your project → **Milestones** → new milestone. Paste the
**Submission text** from `MILESTONE.md`, and link:

- the repository, or the merged PR;
- `MILESTONE.md` and `CHANGELOG.md`;
- the v2 contract explorer page;
- the appeal transaction;
- the live URL.

Remember: one milestone can await review at a time, and the weekly slot resets Monday 00:00 UTC.

---

## Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `RULING_NOT_FINAL` when settling | Working as intended: the ruling is still provisional | Wait for finality; the demo keeps polling |
| Demo sits in *Provisional — awaiting finality* | The finality window has not closed | Wait; Studio's window is short, contract networks may be longer |
| `APPEAL_WINDOW_CLOSED` | The network no longer accepts an appeal for that decision | Nothing to do; the ruling stands |
| `APPEAL_UNAVAILABLE` … insufficient funds | The signing key cannot pay the bond | On Studio it is topped up automatically; elsewhere fund `GENLAYER_PRIVATE_KEY` |
| `Refusing to act on this ruling: …made against inputs…` | The contract holds a ruling for that id made against other inputs (a reused id on the v1 contract) | Expected protection. Use the v2 contract; the dispute can be resubmitted |
| Adjudications fail with a runner error on a deployed contract | Studio dropped the runner it was deployed with. v1 and the current v2 deployment both use the rc3–rc7 runner, which hosted Studio still ran on 2026-10-15 | Redeploy (step 3, or the workflow with **Deploy a new contract…** ticked). The script picks a runner the network carries, and the app follows `genlayer.deployment.json` |
| The live site takes about a minute to open, or shows only the seed records | Render's free plan sleeps after 15 idle minutes and has no disk | Expected on the free plan. A paid plan with the disk from `render.yaml` keeps orders |
| `npm run test:live` fails in PowerShell | The npm script uses bash syntax | Use the PowerShell command in step 6 |
| Contract tests cannot find the runner | `GENVM_VERSION` does not match the contract's pin | Set `GENVM_VERSION=v0.6.0-rc9` (or the release matching line 2) |
