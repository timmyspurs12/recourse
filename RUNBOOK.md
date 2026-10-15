# Runbook — deploy and verify Recourse v0.2

Step by step, in order. Each step says what to run, what you should see, and what to copy into
the evidence table in [`MILESTONE.md`](MILESTONE.md). Commands are shown for **bash** (macOS,
Linux, Git Bash on Windows) and, where they differ, **PowerShell**.

Total time: about 45 minutes, most of it waiting for validators.

---

## 0. What you need

- **Node.js 20** and npm. Check with `node -v` (it should print `v20…`).
- **Git**, with this repository cloned.
- **A GenLayer private key** for signing: 64 hex characters, written with a `0x` prefix. The one
  that deployed v1 (`0x6441F8…`) is fine.
  - On Studio Next the sandbox tops up a low balance automatically.
  - If you do not have one: `npm run wallet` prints a new key once. Save it somewhere safe.
- **Optional, for the contract tests:** Python **3.12 or newer** (`python3 --version`).
- **Railway access** to the existing project.

Throughout, replace `0xYOUR_KEY` with your key. Never paste it into chat, a commit or a screenshot.

---

## 1. Get the v0.2 code

The work is on branch `arena/5d3d9dea-recourse`, opened as a pull request against `main`.
Reviewers and Railway both look at `main`, so merge it first.

1. On GitHub, open the pull request, review it, and click **Merge pull request**.
   - Or use the CLI: `gh pr merge <number> --merge`.
2. Update your local copy:

   ```bash
   git checkout main
   git pull
   npm ci
   ```

> Want to test before merging? Run `git fetch && git checkout arena/5d3d9dea-recourse`, then
> `npm ci`, and do steps 2–6 on the branch. Merge before step 7.

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
npm run genlayer:deploy -- --key 0xYOUR_KEY
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

From here on the scripts read the key from an environment variable. Set it once per terminal.

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
npm run genlayer:appeal
```

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

Studio's window is short. Simply run it again. You can add `-- --graduated` to appeal a split
ruling instead.

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

## 7. Point the live app (Railway) at v2

1. Make sure step 1's merge, and step 3's commit of `genlayer.deployment.json`, are on `main`.
   Railway deploys `main`.
2. Railway → your service → **Variables**:
   - **`GENLAYER_CONTRACT_ADDRESS`** → set to the **new v2 address** from step 3.
   - **`GENLAYER_PRIVATE_KEY`** → keep it set. It pays fee deposits and, in v0.2, appeal bonds.
   - Leave `GENLAYER_NETWORK=studio-next`, `RECOURSE_REQUIRE_AUTH=1` and
     `RECOURSE_STORE_FILE=/app/.recourse/ledger.json` as they are.
3. **Deployments** → redeploy, or wait for the automatic deploy from the push.
4. Check the deployment answers with the new contract. Open
   `https://recourse-production-bf02.up.railway.app/api/network` and confirm
   `adjudication.contractAddress` is the v2 address.
5. Run the live demo at `/demo`.
   - **Promise breached.** The order moves through **PROVISIONAL RULING**. While provisional you can
     press **Appeal as the merchant** (optional). It reaches a final ruling, then the refund. The
     settlement panel says *Escrow held until the ruling is final* until finality.
   - **Partial delivery.** This should end **PARTIALLY REFUNDED**, with two settlement legs (for
     example $0.40 back and $0.60 released), or **REFUNDED** if the validators judged the breach
     total.
6. Open each finished order's dossier, using the "Open the full dossier" link.

**Copy into the evidence table:**

- Both order ids (`RC-…`).
- The adjudication transaction shown on each dispute page.

> Records already in the Railway ledger from v0.1 stay as they are. The dispute page labels them
> *Recorded on acceptance (v0.1)*. Any v0.1 dispute still in flight is polled at the contract it
> was sent to.

---

## 8. Record the evidence and publish

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
| Adjudications fail on the **old** v1 contract | Studio's rc9 move can stop the rc7 runner from loading | Redeploy v2 (step 3) and repoint Railway (step 7) |
| `npm run test:live` fails in PowerShell | The npm script uses bash syntax | Use the PowerShell command in step 6 |
| Contract tests cannot find the runner | `GENVM_VERSION` does not match the contract's pin | Set `GENVM_VERSION=v0.6.0-rc9` (or the release matching line 2) |
