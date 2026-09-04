#!/usr/bin/env node
/**
 * Boot preparation.
 *
 * A fresh deployment starts with no ledger, which would present judges with an
 * empty protocol. Rather than running a live adjudication during boot (slow,
 * and it would fail a health check), we ship a ledger produced by a real seed
 * run — real hashes, a real GenLayer transaction, a real ruling — and copy it
 * into place on first boot only. Existing data is never overwritten.
 *
 * This step must NEVER prevent the server from starting. A crash here means the
 * health check gets no response at all, the platform restarts the container,
 * and the operator sees a loop instead of a diagnosis. So every failure is
 * caught, explained in terms of the actual fix, and the server starts anyway.
 */
import { accessSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const target = process.env.RECOURSE_STORE_FILE ?? join(process.cwd(), ".recourse", "ledger.json");
const source = join(process.cwd(), "data", "seed-ledger.json");
const dir = dirname(target);

function explainPermissionFailure(error) {
  console.error(`[recourse] cannot write to ${dir}: ${error.code ?? error.message}`);
  console.error("[recourse]");
  console.error("[recourse] The data directory is not writable by this process.");
  console.error(`[recourse]   running as uid ${process.getuid?.() ?? "unknown"}`);
  console.error("[recourse]");
  console.error("[recourse] Most often this is a mounted volume owned by root while the app");
  console.error("[recourse] runs unprivileged. The image ships an entrypoint that takes");
  console.error("[recourse] ownership of the mount and then drops privileges — make sure the");
  console.error("[recourse] container is started through it rather than overriding the");
  console.error("[recourse] entrypoint or setting USER.");
  console.error("[recourse]");
  console.error("[recourse] The server will start, but writes will fail until this is fixed.");
}

try {
  mkdirSync(dir, { recursive: true });

  // Probe for real write access rather than assuming: mkdir succeeds on a
  // directory that already exists but is owned by somebody else.
  const probe = join(dir, `.write-probe-${process.pid}`);
  try {
    closeSync(openSync(probe, "w"));
    unlinkSync(probe);
  } catch (error) {
    explainPermissionFailure(error);
    process.exit(0); // start the server anyway
  }

  if (existsSync(target)) {
    console.log(`[recourse] ledger present at ${target}`);
  } else if (existsSync(source)) {
    copyFileSync(source, target);
    console.log(`[recourse] seeded ledger from ${source}`);
  } else {
    console.log("[recourse] no ledger and no seed data; starting empty");
  }
} catch (error) {
  if (error && (error.code === "EACCES" || error.code === "EPERM" || error.code === "EROFS")) {
    explainPermissionFailure(error);
  } else {
    console.error(`[recourse] ledger preparation failed: ${error?.message ?? error}`);
    console.error("[recourse] starting the server regardless so the failure is observable.");
  }
  process.exit(0);
}

// Report where data will live, so a misconfigured volume is obvious in the logs.
try {
  accessSync(dir, constants.W_OK);
  console.log(`[recourse] ledger directory writable: ${dir}`);
} catch {
  /* already reported above */
}
