#!/usr/bin/env node
/**
 * Boot preparation.
 *
 * A fresh deployment starts with no ledger, which would present judges with an
 * empty protocol. Rather than running a live adjudication during boot (slow,
 * and it would fail a health check), we ship a ledger produced by a real seed
 * run — real hashes, a real GenLayer transaction, a real ruling — and copy it
 * into place on first boot only. Existing data is never overwritten.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const target = process.env.RECOURSE_STORE_FILE ?? join(process.cwd(), ".recourse", "ledger.json");
const source = join(process.cwd(), "data", "seed-ledger.json");

if (existsSync(target)) {
  console.log(`[recourse] ledger present at ${target}`);
} else if (existsSync(source)) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`[recourse] seeded ledger from ${source}`);
} else {
  console.log("[recourse] no ledger and no seed data; starting empty");
}
