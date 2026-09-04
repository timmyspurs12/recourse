#!/usr/bin/env node
/**
 * Generates a deployment wallet.
 *
 *   npm run wallet
 *
 * Exists so nobody has to paste a long `node -e "..."` one-liner, which quotes
 * badly across PowerShell, cmd and Git Bash and fails confusingly when
 * dependencies are not installed yet.
 *
 * The key is printed once and never written to disk. Put it in your deployment
 * environment; do not commit it.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("");
console.log("  ADDRESS      " + account.address);
console.log("  PRIVATE KEY  " + privateKey);
console.log("");
console.log("  1. Fund the address:  https://testnet-faucet.genlayer.foundation/");
console.log("     A deployment costs roughly 0.0018 GEN.");
console.log("");
console.log("  2. Deploy the adjudicator:");
console.log("");
console.log("     GENLAYER_NETWORK=testnet-bradbury \\");
console.log(`     GENLAYER_PRIVATE_KEY=${privateKey} \\`);
console.log("     npm run genlayer:deploy");
console.log("");
console.log("  Keep the private key. It is not stored anywhere and cannot be recovered.");
console.log("");
