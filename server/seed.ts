/**
 * Seeds the protocol ledger by RUNNING real transactions through the domain.
 *
 * Nothing here writes a state directly: every record below is produced by the
 * same state machine, hashing and verification the live app uses, so the
 * ledger, cases and dossier pages show genuine protocol output rather than
 * hand-authored JSON. Records are marked DEMO_FIXTURE so the UI can say so.
 *
 *   npx tsx server/seed.ts            # includes one real GenLayer adjudication
 *   npx tsx server/seed.ts --fast     # skip the network round trip
 */
import { join } from "node:path";
import { RecourseProtocol } from "../domain/orders/service";
import { JsonStore } from "../infra/store/json-store";
import { SimulatedRail } from "../integrations/simulated/rail";
import { GenLayerForum, UnavailableForum } from "../integrations/genlayer/forum";
import { loadGenLayerConfig } from "../integrations/genlayer/config";
import { AGENTS, BRIEF, BRIEF_TERMS, BUYER_CLAIM, GOOD_DELIVERY, SHORT_DELIVERY } from "./scenario";
import type { AgreementTerm } from "../domain/model";

async function main() {
  const fast = process.argv.includes("--fast");
  const storeFile = process.env.RECOURSE_STORE_FILE ?? join(process.cwd(), ".recourse", "ledger.json");

  const store = new JsonStore(storeFile);
  const config = loadGenLayerConfig();
  const forum = config.contractAddress ? new GenLayerForum(config) : new UnavailableForum();
  const protocol = new RecourseProtocol({ store, rail: new SimulatedRail(), forum });

  /*
   * Start the sequence so the flagship dispute lands on the memorable RC-000042.
   *
   * Agent key bindings are deliberately carried across: reseeding the ledger is
   * a demo-data operation, and it must not silently revoke every agent's
   * identity along with it.
   */
  const agents = await store.listAgentBindings();
  await store.reset({
    sequence: 37,
    agents: Object.fromEntries(agents.map((binding) => [binding.handle, binding])),
  });
  if (agents.length > 0) {
    console.log(`preserved ${agents.length} agent binding(s)`);
  }

  type Agent = { handle: string; operator?: string; address?: string };

  function terms(overrides: Partial<Record<string, number | string>> = {}): AgreementTerm[] {
    return BRIEF_TERMS.map((term) =>
      overrides[term.id] === undefined ? term : { ...term, expected: overrides[term.id]! },
    );
  }

  async function purchase(input: {
    buyer: Agent;
    merchant: Agent;
    resource: { name: string; type: string };
    amount: string;
    terms?: AgreementTerm[];
  }) {
    const dossier = await protocol.createProtectedPurchase({
      buyer: { handle: input.buyer.handle, operator: input.buyer.operator },
      merchant: {
        handle: input.merchant.handle,
        operator: input.merchant.operator,
        address: input.merchant.address,
      },
      resource: input.resource,
      amount: input.amount,
      terms: input.terms ?? BRIEF_TERMS,
      origin: "DEMO_FIXTURE",
    });
    return dossier.order.id;
  }

  const log = (id: string, note: string) => console.log(`  ${id.padEnd(10)} ${note}`);

  console.log(`seeding ${storeFile}`);

  /* RC-000038 — a completed, released purchase from earlier in the week. */
  {
    const id = await purchase({
      buyer: AGENTS.procure,
      merchant: AGENTS.datasmith,
      resource: { name: "Abuja Retail Footfall Sample", type: "digital_report" },
      amount: "2.25",
      terms: terms({ minimum_sources: 3, required_sections: 3, geography: "Abuja, Nigeria" }),
    });
    await protocol.submitDelivery({
      orderId: id,
      statement: "Footfall sample delivered with three corroborating sources.",
      artifactHash: `0x${"c1".repeat(32)}`,
      assertions: {
        sourceCount: 4,
        geography: "Abuja, Nigeria",
        sectionCount: 3,
        maxSourceAgeDays: 8,
        format: "JSON",
        summary: "Footfall counts across three Abuja retail corridors.",
      },
      evidence: [
        { kind: "sensor", source: "Corridor sensor array, Wuse II", sourceAgeDays: 8 },
        { kind: "survey", source: "Retail operator survey", sourceAgeDays: 5 },
        { kind: "registry", source: "Mall tenancy registry", sourceAgeDays: 6 },
      ],
    });
    await protocol.settle(id);
    log(id, "RELEASED — promise satisfied, escrow paid to merchant");
  }

  /* RC-000039 — escrowed, merchant has not delivered yet. */
  {
    const id = await purchase({
      buyer: AGENTS.procure,
      merchant: AGENTS.ledgerworks,
      resource: { name: "Nairobi Logistics Rate Card", type: "digital_report" },
      amount: "2.50",
      terms: terms({ geography: "Nairobi, Kenya", max_source_age_days: 21, required_sections: 3 }),
    });
    log(id, "ESCROWED — awaiting delivery");
  }

  /* RC-000040 — delivered and fulfilled, escrow not yet released. */
  {
    const id = await purchase({
      buyer: AGENTS.atlas,
      merchant: AGENTS.datasmith,
      resource: { name: "Kano Agricultural Input Prices", type: "digital_report" },
      amount: "1.75",
      terms: terms({ minimum_sources: 4, geography: "Kano, Nigeria" }),
    });
    await protocol.submitDelivery({
      orderId: id,
      statement: "Input price series delivered across four markets.",
      artifactHash: `0x${"d2".repeat(32)}`,
      assertions: {
        sourceCount: 5,
        geography: "Kano, Nigeria",
        sectionCount: 4,
        maxSourceAgeDays: 14,
        format: "JSON",
        summary: "Fertiliser, seed and feed prices across four Kano markets.",
      },
      evidence: [
        { kind: "pricing", source: "Dawanau market price board", sourceAgeDays: 3 },
        { kind: "pricing", source: "Yankaba market price board", sourceAgeDays: 4 },
        { kind: "survey", source: "Cooperative buyer survey", sourceAgeDays: 14 },
        { kind: "registry", source: "State agricultural bulletin", sourceAgeDays: 10 },
        { kind: "interview", source: "Input distributor interviews", sourceAgeDays: 6 },
      ],
    });
    log(id, "FULFILLED — verified, escrow awaiting release");
  }

  /* RC-000041 — the neutrality proof: the merchant delivered, the merchant is paid. */
  {
    const id = await purchase({
      buyer: AGENTS.shopper,
      merchant: AGENTS.merchant,
      resource: { name: BRIEF.name, type: BRIEF.type },
      amount: BRIEF.price,
    });
    await protocol.submitDelivery({ orderId: id, ...GOOD_DELIVERY, evidence: [...GOOD_DELIVERY.evidence] });
    await protocol.settle(id);
    log(id, "RELEASED — six sources, every mandatory term passed");
  }

  /* RC-000042 — the flagship: two of five sources, disputed and adjudicated. */
  {
    const id = await purchase({
      buyer: AGENTS.shopper,
      merchant: AGENTS.merchant,
      resource: { name: BRIEF.name, type: BRIEF.type },
      amount: BRIEF.price,
    });
    await protocol.submitDelivery({
      orderId: id,
      ...SHORT_DELIVERY,
      evidence: [...SHORT_DELIVERY.evidence],
    });
    const disputed = await protocol.openDispute({ orderId: id, claim: BUYER_CLAIM });
    const disputeId = disputed.dispute!.id;
    log(id, "DISPUTED — minimum_sources 2 < 5 detected deterministically");

    if (fast || !forum.available) {
      log(id, fast ? "skipping adjudication (--fast)" : "adjudication forum unavailable");
    } else {
      await protocol.submitAdjudication(disputeId);
      log(id, "adjudication submitted to GenLayer, waiting for consensus...");
      const deadline = Date.now() + 240_000;
      let settled = false;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        const dossier = await protocol.pollAdjudication(disputeId);
        const status = dossier.adjudication?.status;
        if (status === "FINALIZED") {
          log(id, `ruling: ${dossier.adjudication?.ruling?.decision}`);
          await protocol.settle(id);
          const final = await protocol.dossier(id);
          log(id, `${final.settlement?.outcome} — ${final.order.state}`);
          settled = true;
          break;
        }
        if (status === "FAILED") {
          log(id, `adjudication failed: ${dossier.adjudication?.failureReason}`);
          settled = true;
          break;
        }
      }
      if (!settled) log(id, "adjudication still pending — left in ADJUDICATING (honest state)");
    }
  }

  /* RC-000043 — a second escrowed purchase in flight. */
  {
    const id = await purchase({
      buyer: AGENTS.atlas,
      merchant: AGENTS.merchant,
      resource: { name: "Port Harcourt Fuel Retail Snapshot", type: "digital_report" },
      amount: "3.00",
      terms: terms({ geography: "Port Harcourt, Nigeria", minimum_sources: 6 }),
    });
    log(id, "ESCROWED — awaiting delivery");
  }

  /* RC-000044 — disputed and submitted, deliberately left mid-adjudication. */
  {
    const id = await purchase({
      buyer: AGENTS.atlas,
      merchant: AGENTS.ledgerworks,
      resource: { name: "Abuja Telecom Coverage Audit", type: "digital_report" },
      amount: "2.00",
      terms: terms({ geography: "Abuja, Nigeria", minimum_sources: 5 }),
    });
    await protocol.submitDelivery({
      orderId: id,
      statement: "Coverage audit delivered for three of the five contracted corridors.",
      artifactHash: `0x${"e3".repeat(32)}`,
      assertions: {
        sourceCount: 3,
        geography: "Abuja, Nigeria",
        sectionCount: 4,
        maxSourceAgeDays: 16,
        format: "JSON",
        summary: "Signal strength and dropout rates for three Abuja corridors.",
      },
      evidence: [
        { kind: "sensor", source: "Drive-test corridor A", sourceAgeDays: 16 },
        { kind: "sensor", source: "Drive-test corridor B", sourceAgeDays: 15 },
        { kind: "registry", source: "Regulator coverage filing", sourceAgeDays: 9 },
      ],
    });
    await protocol.openDispute({
      orderId: id,
      claim: "Five corridors were contracted and three were audited. The audit is not usable for the rollout decision it was bought for.",
    });
    log(id, "DISPUTED — awaiting adjudication");
  }

  const orders = await protocol.listOrders();
  console.log(`\nseeded ${orders.length} protected transactions into ${storeFile}`);
  for (const order of orders) {
    console.log(`  ${order.id}  ${order.state.padEnd(20)} ${order.resource.name}`);
  }

}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
