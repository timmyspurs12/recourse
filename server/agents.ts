/**
 * Agent registration.
 *
 * Binds a handle to a signing key ahead of time, so the protocol never has to
 * take a key on trust the first time it sees one. Registered bindings survive
 * restarts and cannot be overwritten by a stranger's signature.
 *
 *   npx tsx server/agents.ts list
 *   npx tsx server/agents.ts register shopper.agent 0xAbC…
 *   npx tsx server/agents.ts generate shopper.agent      # new keypair, prints the key ONCE
 *
 * With RECOURSE_STRICT_REGISTRY=1 an unregistered handle is refused outright.
 */
import { join } from "node:path";
import { isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { JsonStore } from "../infra/store/json-store";

async function main() {
  const [command, handle, address] = process.argv.slice(2);
  const storeFile =
    process.env.RECOURSE_STORE_FILE ?? join(process.cwd(), ".recourse", "ledger.json");
  const store = new JsonStore(storeFile);

  switch (command) {
    case "list": {
      const bindings = await store.listAgentBindings();
      if (bindings.length === 0) {
        console.log("No agents registered.");
        console.log("Register one:  npx tsx server/agents.ts register <handle> <0xaddress>");
        return;
      }
      console.log(`${bindings.length} agent(s) in ${storeFile}\n`);
      for (const binding of bindings) {
        console.log(
          `  ${binding.handle.padEnd(24)} ${binding.address}  ${binding.source.padEnd(10)} ${binding.boundAt}`,
        );
      }
      return;
    }

    case "register": {
      if (!handle || !address) {
        console.error("usage: agents.ts register <handle> <0xaddress>");
        process.exit(1);
      }
      if (!isAddress(address)) {
        console.error(`"${address}" is not a valid address`);
        process.exit(1);
      }
      const existing = await store.getAgentBinding(handle);
      if (existing && existing.address.toLowerCase() !== address.toLowerCase()) {
        console.warn(
          `warning: ${handle} was bound to ${existing.address} (${existing.source}). Overwriting.`,
        );
      }
      await store.putAgentBinding({
        handle,
        address: address.toLowerCase(),
        source: "REGISTERED",
        boundAt: new Date().toISOString(),
      });
      console.log(`registered ${handle} -> ${address.toLowerCase()}`);
      return;
    }

    case "generate": {
      if (!handle) {
        console.error("usage: agents.ts generate <handle>");
        process.exit(1);
      }
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      await store.putAgentBinding({
        handle,
        address: account.address.toLowerCase(),
        source: "REGISTERED",
        boundAt: new Date().toISOString(),
      });
      console.log(`registered ${handle} -> ${account.address}\n`);
      console.log("Private key (shown once — store it in your agent's environment):");
      console.log(`  ${privateKey}\n`);
      console.log("Use it with the SDK:");
      console.log(`  const account = privateKeyToAccount("${privateKey}");`);
      console.log(
        `  new RecourseClient({ baseUrl, signer: { handle: "${handle}", sign: (m) => account.signMessage({ message: m }) } });`,
      );
      return;
    }

    default:
      console.log("commands: list | register <handle> <address> | generate <handle>");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
