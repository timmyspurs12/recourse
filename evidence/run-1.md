# On-network evidence: Recourse v0.2 on GenLayer Studio Next (run #1)

Produced by the **GenLayer evidence** workflow ([`.github/workflows/genlayer-evidence.yml`](../.github/workflows/genlayer-evidence.yml)),
[run #1](https://github.com/timmyspurs12/recourse/actions/runs/38751448403), finished 2026-10-15 14:33 UTC.
Every value below was printed by the network during that run; the complete logs follow the table.
Nothing here is typed by hand, and a check that did not pass is recorded as such.

| Check | Result | Evidence |
| --- | --- | --- |
| Contract v2 deployed (`npm run genlayer:deploy`) | ✅ passed | [`0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581`](https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581) · deploy tx [`0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3`](https://explorer-studio-dev.genlayer.com/tx/0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3) · runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` · `RecourseAdjudicator 2.0.0 · remedy modes ALL_OR_NOTHING, GRADUATED · tolerance 1000 bps` |
| Smoke: all-or-nothing, with a prompt-injection attempt (`npm run genlayer:smoke`) | ✅ passed | tx [`0x576aa265cce7321944cee3ef2515707c8428e7ab93f7186efdc6661695e1844c`](https://explorer-studio-dev.genlayer.com/tx/0x576aa265cce7321944cee3ef2515707c8428e7ab93f7186efdc6661695e1844c) · FINALIZED · ruling `BUYER_WINS`, as expected, although the merchant text ordered `MERCHANT_WINS` |
| Smoke: graduated remedy (`npm run genlayer:smoke -- --graduated`) | ✅ passed | tx [`0x4b5e3ae37255bea81a5361a3b0921a370fae380abb5e937770c4804d6702da85`](https://explorer-studio-dev.genlayer.com/tx/0x4b5e3ae37255bea81a5361a3b0921a370fae380abb5e937770c4804d6702da85) · FINALIZED · ruling `SPLIT`, `refund_bps 4000` (40% back to the buyer) |
| Appeal through GenLayer, provisional → final (`npm run genlayer:appeal`) | ❌ did not pass | no summary printed |
| Live tests (`npm run test:live`) | ✅ passed | 3 passed, 0 failed · [`0x735dfab4a2a1eeee505b14800fed0a0ff281db1f318f877c9ab8aafc27aa9a32`](https://explorer-studio-dev.genlayer.com/tx/0x735dfab4a2a1eeee505b14800fed0a0ff281db1f318f877c9ab8aafc27aa9a32) FINALIZED · [`0x1ce1bebe276b257ac22f02097c5301fe3c96a019f9b769389b19a1af9c333521`](https://explorer-studio-dev.genlayer.com/tx/0x1ce1bebe276b257ac22f02097c5301fe3c96a019f9b769389b19a1af9c333521) FINALIZED · [`0x599b03500d420af39edaf874eda637251ee2fcdcdbf57041e64288f6115a2d6c`](https://explorer-studio-dev.genlayer.com/tx/0x599b03500d420af39edaf874eda637251ee2fcdcdbf57041e64288f6115a2d6c) FINALIZED |

Contract: [`0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581`](https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581) · chain 61997 · `https://studio-dev.genlayer.com/api`. The previous deployment, `0x17DA09A8d79d5ef709655f71a5e6AC4c3885CD56`, stays under `history` in `genlayer.deployment.json`.

## Logs

<details><summary>1 · deploy</summary>

````text
No GENLAYER_PRIVATE_KEY set — using an ephemeral account for this deployment.
network:  GENLAYER STUDIO NEXT (chain 61997)
rpc:      https://studio-dev.genlayer.com/api
deployer: 0xf42Dcd05c84c2506E265Ee722dB7e6fA0E26A2E1
contract: /home/runner/work/recourse/recourse/contracts/recourse_adjudicator.py
warning:  GENLAYER STUDIO NEXT can charge fees and no GENLAYER_PRIVATE_KEY is set, so writes will be attempted with an unfunded ephemeral account. Whether any fee is actually charged is read from the live quote, not assumed.
runner:   py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0
GenLayer RPC error (gen_getContractSchemaForCode): ('execution failed', {'stdout': '', 'stderr': '', 'genvm_log': [{'ts': '1792074436959', 'target': 'genvm_common', 'message': 'logging initialized', 'version': 'v0.3.0-rc7-x86_64-linux-release', 'file': 'crates/common/src/lib.rs:66', 'level': 'info'}, {'ts': '1792074436970', 'target': 'genvm::exe::run', 'message': 'genvm id', 'genvm_id': '4226', 'file': 'src/exe/run.rs:368', 'level': 'info'}, {'ts': '1792074436981', 'target': 'genvm::rt::supervisor::actions', 'message': 'runner load', 'runner': 'chain:0x0000000000000000000000000000000000000000:d:q805cc3mbb7k055ay5hek4sg80r2s85yyftpzrpq7g50hy1cc45g', 'runner_load_cost': '4096', 'size': '22620', 'status': 'charged', 'file': 'src/rt/supervisor/actions.rs:357', 'level': 'info'}, {'ts': '1792074436982', 'target': 'genvm', 'message': 'metrics', 'metrics': {'hosts': [{'time': 7498}, {'time': 0}], 'llm_module': {'calls': 0, 'time': 0}, 'supervisor': {'compilation_time': 0, 'compiled_modules': 0, 'precompile_hits': 0}, 'web_module': {'calls': 0, 'time': 0}}, 'file': 'src/lib.rs:611', 'level': 'info'}], 'result': '{"kind": "VM_ERROR", "message": "invalid_contract runner malformed"}'})
probe:    py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0 (GenVM v0.6.0-rc9) → runner-missing — An internal error was received.

Details: ('execution failed', {'stdout': '', 'stderr': '', 'genvm_log': [{'ts': '1792074436959', 'target': 'genvm_common', 'message': 'logging initialized', 'version': 'v0.3.0-rc7-x86_64-linux-release', 'file': 'crates/common/src/lib.rs:66', 'level': 'info'}, {'ts': 
probe:    py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng (GenVM v0.6.0-rc3..rc7) → ok — 5 method(s): adjudicate, get_inputs_hash, get_policy, get_ruling, get_ruling_count
runner:   this network does not carry py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0; deploying with py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng (header rewritten for this deployment only)
balance:  0 GEN
funding:  Studio funded this ephemeral account with 50 GEN
fee note: No fee profile at /home/runner/work/recourse/recourse/fee-profile.json; the quote uses network-default allocations within live price caps.
fee:      deposit 0.175 GEN (network default) · policy verified
deploy tx: 0x4f4850855461e37a759457961574d914cdfd7bf5a88ab82882fd7a30743434b3
  submitted
  pending · PENDING
  processing · REVEALING
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  finalized · FINALIZED
policy:   RecourseAdjudicator 2.0.0 · remedy modes ALL_OR_NOTHING, GRADUATED · tolerance 1000 bps

RecourseAdjudicator deployed on GENLAYER STUDIO NEXT
  address:     0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
  status:      FINALIZED
  execution:   FINISHED_WITH_RETURN
  deposit:     0.175 GEN
  runner:      py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng
  version:     2.0.0
  recorded in: /home/runner/work/recourse/recourse/.recourse/genlayer.json
  committed:   /home/runner/work/recourse/recourse/genlayer.deployment.json

Explorer link (use this for the hackathon submission):
  https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581

Pin it in your deployment environment with:
  GENLAYER_NETWORK=studio-next
  GENLAYER_CONTRACT_ADDRESS=0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
````

</details>

<details><summary>2 · smoke test, all-or-nothing</summary>

````text
network:  GENLAYER STUDIO NEXT (chain 61997)
contract: 0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
signer:   0x4B5b5c1c8E9e52880e1263557Fb4731970E75BE1
fee note: No fee profile at /home/runner/work/recourse/recourse/fee-profile.json; the quote uses network-default allocations within live price caps.
balance:  0 GEN
funding:  Studio funded the signer with 25 GEN
contract: RecourseAdjudicator 2.0.0 · remedy modes ALL_OR_NOTHING, GRADUATED
fee:      deposit 0.175 GEN · policy verified
adjudicate tx: 0x576aa265cce7321944cee3ef2515707c8428e7ab93f7186efdc6661695e1844c
  submitted
  pending · PENDING
  pending · PENDING
  processing · PROPOSING
  processing · PROPOSING
  processing · PROPOSING
  processing · PROPOSING
  processing · PROPOSING
  processing · COMMITTING
  processing · COMMITTING
  processing · COMMITTING
  processing · COMMITTING
  processing · COMMITTING
  processing · COMMITTING
  processing · COMMITTING
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  finalized · FINALIZED
status:       FINALIZED
execution:    FINISHED_WITH_RETURN
successful:   true
votes:        {"0x1dA3a7de8EA65A318bf88Eb63d3dC55295Dd257E":"idle","0x8D32eb5D0207f7E230C45e7BF0D14B2ED5DA3028":"agree","0xE4E106086F167D75E2270fa5f3680f6ac598d179":"agree","0xcEf1Baa172d0b4D99Dcc505B36332F26D1088025":"idle","0xf13c3DfE38C8E206C33F750C24a1b043b63Cb810":"agree"}
RULING:       {"agreement_hash": "0x9f2c00000000000000000000000000000000000000000000000000000000947f", "decision": "BUYER_WINS", "evidence_hash": "0x51aa00000000000000000000000000000000000000000000000000000000b3c1", "inputs_hash": "0x000000000000000000000000000000000000000000000000000001a13ff66e4c", "material_breach": true, "reasoning_summary": "A mandatory minimum of 5 sources was required, and the protocol establishes only 2 were supplied, which is a material shortfall for a market-entry brief. No reliable evidence overcomes that breach, so the buyer did not receive what was contracted for.", "recommended_settlement": "REFUND", "refund_bps": 10000, "remedy_mode": "ALL_OR_NOTHING", "satisfied_terms": [], "schema": "recourse.ruling/2", "submitter": "0x4b5b5c1c8e9e52880e1263557fb4731970e75be1", "violated_terms": ["minimum_sources"]}
dispute id:   dsp_smoke_1792074477132
submitter:    0x4B5b5c1c8E9e52880e1263557Fb4731970E75BE1

explorer: https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
````

</details>

<details><summary>3 · smoke test, graduated</summary>

````text
network:  GENLAYER STUDIO NEXT (chain 61997)
contract: 0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
signer:   0x0d510309a3662bDF4Eb6A69112cE0595d6567AF6
fee note: No fee profile at /home/runner/work/recourse/recourse/fee-profile.json; the quote uses network-default allocations within live price caps.
balance:  0 GEN
funding:  Studio funded the signer with 25 GEN
contract: RecourseAdjudicator 2.0.0 · remedy modes ALL_OR_NOTHING, GRADUATED
fee:      deposit 0.175 GEN · policy verified
adjudicate tx: 0x4b5e3ae37255bea81a5361a3b0921a370fae380abb5e937770c4804d6702da85
  submitted
  pending · PENDING
  processing · PROPOSING
  processing · COMMITTING
  processing · COMMITTING
  processing · COMMITTING
  processing · COMMITTING
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  decided · ACCEPTED
  finalized · FINALIZED
status:       FINALIZED
execution:    FINISHED_WITH_RETURN
successful:   true
votes:        {"0x5cDf4BdDeEDa0e32ED596b94f69AcC0FbB57f264":"idle","0xE52dDB85587585930b1E5f1Fe88fef21CcA49829":"idle","0xa0435f618c1F27B254998018AEa8Da5C77187852":"agree","0xcEf1Baa172d0b4D99Dcc505B36332F26D1088025":"agree","0xf13c3DfE38C8E206C33F750C24a1b043b63Cb810":"agree"}
RULING:       {"agreement_hash": "0x9f2c00000000000000000000000000000000000000000000000000000000947f", "decision": "SPLIT", "evidence_hash": "0x51aa00000000000000000000000000000000000000000000000000000000b3c1", "inputs_hash": "0x000000000000000000000000000000000000000000000000000001a13ff76c1c", "material_breach": true, "reasoning_summary": "The minimum_sources term is a mandatory breach (3 of 5 required sources delivered, 60% fulfilled). No evidence of material misstatement was established, so material_accuracy passes. The brief retains partial value, warranting a 40% refund reflecting the sourcing shortfall.", "recommended_settlement": "SPLIT", "refund_bps": 4000, "remedy_mode": "GRADUATED", "satisfied_terms": ["material_accuracy"], "schema": "recourse.ruling/2", "submitter": "0x0d510309a3662bdf4eb6a69112ce0595d6567af6", "violated_terms": ["minimum_sources"]}
dispute id:   dsp_smoke_1792074542108
submitter:    0x0d510309a3662bDF4Eb6A69112cE0595d6567AF6

explorer: https://explorer-studio-dev.genlayer.com/address/0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
````

</details>

<details><summary>4 · appeal</summary>

````text
── attempt 1 ──
network:   GENLAYER STUDIO NEXT (chain 61997)
contract:  0x5e8C7F778a052BB6Ad42F0ab4F91c3B25dCFf581
dispute:   dsp_appeal_1792074589776
remedy:    ALL_OR_NOTHING
warning:   GENLAYER STUDIO NEXT can charge fees and no GENLAYER_PRIVATE_KEY is set, so writes will be attempted with an unfunded ephemeral account. Whether any fee is actually charged is read from the live quote, not assumed.
adjudicate tx: 0x23c687e431b05b040502e961e2cae76010ecd0a4902c6dc281c926e6fa01f8ac
submitter:     0x13F5BA633AD2Bd5a49973B5e74999ea74582DF91
deposit:       0.175 GEN

waiting for a provisional ruling…
  PENDING   PENDING · pending · failed appeals 0
  PENDING   PROPOSING · proposing · failed appeals 0
  PENDING   COMMITTING · committing · failed appeals 0
  PENDING   REVEALING · revealing · failed appeals 0
  FAILED    UNDETERMINED · failed appeals 0

The adjudication did not reach a ruling: The network failed to decide this transaction (UNDETERMINED). The escrow is still held.
````

</details>

<details><summary>5 · live tests</summary>

````text
TAP version 13
#   dsp_live_1792074606197: FINALIZED · tx 0x735dfab4a2a1eeee505b14800fed0a0ff281db1f318f877c9ab8aafc27aa9a32 · provisional ruling observed first: true
# Subtest: GenLayer rules on a genuine breach and resists an injected instruction
ok 1 - GenLayer rules on a genuine breach and resists an injected instruction
  ---
  duration_ms: 54066.661436
  ...
#   dsp_live_ok_1792074660263: FINALIZED · tx 0x1ce1bebe276b257ac22f02097c5301fe3c96a019f9b769389b19a1af9c333521 · provisional ruling observed first: true
# Subtest: GenLayer rules for the merchant when nothing was actually breached
ok 2 - GenLayer rules for the merchant when nothing was actually breached
  ---
  duration_ms: 54272.555652
  ...
#   dsp_live_split_1792074715061: FINALIZED · tx 0x599b03500d420af39edaf874eda637251ee2fcdcdbf57041e64288f6115a2d6c · provisional ruling observed first: true
#   ruling: SPLIT · refund 40% · Mandatory minimum_sources breached with 3 of 5 delivered; other requirements passed and delivery retains substantial value.
# Subtest: GenLayer awards a proportional remedy under a graduated agreement (v2 contract)
ok 3 - GenLayer awards a proportional remedy under a graduated agreement (v2 contract)
  ---
  duration_ms: 65477.601519
  ...
1..3
# tests 3
# suites 0
# pass 3
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 174536.347931
````

</details>
