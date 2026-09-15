# Demo video — 90 seconds, scripted

The hackathon requires a demo video. This is a timed script matched to what the
product actually does, plus the shot list and the exact strings to look for
while recording. The narration is also delivered as a separate audio file, so the
recording itself needs no microphone.

**Target length: 90 seconds.** Do not cut the "Promise satisfied" section — it is
the part that proves the adjudication layer is not a buyer-side tax.

---

## What the video has to establish

A viewer who has never seen GenLayer should be able to answer, by the end:

1. what the app does (a purchase that can be undone when the promise is broken);
2. why decentralized judgment is needed at all (one question, the one code cannot
   answer);
3. that the ruling is real (validators, votes, transaction hash, chain 61997);
4. that the merchant can win (the satisfied path releases without adjudication).

---

## Shot list

| Time | Screen | Action | What is on screen |
| --- | --- | --- | --- |
| 0:00–0:08 | `/` | Hold, then scroll one screen | The thesis line, and `GENLAYER STUDIO NEXT` with chain id **61997** in the header |
| 0:08–0:20 | `/demo` | Point at the agreement panel | Five terms: `minimum_sources ≥ 5`, `max_source_age_days ≤ 30`, `geography = Lagos, Nigeria`, `required_sections = 4`, material accuracy |
| 0:20–0:35 | `/demo` | Choose **Promise breached**, press **Run protected purchase** | Escrow opens, delivery lands, the header reads `4 resolved locally / 1 referred to GenLayer`. Verification shows `2 < 5 → BREACH`, marked deterministic |
| 0:35–0:55 | `/demo` | Let it sit on `ADJUDICATING` | The scan bar, the elapsed wait, and the referral panel's **Transaction fee** block: deposit, `measured profile`/`network default`, policy `verified` |
| 0:55–1:05 | `/disputes/[id]` | Open the dossier from the settled order | Ruling `BUYER_WINS`, the real transaction hash, each validator address with the vote it cast |
| 1:05–1:20 | `/demo` | Switch to **Promise satisfied**, run it | Every term passes, *no adjudication row at all*, settlement `RELEASED` in roughly two seconds |
| 1:20–1:30 | `/disputes` or `/protocol` | Hold | Evidence hashes and the contract address, for anyone who wants to verify after watching |

**Recording notes**

- 125% browser zoom, 1440×900 or larger, dark mode as shipped.
- Do not cut away from `ADJUDICATING`. The ~30-second wait *is* the proof; if the
  network is slow, let it run and say so rather than editing it out.
- If a ruling is already on record, `/disputes/dsp_rc-000042` can be shown
  instead of a fresh run — but a fresh run is the stronger footage.

---

## Narration (~1:28 at a normal pace)

> Payments got autonomous. In four hundred milliseconds, an agent can pay without
> asking anyone. If what arrives is wrong, it has no move — no chargeback, no
> dispute form, no card network.
>
> Recourse makes the payment conditional on the promise. Two agents agree
> machine-readable terms, and the money is escrowed against a hash of those terms
> before anything is delivered. Here, a dollar buys a Lagos market brief: at least
> five sources, under thirty days old, Lagos scope, four sections, and material
> accuracy.
>
> Run the breach path. The merchant delivered two sources. Counting is arithmetic,
> so code settles it: two is less than five — a breach — and no model is involved.
> One term is left, the semantic one: was that shortfall material? That is the only
> question sent to GenLayer.
>
> This wait is real. Validators on Studio Next, chain 61997, each re-run the
> judgment and must independently agree. And the fee deposit: quoted from the
> network's live prices, policy verified, submitted unchanged.
>
> Consensus ruled for the buyer, and the dollar is refunded. The dossier shows the
> validator votes and the transaction exactly as the network reported them.
>
> Now the satisfied path: every term passes, no adjudication happens at all, and
> the merchant is paid in about two seconds. The AI is only consulted for the one
> question code cannot answer.

---

## If something is unavailable on the day

Say it out loud and use the recorded state instead of hiding it — the build's
credibility rests on not over-claiming:

- **Adjudication unavailable** → the app says no forum is configured for the
  network. Deploy first (`npm run genlayer:deploy`); then the referral panel and
  the dossier carry a real hash.
- **The fee quote reads `mismatch`** → the protocol refuses to sign it, on
  purpose, and says so on the panel. That is the price-protection path, not a bug.
- **Validator votes not yet reported** → the panel prints `NOT AVAILABLE` rather
  than inventing a consensus. Come back after finalization.
