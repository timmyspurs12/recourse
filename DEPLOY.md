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
   GENLAYER_NETWORK=studionet
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

## Going from Studionet to a public testnet

Studionet is a **hosted development sandbox**: free, auto-funded, no wallet needed — but it is a
dev environment, and contracts there can be reaped. For a submission that has to stay verifiable
for weeks, deploy to a public testnet with a real explorer.

| Network | Explorer | Fees | Use when |
| --- | --- | --- | --- |
| `studionet` | `studio.genlayer.com` (Studio UI) | none | development, and as a fallback |
| `testnet-bradbury` | `explorer-bradbury.genlayer.com` | GEN | **persistent, production-like — recommended** |
| `testnet-asimov` | `explorer-asimov.genlayer.com` | GEN | infrastructure / stress testing |

### Steps

```bash
# 0. Install dependencies first. The repository ships without node_modules,
#    so every npm script fails with MODULE_NOT_FOUND until this is done.
npm install

# 1. Create a deployment wallet (prints the key ONCE — save it)
npm run wallet

# 2. Fund the address at https://testnet-faucet.genlayer.foundation/
#    A deployment costs roughly 0.0018 GEN, so one drip goes a long way.

# 3. Deploy. The script refuses to start on an unfunded wallet and tells you why.
npm run genlayer:deploy -- --network testnet-bradbury --key 0xYOUR_KEY
```

The flags work in every shell. If you are in bash and prefer environment
variables, `GENLAYER_NETWORK=... GENLAYER_PRIVATE_KEY=... npm run genlayer:deploy`
does the same thing — but that syntax fails in PowerShell and cmd.

It prints the explorer link to paste into the submission form and updates
`genlayer.deployment.json` so a fresh clone points at the same contract.

### Then point the live app at it

In Railway → Variables:

```
GENLAYER_NETWORK=testnet-bradbury
GENLAYER_PRIVATE_KEY=0xYOUR_KEY
GENLAYER_CONTRACT_ADDRESS=0xYOUR_CONTRACT
```

> **Every adjudication now costs GEN from that wallet.** Each demo run a judge triggers spends a
> fee. Adjudication is rate limited to 10/min, but keep an eye on the balance during judging — and
> know that if it empties, the forum reports `FAILED` and the escrow stays held rather than
> producing a wrong outcome. Top up from the faucet if needed.

If you would rather not manage a balance during judging, keep the deployed app on `studionet` and
submit the Bradbury contract link alongside it — but say plainly in the how-to which network the
running demo uses, because the panel will check.

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
npm run seed        # ~40s, includes one live GenLayer adjudication
npm test            # 39 passing
npm run build       # clean
```

Then on the deployed URL:

- `/` loads and the header shows `GENLAYER STUDIONET`.
- `/demo` → "Promise breached" → completes in ~30s and ends `REFUNDED`.
- `/demo` → "Promise satisfied" → completes in ~2s and ends `RELEASED`.
- `/disputes/dsp_rc-000042` shows a real transaction hash and real validator votes.
- `GET /api/network` reports `"available": true` for adjudication.

If adjudication reports unavailable, studionet has reaped the contract. Redeploy and update
`genlayer.deployment.json`:

```bash
npm run genlayer:deploy
```

---

## Production hardening (worth doing if the URL will be public for two weeks)

```
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
