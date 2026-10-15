# On-network evidence: Recourse v0.2 on GenLayer Studio Next (run #2)

Produced by the **GenLayer evidence** workflow ([`.github/workflows/genlayer-evidence.yml`](../.github/workflows/genlayer-evidence.yml)),
[run #2](https://github.com/timmyspurs12/recourse/actions/runs/38755257138), finished 2026-10-15 14:53 UTC.
Every value below was printed by the network during that run; the complete logs follow the table.
Nothing here is typed by hand, and a check that did not pass is recorded as such.

| Check | Result | Evidence |
| --- | --- | --- |
| Contract v2 (deployed by an earlier run) | ↺ reused | [`0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581`](https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581) · deploy tx [`0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3`](https://explorer-studio-dev.genlayer.com/tx/0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3) · runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| Smoke: all-or-nothing, with a prompt-injection attempt (`npm run genlayer:smoke`) | ↺ recorded by an earlier run | tx [`0x576aa265cce7321944cee3ef2515707c8428e7ab93f7186efdc6661695e1844c`](https://explorer-studio-dev.genlayer.com/tx/0x576aa265cce7321944cee3ef2515707c8428e7ab93f7186efdc6661695e1844c) · ruling `BUYER_WINS` although the merchant text ordered `MERCHANT_WINS` · [run #1](run-1.md) |
| Smoke: graduated remedy (`npm run genlayer:smoke -- --graduated`) | ↺ recorded by an earlier run | tx [`0x4b5e3ae37255bea81a5361a3b0921a370fae380abb5e937770c4804d6702da85`](https://explorer-studio-dev.genlayer.com/tx/0x4b5e3ae37255bea81a5361a3b0921a370fae380abb5e937770c4804d6702da85) · ruling `SPLIT`, `refund_bps 4000` (40% back to the buyer) · [run #1](run-1.md) |
| Appeal through GenLayer, provisional → final (`npm run genlayer:appeal`) | ✅ passed | adjudicate tx [`0x85fb85c988345a8f374309f91e4eb0f14d8ad6ab020d5533579698a96c07a22c`](https://explorer-studio-dev.genlayer.com/tx/0x85fb85c988345a8f374309f91e4eb0f14d8ad6ab020d5533579698a96c07a22c) · remedy `GRADUATED` · charge `<0.000001 GEN` · provisional `SPLIT 40%` → final `SPLIT 40%` · `UPHELD` · FINALIZED |
| Live tests (`npm run test:live`) | ↺ recorded by an earlier run | 3 passed, 0 failed · [`0x735dfab4a2a1eeee505b14800fed0a0ff281db1f318f877c9ab8aafc27aa9a32`](https://explorer-studio-dev.genlayer.com/tx/0x735dfab4a2a1eeee505b14800fed0a0ff281db1f318f877c9ab8aafc27aa9a32) · [`0x1ce1bebe276b257ac22f02097c5301fe3c96a019f9b769389b19a1af9c333521`](https://explorer-studio-dev.genlayer.com/tx/0x1ce1bebe276b257ac22f02097c5301fe3c96a019f9b769389b19a1af9c333521) · [`0x599b03500d420af39edaf874eda637251ee2fcdcdbf57041e64288f6115a2d6c`](https://explorer-studio-dev.genlayer.com/tx/0x599b03500d420af39edaf874eda637251ee2fcdcdbf57041e64288f6115a2d6c) · [run #1](run-1.md) |

Contract: [`0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581`](https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581) · chain 61997 · `https://studio-dev.genlayer.com/api`. The previous deployment, `0x17DA09A8d79d5ef709655f71a5e6AC4c3885CD56`, stays under `history` in `genlayer.deployment.json`.

## Logs

<details><summary>1 · deploy</summary>

````text
Contract v2.0.0 is already recorded in genlayer.deployment.json; not deploying again.
````

</details>

<details><summary>2 · smoke test, all-or-nothing</summary>

````text
(this step did not run)
````

</details>

<details><summary>3 · smoke test, graduated</summary>

````text
(this step did not run)
````

</details>

<details><summary>4 · appeal</summary>

````text
── attempt 1 ──
network:   GENLAYER STUDIO NEXT (chain 61997)
contract:  0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
dispute:   dsp_appeal_1792075964913
remedy:    GRADUATED
warning:   GENLAYER STUDIO NEXT can charge fees and no GENLAYER_PRIVATE_KEY is set, so writes will be attempted with an unfunded ephemeral account. Whether any fee is actually charged is read from the live quote, not assumed.
adjudicate tx: 0x85fb85c988345a8f374309f91e4eb0f14d8ad6ab020d5533579698a96c07a22c
submitter:     0x1FfA7A406881b5Cd75aFA04F4B7eb2BC032Ae880
deposit:       0.175 GEN

waiting for a provisional ruling…
  PENDING   PENDING · pending · failed appeals 0
  PENDING   PROPOSING · proposing · failed appeals 0
  PENDING   COMMITTING · committing · failed appeals 0
  DECIDED   ACCEPTED · failed appeals 0 · next action NoOp

provisional ruling: SPLIT 40% — A mandatory requirement for five sources was breached because only three were delivered. The work still satisfied geography and section requirements and delivered substantial, but incomplete, evidentiary value, so a partial refund is appropriate.
decision id:        1

appealing as the merchant…
appeal:    FILED
charge:    <0.000001 GEN (bond + funding, quoted by the network)
paid by:   0x6B393e6d7426b9A6bB11B39678d0FC5880E6E003

following the appeal round to finality…
  DECIDED   ACCEPTED · failed appeals 0 · appeal in flight · next action NoOp
  PENDING   COMMITTING · committing · failed appeals 0 · appeal in flight
  DECIDED   ACCEPTED · failed appeals 1 · next action NoOp
GenLayer RPC error (gen_call): Rate limit exceeded: 30 requests per minute
GenLayer RPC error (gen_call): Rate limit exceeded: 30 requests per minute
GenLayer RPC error (gen_call): Rate limit exceeded: 30 requests per minute
  FINALIZED FINALIZED · failed appeals 1

──────── summary (paste into the milestone notes) ────────
network:            GENLAYER STUDIO NEXT (chain 61997)
contract:           0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
adjudicate tx:      0x85fb85c988345a8f374309f91e4eb0f14d8ad6ab020d5533579698a96c07a22c
provisional ruling: SPLIT 40% — A mandatory requirement for five sources was breached because only three were delivered. The work still satisfied geography and section requirements and delivered substantial, but incomplete, evidentiary value, so a partial refund is appropriate.
appeal charge:      <0.000001 GEN
final ruling:       SPLIT 40% — A mandatory requirement for five sources was breached because only three were delivered. The work still satisfied geography and section requirements and delivered substantial, but incomplete, evidentiary value, so a partial refund is appropriate.
appeal outcome:     UPHELD
final status:       FINALIZED
explorer:           https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
````

</details>

<details><summary>5 · live tests</summary>

````text
(this step did not run)
````

</details>
