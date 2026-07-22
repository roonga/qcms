// Portal dev-server wrapper for the Playwright suite (task 045, exit criterion 5).
//
// Playwright's webServer captures a child's stdout into its own report, not a
// file a spec can scan. So we spawn the portal dev server ourselves, mirror its
// stdout/stderr to the console (so nothing is hidden) AND tee it to
// `.playwright/server-logs/portal.log`, which the server-side log gate scans for
// error/warn lines. Playwright still detects readiness by polling the URL, so
// teeing does not interfere with startup detection.

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const port = process.env.PORTAL_PORT ?? "3100";
const logDir = fileURLToPath(new URL("../../.playwright/server-logs/", import.meta.url));
const logPath = `${logDir}portal.log`;
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, "", "utf8");

// A single command string (not argv + shell:true) avoids Node's DEP0190 warning,
// which would otherwise land in the captured portal log.
const child = spawn(`pnpm --filter qcms-portal dev --port ${port}`, {
  shell: true,
  cwd: repoRoot,
  env: process.env,
});

function tee(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  try {
    appendFileSync(logPath, text);
  } catch {
    // A transient append failure must not crash the dev server.
  }
}

child.stdout.on("data", tee);
child.stderr.on("data", tee);
child.on("exit", (code) => process.exit(code ?? 0));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill();
    process.exit(0);
  });
}
