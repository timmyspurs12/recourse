import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseTransaction, recoverTransactionAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_NETWORK,
  STUDIO_NEXT_CHAIN_ID,
  STUDIO_NEXT_RPC_URL,
  loadGenLayerConfig,
  resolveDeployedAddress,
  resolveNetworkKey,
} from "../integrations/genlayer/config";
import { extractFeeAccounting, formatGen, quoteToDomain, resolveFeeProfile } from "../integrations/genlayer/fees";
import { createSigningProvider } from "../integrations/genlayer/provider";
import { parseRuling } from "../integrations/genlayer/forum";

/**
 * STUDIO NEXT TESTS.
 *
 * The hackathon requires deployment on Studio Next (Consensus v0.6, chain
 * 61997). Several things here are easy to get subtly wrong and impossible to
 * notice on a laptop: which chain the code is actually pointed at, whether a
 * fee profile measured somewhere else is being applied, whether a deposit is
 * being reported as a cost. None of them need a network to check, so they are
 * checked here rather than discovered during judging.
 */

/* ------------------------------------------------------------- the network */

test("the default network is Studio Next, not a stable Studio", () => {
  const config = loadGenLayerConfig({});
  assert.equal(DEFAULT_NETWORK, "studio-next");
  assert.equal(config.networkKey, "studio-next");
  assert.equal(config.chainId, STUDIO_NEXT_CHAIN_ID);
  assert.equal(config.chainId, 61997);
  assert.equal(config.rpcUrl, STUDIO_NEXT_RPC_URL);
  assert.equal(config.isStudio, true);
});

test("Studio Next keeps the chain's consensus contracts, not just its RPC url", () => {
  /*
   * The failure mode this guards: pointing `studionet` (chain 61999) at the
   * Studio Next RPC. Chain identity and consensus contract addresses have to
   * move together, so the Studio Next preset must be built from the RC's
   * studioDevnet definition and only change the endpoint and the name.
   */
  const studioNext = loadGenLayerConfig({ GENLAYER_NETWORK: "studio-next" });
  const studioDev = loadGenLayerConfig({ GENLAYER_NETWORK: "studio-dev" });
  const stable = loadGenLayerConfig({ GENLAYER_NETWORK: "studionet" });

  assert.notEqual(studioNext.rpcUrl, stable.rpcUrl);
  assert.notEqual(studioNext.chainId, stable.chainId);
  assert.equal(studioNext.chainId, studioDev.chainId, "same chain, different hostname");
  assert.equal(
    (studioNext.chain.consensusMainContract as { address?: string } | null)?.address,
    (studioDev.chain.consensusMainContract as { address?: string } | null)?.address,
  );
  /*
   * Studio chains carry the consensus contracts but no separate fee manager:
   * the node prices the deposit and the SDK asks it. Asserting the shape keeps
   * a future preset change from silently repointing queue or policy reads.
   */
  assert.ok(studioNext.chain.consensusMainContract, "queue and policy reads have a contract");
  assert.equal(
    studioNext.chain.feeManagerContract ?? null,
    null,
    "Studio prices fees node-side; a fee manager appearing here is a change worth noticing",
  );
});

test("an unknown network falls back loudly rather than quietly", () => {
  const { key, warning } = resolveNetworkKey("studio-prod-42");
  assert.equal(key, "studio-next");
  assert.match(warning ?? "", /not a known network/);

  const config = loadGenLayerConfig({ GENLAYER_NETWORK: "studio-prod-42" });
  assert.equal(config.networkKey, "studio-next");
  assert.ok(config.warnings.some((w) => w.includes("studio-prod-42")));
});

test("a fee-bearing network with no key says so before a judge finds out", () => {
  const config = loadGenLayerConfig({ GENLAYER_NETWORK: "studio-next" });
  assert.equal(config.feeBearing, true);
  assert.ok(config.warnings.some((w) => w.includes("GENLAYER_PRIVATE_KEY")));

  const funded = loadGenLayerConfig({
    GENLAYER_NETWORK: "studio-next",
    GENLAYER_PRIVATE_KEY: "0x" + "11".repeat(32),
  });
  assert.equal(funded.privateKey !== null, true);
  assert.equal(
    funded.warnings.some((w) => w.includes("GENLAYER_PRIVATE_KEY")),
    false,
  );
});

test("an RPC override is reported, because a deployment should not be quiet about where it points", () => {
  const config = loadGenLayerConfig({
    GENLAYER_NETWORK: "studio-next",
    GENLAYER_RPC_URL: "http://127.0.0.1:4000/api",
  });
  assert.equal(config.rpcUrl, "http://127.0.0.1:4000/api");
  assert.ok(config.warnings.some((w) => w.includes("GENLAYER_RPC_URL")));
});

/* -------------------------------------------------------- deployment files */

test("deployments resolve per network, and this machine's deployment wins", () => {
  const committed = {
    default: "studio-next",
    deployments: {
      "studio-next": { address: "0xAAA" },
      "testnet-bradbury": { address: "0xBBB" },
    },
  };
  assert.deepEqual(resolveDeployedAddress("studio-next", { local: null, committed }), {
    address: "0xAAA",
    source: "committed",
  });
  assert.deepEqual(resolveDeployedAddress("testnet-bradbury", { local: null, committed }), {
    address: "0xBBB",
    source: "committed",
  });
  assert.deepEqual(
    resolveDeployedAddress("studio-next", { local: { network: "studio-next", address: "0xLOCAL" }, committed }),
    { address: "0xLOCAL", source: "local" },
  );
  assert.deepEqual(resolveDeployedAddress("localnet", { local: null, committed }), {
    address: null,
    source: null,
  });
});

test("a pinned address is honoured, and a missing one is reported as missing", () => {
  const pinned = loadGenLayerConfig({
    GENLAYER_NETWORK: "studio-next",
    GENLAYER_CONTRACT_ADDRESS: "0x00000000000000000000000000000000000000ff",
  });
  assert.equal(pinned.contractAddress, "0x00000000000000000000000000000000000000ff");

  // No address anywhere means no forum, which the runtime reports as an
  // unavailable forum rather than a working one pointed at nothing.
  assert.deepEqual(
    resolveDeployedAddress("studio-next", { local: null, committed: { deployments: {} } }),
    { address: null, source: null },
  );
});

/* -------------------------------------------------------------- fee profile */

test("a fee profile measured on another chain is ignored, and says why", () => {
  const dir = mkdtempSync(join(tmpdir(), "recourse-fees-"));
  const file = join(dir, "fee-profile.json");
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      chainId: "1",
      network: "localnet",
      measuredAt: "2026-06-15T17:26:36Z",
      methods: { adjudicate: { leaderTimeunitsAllocation: "125" } },
    }),
  );

  const resolution = resolveFeeProfile(file, 61997);
  assert.equal(resolution.suggestions, null);
  assert.match(resolution.note ?? "", /measured on chain 1/);
  assert.match(resolution.note ?? "", /do not cross networks/i);
});

test("a fee profile with no chainId cannot be shown to belong here, so it is not used", () => {
  const dir = mkdtempSync(join(tmpdir(), "recourse-fees-"));
  const file = join(dir, "fee-profile.json");
  writeFileSync(
    file,
    JSON.stringify({ version: 1, network: "localnet", methods: { adjudicate: {} } }),
  );

  const resolution = resolveFeeProfile(file, 61997);
  assert.equal(resolution.suggestions, null);
  assert.match(resolution.note ?? "", /does not declare a chainId/);
});

test("a profile measured on this chain is applied, and a missing one is not an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "recourse-fees-"));
  const file = join(dir, "fee-profile.json");
  const profile = {
    version: 1,
    chainId: 61997,
    measuredAt: "2026-09-15T00:00:00Z",
    methods: { adjudicate: { leaderTimeunitsAllocation: "125", rotationsPerRound: "1" } },
  };
  writeFileSync(file, JSON.stringify(profile));

  const applied = resolveFeeProfile(file, 61997);
  assert.equal(applied.note, null);
  assert.deepEqual(applied.suggestions, profile as never);

  const missing = resolveFeeProfile(join(dir, "nope.json"), 61997);
  assert.equal(missing.suggestions, null);
  assert.match(missing.note ?? "", /network-default/);
});

/* ------------------------------------------------------------------ quoting */

test("a quote is recorded as a deposit, with the policy that produced it", () => {
  const quote = quoteToDomain(
    {
      distribution: {},
      feeValue: 1234000000000000n,
      userValue: 0n,
      total: 1234000000000000n,
      source: "network-default",
      gasless: false,
      verification: { status: "verified", expectedHash: "0xaa", actualHash: "0xaa" },
      breakdown: { timeUnitFees: 1200000000000000n, executionBudget: 34000000000000n, messageFees: 0n },
      caps: { genPerTimeUnit: 7n, storagePrice: 5n, receiptPrice: 3n },
      queue: { pendingAhead: 2 },
      refundable: true,
    } as never,
    { suggestions: null, file: "fee-profile.json", note: "no profile", measuredAt: null },
    "2026-09-15T00:00:00.000Z",
  );

  assert.equal(quote.depositWei, "1234000000000000");
  assert.equal(quote.userValueWei, "0");
  assert.equal(quote.source, "network-default");
  assert.equal(quote.profileFile, null, "no profile was used, so none is claimed");
  assert.equal(quote.profileNote, "no profile");
  assert.equal(quote.verification.status, "verified");
  assert.equal(quote.queuePosition, 2);
  assert.equal(formatGen(quote.depositWei), "0.001234 GEN");
});

test("fee accounting is reported only when a receipt carries it", () => {
  assert.equal(extractFeeAccounting({ statusName: "FINALIZED" }), null);
  assert.equal(extractFeeAccounting(null), null);

  const accounting = extractFeeAccounting({
    data: {
      fee_accounting: {
        paid_fee_value: "1000000000000000",
        execution_fee_consumed: "250000000000000",
        total_refunded: "750000000000000",
      },
    },
  });
  assert.ok(accounting);
  assert.equal(accounting?.depositWei, "1000000000000000");
  assert.equal(accounting?.consumedWei, "250000000000000");
  assert.equal(accounting?.refundedWei, "750000000000000");
  assert.equal(accounting?.source, "receipt.data.fee_accounting");
});

test("formatting never invents precision", () => {
  assert.equal(formatGen(0n), "0 GEN");
  // A dust deposit is not zero, and must not be shown as zero.
  assert.equal(formatGen(1n), "<0.000001 GEN");
  assert.equal(formatGen("1234"), "<0.000001 GEN");
  assert.equal(formatGen(10n ** 18n), "1 GEN");
  assert.equal(formatGen(1500000000000000000n), "1.5 GEN");
  assert.equal(formatGen(null), null);
  assert.equal(formatGen("not-a-number"), null);
});

/* ------------------------------------------------------- the signing provider */

test("the server provider signs with the deployment key and forwards the rest", async () => {
  const privateKey = `0x${"33".repeat(32)}` as const;
  const account = privateKeyToAccount(privateKey);
  const { provider, address } = createSigningProvider({
    privateKey,
    chain: loadGenLayerConfig({ GENLAYER_NETWORK: "studio-next" }).chain,
    rpcUrl: "http://127.0.0.1:9/unreachable",
  });
  assert.equal(address, account.address);

  // Identity and chain id are answered locally: no node is asked who we are.
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), [account.address]);
  assert.equal(await provider.request({ method: "eth_chainId" }), `0x${(61997).toString(16)}`);

  /*
   * Signing is local. Every field is supplied so viem never reaches for the
   * network, which is also what makes this test meaningful offline.
   */
  const raw = (await provider.request({
    method: "eth_signTransaction",
    params: [
      {
        from: account.address,
        to: "0x00000000000000000000000000000000000000aa",
        data: "0xdeadbeef",
        value: "0x0",
        gas: "0x5208",
        nonce: "0x1",
        maxFeePerGas: "0x3b9aca00",
        maxPriorityFeePerGas: "0x3b9aca00",
      },
    ],
  })) as `0x${string}`;

  const parsed = parseTransaction(raw);
  assert.equal(parsed.to?.toLowerCase(), "0x00000000000000000000000000000000000000aa");
  assert.equal(parsed.data, "0xdeadbeef");
  assert.equal(
    await recoverTransactionAddress({ serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] }),
    account.address,
  );

  // Unknown methods belong to the node, and a dead node fails loudly.
  await assert.rejects(
    () => provider.request({ method: "eth_call", params: [{ to: "0x0", data: "0x" }, "latest"] }),
  );
});

test("a ruling that is internally coherent but wrong is still rejected", () => {
  // Sanity check that the security boundary this suite exercises is live here
  // too, since the forum now reports more about a transaction than a ruling.
  assert.equal(
    parseRuling(
      JSON.stringify({
        decision: "BUYER_WINS",
        material_breach: true,
        violated_terms: ["minimum_sources"],
        satisfied_terms: [],
        recommended_settlement: "RELEASE",
        reasoning_summary: "Buyer wins and the merchant is paid.",
      }),
    ),
    null,
  );
});
