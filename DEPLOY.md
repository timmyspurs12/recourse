# Deploying Recourse

The submission form requires a **live website URL**. This is the shortest path to one.

---

## The one thing that constrains hosting

Recourse persists its ledger to a file (`.recourse/ledger.json`) behind a `RecourseStore` port. So
the host needs **a writable, persistent disk**.

That rules out plain Vercel/Netlify serverless: the filesystem is read-only apart from `/tmp`, and
every invocation may land on a different instance, so protected transactions would vanish
mid-demo. Use a container host with a volume — or implement the Postgres adapter
(`infra/store/schema.sql` is already written to match the entities exactly).

**Recommended: Railway.** Free tier, Docker support, one-click volume, ~5 minutes.

---

## Option A — Railway (recommended)

1. Push the repo to GitHub (see below).
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → pick it.
   `railway.json` and the `Dockerfile` are detected automatically.
3. **Add a volume:** service → *Settings* → *Volumes* → **Add Volume**, mount path
   `/app/.recourse`. Without this the ledger resets on each deploy.

   > **Volume permissions.** Railway (and Fly, and plain `docker run -v`) attach volumes owned by
   > root, which discards the ownership set at build time. The image handles this itself: the
   > entrypoint starts as root, takes ownership of the mount, then drops to uid 1001 before
   > running the app. You do **not** need `RAILWAY_RUN_UID=0`, and you should not set it — it
   > runs the entire application as root to work around a problem the image already solves.
   >
   > If you previously set `RAILWAY_RUN_UID`, remove it after deploying this version.
4. **Variables** (Settings → Variables):
   ```
   GENLAYER_NETWORK=studio-next
   GENLAYER_CONTRACT_ADDRESS=0x…        # from `npm run genlayer:deploy`
   GENLAYER_PRIVATE_KEY=0x…             # pays the fee deposit for each ruling
   RECOURSE_REQUIRE_AUTH=1
   RECOURSE_STORE_FILE=/app/.recourse/ledger.json
   ```
5. **Networking → Generate Domain.** That URL goes in the form's *Website* field.

First boot copies `data/seed-ledger.json` into the volume, so the site opens with the real
adjudicated flagship (RC-000042) already on record.

## Option B — Render

`render.yaml` is committed with the disk already declared.
[render.com](https://render.com) → **New** → **Blueprint** → point at the repo → Apply.

## Option C — Fly.io

```bash
fly launch --no-deploy            # accept the Dockerfile
fly volumes create recourse_data --size 1
# add to fly.toml:
#   [mounts]
#   source = "recourse_data"
#   destination = "/app/.recourse"
fly deploy
```

## Option D — any VPS

```bash
docker build -t recourse .
docker run -d -p 80:3000 -v recourse-data:/app/.recourse \
  -e GENLAYER_NETWORK=studionet --name recourse recourse
```

---

## The network: Studio Next

The hackathon requires the deployment to run on **Studio Next** — Consensus v0.6,
chain id **61997**, explorer `https://explorer-studio-dev.genlayer.com/`. That is
the default here.

**The RPC endpoint is `https://studio-dev.genlayer.com/api`.** `studio-next.genlayer.com`
serves the browser app and is an alias; the canonical JSON-RPC endpoint for chain
61997 — the one the SDK's `studioDevnet` preset, the `genlayer` CLI and
`genlayer-py` all use — is the `studio-dev` hostname. `integrations/genlayer/config.ts`
points there, and the label `GENLAYER STUDIO NEXT` is applied on top of it. Use
the canonical host in any integration; the alias is for humans with browsers.

| Network | Chain | Fees | Use when |
| --- | --- | --- | --- |
| `studio-next` | 61997 | quoted per write | **the submission** — the required network, with an explorer link |
| `studio-dev` | 61997 | quoted per write | the same chain and the same endpoint, without the explorer preset |
| `testnet-bradbury` | 4221 | GEN | durable, production-like verification with a public explorer |
| `studionet` | 61999 | gasless | the previous stable Studio (Consensus v0.5) |
| `localnet` | — | gasless | a local GenLayer node |

Studio Next is a hosted development network and **may be reset**. A ruling there
is real consensus, but it is not durable for weeks the way a Bradbury deployment
is; the app reports it as `DEMO` for exactly that reason rather than over-claiming.

### Current deployment

| | |
| --- | --- |
| Contract | `0x17DA09A8d79d5ef709655f71a5e6AC4c3885CD56` |
| Chain | 61997 · Studio Next · `https://studio-dev.genlayer.com/api` |
| Deploy tx | [`0x69e1be16eb0cd40e3cc029d5938ca3d20ae78dac492445617a71150a15f86a7f`](https://explorer-studio-dev.genlayer.com/tx/0x69e1be16eb0cd40e3cc029d5938ca3d20ae78dac492445617a71150a15f86a7f) |
| Result | `FINALIZED` · consensus `Accepted` · execution `FINISHED_WITH_RETURN` · 5 validators |
| Fee | 0.175 GEN deposited, 0.000078 GEN consumed, 0.174921 GEN refunded |
| Explorer | https://explorer-studio-dev.genlayer.com/address/0x17DA09A8d79d5ef709655f71a5e6AC4c3885CD56 |

The same values live in `genlayer.deployment.json`, which a fresh clone reads by
default — `GENLAYER_CONTRACT_ADDRESS` is only needed to override them.

### The runner pin, and why a deploy can fail with nothing wrong locally

Line 2 of `contracts/recourse_adjudicator.py` names the runner GenVM must load:

```python
# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
```

That hash identifies a **build of the python runner**, and GenVM repackages it
between releases. It therefore tracks the *network*, not the contract: when the
fleet moves to a new GenVM release the hash changes, and a contract pinning the
previous one stops deploying even though nothing about it changed.

This is not a hypothetical. Both halves were observed on chain 61997 on the same
day, 71 minutes apart, with the same contract source and the same fee preset:

| | `9b8kjyda…` (GenVM v0.6.0-rc1/rc2) | `5jycge4q…` (v0.6.0-rc3) |
| --- | --- | --- |
| Deploy tx | [`0x8a9d30c2…`](https://explorer-studio-dev.genlayer.com/tx/0x8a9d30c242fc758f5be19d0a8d25e39fbece1e775e1f0595424906372d2f6f5e) | [`0x69e1be16…`](https://explorer-studio-dev.genlayer.com/tx/0x69e1be16eb0cd40e3cc029d5938ca3d20ae78dac492445617a71150a15f86a7f) |
| Execution | `ERROR` — `invalid_contract runner malformed` | `SUCCESS` — `Return` |
| Storage written | **0 wei** | 100,250,000,000 wei |
| Address | `0xa57a7aA7…` — **orphan, no code behind it** | `0x17DA09A8…` — live |
| Tx status | `FINALIZED`, consensus `Accepted` | `FINALIZED`, consensus `Accepted` |

Read the last row twice: the failed deploy **finalized with consensus Accepted**.
A transaction that succeeded as far as the network's consensus is concerned
stored nothing at all. Two consequences follow, and the repo is built around both:

1. **`FINALIZED` is not success.** `scripts/genlayer-deploy.mts` requires
   `FINISHED_WITH_RETURN` *and* a reported address before it writes any record,
   which is why the orphan address above was never recorded anywhere.
2. **Local validation cannot catch this.** `runnerPinProblems()` checks shape,
   alphabet and canonical gvm32 — `9b8kjyda…` passes all three, because it is a
   perfectly valid hash of a runner this fleet no longer ships. Only the network
   knows what it has, so the deploy script now asks it first with
   `getContractSchemaForCode`, which compiles the source against the live runner
   cache for free and refuses to take a fee deposit for a contract the network
   cannot load. Skip it with `RECOURSE_SKIP_SCHEMA_PROBE=1`.

If a deploy fails this way: check which Studio release the target network is
running, read the pin its example contracts use, and update line 2 to match.
`integrations/genlayer/runner-pin.ts` holds the expected value as
`STUDIO_NEXT_PY_GENLAYER_PIN`, and `tests/genlayer.test.ts` asserts the contract
agrees with it — so update both, or the test tells you.


### Fees, honestly

On v0.6 a deploy and a write are not free by default: each reserves a **fee
deposit** against the network's published price ceilings, and unused budget is
refunded at finalization. Recourse does not compute that number itself:

1. the quote comes from an optional measured `fee-profile.json`, priced at quote
   time by the network (`@genlayer/transaction-kit` does the work);
2. the app submits the returned distribution and fee value **unchanged**;
3. if the quote disagrees with the network's live fee policy, nothing is signed.
   The referral fails with the reason, and the escrow stays held while the
   operator retries — which is strictly better than a transaction that is
   cancelled at activation.

A deposit is not a price. The UI shows the deposit, and consumption and refund
separately, and prints "not reported" rather than inferring one from the other.

**Who pays.** Adjudication is submitted by the protocol, not by a user, so the
signer is the deployment's key: `GENLAYER_PRIVATE_KEY`. On Studio the sandbox can
fund an account itself, so an unfunded key is topped up automatically
(`sim_fundAccount`) when the balance is below the quoted deposit. On a public
testnet there is no such facility and the key must be funded from the faucet.

### Measuring a fee profile (optional, recommended for a final submission)

A profile makes the deposit reflect what *this* contract actually costs instead
of the network's default allocations:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt                     # genlayer-test / gtest
gltest tests/ --network studio-next --fee-profile fee-profile.json
```

Commit the result as `fee-profile.json` at the repo root. It must declare
`chainId: 61997`; a profile measured on another chain is **ignored**, with the
reason shown in `/api/network` and on the referral panel. If no profile is
present the app runs on network-default allocations inside live price caps, and
says so — that is a supported path, not a degraded one.

### Steps

```bash
# 0. Install dependencies first. The repository ships without node_modules,
#    so every npm script fails with MODULE_NOT_FOUND until this is done.
npm install

# 1. Deploy to Studio Next (no faucet needed: the sandbox funds the account).
npm run genlayer:deploy

#    Or on a public testnet, with a funded key:
#      npm run wallet                       # prints a key once — save it
#      # fund the address at https://testnet-faucet.genlayer.foundation/
#      npm run genlayer:deploy -- --network testnet-bradbury --key 0xYOUR_KEY
```

The script quotes the deploy fee, refuses to sign a quote that disagrees with the
network's live policy, deploys, tracks to finalization, and writes both
`.recourse/genlayer.json` (this machine) and `genlayer.deployment.json` (the
committed default, merged per network). It prints the explorer link for the
submission form.

### Then point the live app at it

In Railway → Variables:

```
GENLAYER_NETWORK=studio-next
GENLAYER_PRIVATE_KEY=0xYOUR_KEY
GENLAYER_CONTRACT_ADDRESS=0xYOUR_CONTRACT
```

> **Each adjudication escrows a fee deposit from that wallet.** Adjudication is
> rate limited to 10/min, and unused budget is refunded at finalization, so a
> demo run costs far less than the deposit. Watch the balance during judging: if
> the key empties, the forum reports `FAILED` with the reason and the escrow
> stays held rather than producing a wrong outcome.

`npm run genlayer:smoke` runs one real adjudication — including a
prompt-injection payload — against the contract and prints the votes, the
execution result and the ruling. Run it after deploying, before submitting.

---

## Push to GitHub

The repo is committed locally already (one commit, 146 files, no secrets — `.recourse/`,
`node_modules`, `.next` and `.env` are all ignored).

```bash
# 1. Create an EMPTY public repo named "recourse" on github.com — no README,
#    no .gitignore, no licence, or the first push will conflict.

cd recourse
git branch -M main
git remote add origin https://github.com/<your-username>/recourse.git
git push -u origin main
```

If you use SSH: `git remote add origin git@github.com:<your-username>/recourse.git`.

The repo must be **public** and owned by **the GitHub account linked to your portal profile** —
the panel reviews it directly.

---

## Before you submit — a five-minute check

```bash
npm install
npm run seed        # ~40s, includes one live adjudication (network + fee deposit)
npm test            # 58 passing
npm run build       # clean
```

Then on the deployed URL:

- `/` loads and the header shows `GENLAYER STUDIO NEXT` with chain id 61997.
- `/demo` → "Promise breached" → completes and ends `REFUNDED`; the referral
  panel shows the fee deposit and the policy as `verified`.
- `/demo` → "Promise satisfied" → ends `RELEASED` with no adjudication at all.
- `/disputes/dsp_rc-000042` shows a real transaction hash and real validator votes.
- `GET /api/network` reports `"available": true`, `"chainId": 61997`, and a
  `fees` block.

If adjudication reports unavailable, no address is configured for the selected
network — deploy (or set `GENLAYER_CONTRACT_ADDRESS`):

```bash
npm run genlayer:deploy
```

> **Building offline?** `next build` fetches Geist from Google Fonts at build
> time. With no internet the build fails at that step with a message naming the
> font; that is the sandbox, not the app. Build somewhere with egress, or
> self-host the font with `next/font/local`.

## Production hardening (worth doing if the URL will be public for two weeks)

```
GENLAYER_NETWORK=studio-next  # the network the hackathon requires
RECOURSE_DEMO_ENDPOINTS=1     # keep ON for judges — it is the keyless demo path
RECOURSE_REQUIRE_AUTH=1       # writes need signed agent requests (default)
RECOURSE_STRICT_REGISTRY=0    # keep 0 so integrators can self-bind via TOFU
```

Adjudication is already rate limited to 10/min per client and demo runs to 20/min, so a stranger
cannot drain the network budget. Every demo run appends a real order to the ledger — that is
intended, and the ledger labels seeded records separately from live ones. To reset it:

```bash
rm .recourse/ledger.json && npm run seed
```

**Do not** point a public deployment at a funded facilitator or a real escrow address unless you
mean it. Left unset, settlement is recorded honestly as not broadcast, which is what the UI says.
