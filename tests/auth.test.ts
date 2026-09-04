import { strict as assert } from "node:assert";
import test from "node:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  MemoryAgentDirectory,
  authenticate,
  canonicalRequest,
  resetReplayGuard,
  AUTH_HEADERS,
  MAX_CLOCK_SKEW_MS,
} from "../server/auth";
import { buyBrief, harness, shortDelivery, goodDelivery } from "./harness";

/**
 * Authentication and authorization.
 *
 * The question these answer is the one a hostile reviewer asks first:
 * "what stops me calling your API as somebody else and taking their money?"
 */

async function signedHeaders(input: {
  handle: string;
  key?: `0x${string}`;
  method: string;
  path: string;
  body: string;
  timestamp?: string;
}): Promise<Headers> {
  const account = privateKeyToAccount(input.key ?? generatePrivateKey());
  const timestamp = input.timestamp ?? String(Date.now());
  const message = canonicalRequest({
    method: input.method,
    path: input.path,
    timestamp,
    body: input.body,
  });
  const signature = await account.signMessage({ message });

  const headers = new Headers();
  headers.set(AUTH_HEADERS.agent, input.handle);
  headers.set(AUTH_HEADERS.timestamp, timestamp);
  headers.set(AUTH_HEADERS.signature, signature);
  return headers;
}

test("a valid signature authenticates the agent and binds its key", async () => {
  resetReplayGuard();
  const directory = new MemoryAgentDirectory();
  const key = generatePrivateKey();
  const body = JSON.stringify({ claim: "two of five sources" });
  const path = "/api/orders/RC-000042/disputes";

  const actor = await authenticate({
    method: "POST",
    path,
    body,
    headers: await signedHeaders({ handle: "shopper.agent", key, method: "POST", path, body }),
    directory,
  });

  assert.equal(actor?.handle, "shopper.agent");
  assert.equal(actor?.authenticated, true);
  assert.equal(
    (await directory.lookup("shopper.agent"))?.toLowerCase(),
    privateKeyToAccount(key).address.toLowerCase(),
  );
});

test("a different key cannot take over an already-bound handle", async () => {
  resetReplayGuard();
  const directory = new MemoryAgentDirectory();
  const path = "/api/orders/RC-000042/disputes";
  const body = "{}";

  // The real agent shows up first and binds the handle.
  await authenticate({
    method: "POST",
    path,
    body,
    headers: await signedHeaders({ handle: "shopper.agent", method: "POST", path, body }),
    directory,
  });

  // An impostor signs a perfectly valid signature — with the wrong key.
  const impostorHeaders = await signedHeaders({
    handle: "shopper.agent",
    method: "POST",
    path,
    body,
  });
  await assert.rejects(
    () => authenticate({ method: "POST", path, body, headers: impostorHeaders, directory }),
    (error: { code?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      return true;
    },
  );
});

test("a signature is bound to the exact request it signed", async () => {
  resetReplayGuard();
  const directory = new MemoryAgentDirectory();
  const key = generatePrivateKey();
  const path = "/api/orders/RC-000042/settlement";

  // Establish the binding with an honest request first.
  await authenticate({
    method: "POST",
    path,
    body: "{}",
    headers: await signedHeaders({ handle: "shopper.agent", key, method: "POST", path, body: "{}" }),
    directory,
  });

  // Now replay a valid signature over a DIFFERENT body: the digest no longer
  // matches, so the recovered address is not the bound key.
  const headers = await signedHeaders({
    handle: "shopper.agent",
    key,
    method: "POST",
    path,
    body: JSON.stringify({ amount: "1.00" }),
  });

  await assert.rejects(
    () =>
      authenticate({
        method: "POST",
        path,
        body: JSON.stringify({ amount: "999.00" }),
        headers,
        directory,
      }),
    (error: { code?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      return true;
    },
  );
});

test("trust-on-first-use cannot detect tampering on the very first request", async () => {
  /*
   * An honest limitation, asserted so it cannot be forgotten.
   *
   * Until a handle is bound, there is no key to compare against, so a tampered
   * first request binds whatever address the mangled signature recovers to.
   * The attacker does not control that address and every subsequent request
   * from the real agent is then rejected — the damage is a denial of service on
   * the handle, not impersonation of an established one. Pre-registering agents
   * in the directory removes this window entirely.
   */
  resetReplayGuard();
  const directory = new MemoryAgentDirectory();
  const path = "/api/orders/RC-000042/settlement";
  const headers = await signedHeaders({
    handle: "fresh.agent",
    method: "POST",
    path,
    body: JSON.stringify({ amount: "1.00" }),
  });

  const actor = await authenticate({
    method: "POST",
    path,
    body: JSON.stringify({ amount: "999.00" }),
    headers,
    directory,
  });

  assert.equal(actor?.handle, "fresh.agent");
  const bound = await directory.lookup("fresh.agent");
  assert.notEqual(bound, null, "the handle is now bound to the tampered signer");
});

test("a captured signature cannot be replayed", async () => {
  resetReplayGuard();
  const directory = new MemoryAgentDirectory();
  const path = "/api/orders/RC-000042/settlement";
  const body = "";
  const headers = await signedHeaders({ handle: "shopper.agent", method: "POST", path, body });

  const first = await authenticate({ method: "POST", path, body, headers, directory });
  assert.equal(first?.authenticated, true);

  await assert.rejects(
    () => authenticate({ method: "POST", path, body, headers, directory }),
    (error: { code?: string; message?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      assert.match(error.message!, /already been used/);
      return true;
    },
  );
});

test("stale requests are refused", async () => {
  resetReplayGuard();
  const directory = new MemoryAgentDirectory();
  const path = "/api/orders/RC-000042/settlement";
  const body = "";
  const headers = await signedHeaders({
    handle: "shopper.agent",
    method: "POST",
    path,
    body,
    timestamp: String(Date.now() - MAX_CLOCK_SKEW_MS - 60_000),
  });

  await assert.rejects(
    () => authenticate({ method: "POST", path, body, headers, directory }),
    (error: { message?: string }) => {
      assert.match(error.message!, /outside the accepted window/);
      return true;
    },
  );
});

test("an unsigned request is refused when authentication is required", async () => {
  resetReplayGuard();
  const previous = process.env.RECOURSE_REQUIRE_AUTH;
  delete process.env.RECOURSE_REQUIRE_AUTH; // required by default

  await assert.rejects(
    () =>
      authenticate({
        method: "POST",
        path: "/api/orders/RC-000042/settlement",
        body: "",
        headers: new Headers(),
        directory: new MemoryAgentDirectory(),
      }),
    (error: { code?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      return true;
    },
  );

  if (previous === undefined) delete process.env.RECOURSE_REQUIRE_AUTH;
  else process.env.RECOURSE_REQUIRE_AUTH = previous;
});

/* ------------------------------------------------- authorization, in domain */

test("a stranger cannot deliver against someone else's order", async () => {
  const { protocol } = harness();
  const orderId = await buyBrief(protocol);

  await assert.rejects(
    () =>
      protocol.submitDelivery({
        ...goodDelivery(orderId),
        actor: { handle: "impostor.agent", authenticated: true },
      }),
    (error: { code?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      return true;
    },
  );
});

test("the buyer cannot deliver on the merchant's behalf", async () => {
  const { protocol } = harness();
  const orderId = await buyBrief(protocol);

  await assert.rejects(
    () =>
      protocol.submitDelivery({
        ...goodDelivery(orderId),
        actor: { handle: "shopper.agent", authenticated: true },
      }),
    (error: { code?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      return true;
    },
  );
});

test("a stranger cannot open a dispute, and the claimant comes from identity", async () => {
  const { protocol } = harness();
  const orderId = await buyBrief(protocol);
  await protocol.submitDelivery({
    ...shortDelivery(orderId),
    actor: { handle: "merchant.agent", authenticated: true },
  });

  await assert.rejects(
    () =>
      protocol.openDispute({
        orderId,
        claim: "I would like somebody else's refund please.",
        actor: { handle: "opportunist.agent", authenticated: true },
      }),
    (error: { code?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      return true;
    },
  );

  // The merchant may dispute, but is recorded as the merchant — it cannot
  // file a claim in the buyer's name.
  const disputed = await protocol.openDispute({
    orderId,
    claim: "The buyer is withholding acceptance without cause.",
    openedBy: "BUYER",
    actor: { handle: "merchant.agent", authenticated: true },
  });
  assert.equal(disputed.dispute?.openedBy, "MERCHANT");
});

test("a stranger cannot trigger someone else's settlement", async () => {
  const { protocol } = harness();
  const orderId = await buyBrief(protocol);
  await protocol.submitDelivery({
    ...goodDelivery(orderId),
    actor: { handle: "merchant.agent", authenticated: true },
  });

  await assert.rejects(
    () => protocol.settle(orderId, { handle: "stranger.agent", authenticated: true }),
    (error: { code?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      return true;
    },
  );

  // Either genuine party may settle; the outcome is fixed by state regardless.
  const settled = await protocol.settle(orderId, {
    handle: "shopper.agent",
    authenticated: true,
  });
  assert.equal(settled.settlement?.outcome, "RELEASED");
  assert.equal(settled.settlement?.to, "merchant.agent");
});

/* ------------------------------------------------ durable agent registry */

test("bindings survive a restart", async () => {
  resetReplayGuard();
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { JsonStore } = await import("../infra/store/json-store");
  const { StoreAgentDirectory } = await import("../server/auth");

  const file = join(mkdtempSync(join(tmpdir(), "recourse-agents-")), "ledger.json");
  const key = generatePrivateKey();
  const path = "/api/orders/RC-000042/settlement";

  // First process: TOFU binds the handle.
  const firstDirectory = new StoreAgentDirectory(new JsonStore(file));
  await authenticate({
    method: "POST",
    path,
    body: "{}",
    headers: await signedHeaders({ handle: "durable.agent", key, method: "POST", path, body: "{}" }),
    directory: firstDirectory,
  });

  // Second process, same ledger: an impostor must still be refused.
  const secondDirectory = new StoreAgentDirectory(new JsonStore(file));
  const impostor = await signedHeaders({
    handle: "durable.agent",
    method: "POST",
    path,
    body: "{}",
  });
  await assert.rejects(
    () =>
      authenticate({
        method: "POST",
        path,
        body: "{}",
        headers: impostor,
        directory: secondDirectory,
      }),
    (error: { code?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      return true;
    },
  );

  // ...and the real key still works.
  const actor = await authenticate({
    method: "POST",
    path,
    body: "{}",
    headers: await signedHeaders({ handle: "durable.agent", key, method: "POST", path, body: "{}" }),
    directory: secondDirectory,
  });
  assert.equal(actor?.handle, "durable.agent");
});

test("strict registry refuses handles nobody registered", async () => {
  resetReplayGuard();
  const previous = process.env.RECOURSE_STRICT_REGISTRY;
  process.env.RECOURSE_STRICT_REGISTRY = "1";

  const directory = new MemoryAgentDirectory();
  const path = "/api/orders/RC-000042/settlement";

  // Unknown handle: no TOFU, no entry, no access.
  const strangerHeaders = await signedHeaders({
    handle: "stranger.agent",
    method: "POST",
    path,
    body: "{}",
  });
  await assert.rejects(
    () =>
      authenticate({ method: "POST", path, body: "{}", headers: strangerHeaders, directory }),
    (error: { code?: string; message?: string }) => {
      assert.equal(error.code, "UNAUTHORIZED");
      assert.match(error.message!, /not a registered agent/);
      return true;
    },
  );
  assert.equal(await directory.lookup("stranger.agent"), null, "nothing may be bound on sight");

  // A pre-registered agent is admitted, closing the first-request window.
  const key = generatePrivateKey();
  await directory.bind("known.agent", privateKeyToAccount(key).address, "REGISTERED");
  const actor = await authenticate({
    method: "POST",
    path,
    body: "{}",
    headers: await signedHeaders({ handle: "known.agent", key, method: "POST", path, body: "{}" }),
    directory,
  });
  assert.equal(actor?.handle, "known.agent");

  if (previous === undefined) delete process.env.RECOURSE_STRICT_REGISTRY;
  else process.env.RECOURSE_STRICT_REGISTRY = previous;
});
