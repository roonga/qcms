// Admin dev-server wrapper for the Playwright suite (task 031).
//
// Same shape as the portal's wrapper (`apps/portal/e2e/support/portal-server.mjs`) and
// for the same reasons: Playwright captures a webServer child's stdout into its own
// report rather than a file, and a `next dev` that dies during startup often does not
// exit, so Playwright polls to its full timeout and reports a bare "Timed out waiting"
// with the real cause invisible. This wrapper tees the child's output to a file, watches
// it for process-fatal markers, and exits nonzero the moment startup fails.
//
// It must NOT wait for the database, and that is worth stating because waiting is the
// obvious first design and it deadlocks: Playwright gates `globalSetup` on every
// webServer being reachable, so a wrapper that blocks until globalSetup has written its
// fixtures waits for something that is waiting for it. Measured once, as a 150s stall and
// an "Exit code: 1".
//
// Since task 056 there is nothing to wait for in any case: the admin holds no database
// handle at all (better-auth moved into the API), so this dev server has no dependency on
// the throwaway container `globalSetup` boots. The harness probes `/healthz`, which
// reaches neither the API nor a database.
//
// It carries the portal wrapper's subtree reaping for the same reason: the command runs
// through `sh -c`, which does not forward signals, and Playwright skips its own
// process-group kill entirely once a wrapper has exited by itself - which is what the
// fail-fast path does. So the wrapper reaps its own tree from one `ps` snapshot, or a
// zombie `next-server` survives holding the port and `reuseExistingServer` latches onto
// it next run.

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { get } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Required, never defaulted, for the same reason as the portal wrapper: the port
// belongs to the run's seat (`QCMS_PORT_SEAT`, see docs/PORTS.md) and Playwright
// always passes it in, so a literal fallback would be a second source of truth for
// exactly the thing issue #255 was about.
const port = process.env.ADMIN_PORT;
if (port === undefined || port === "") {
  writeSync(2, "[admin-server] ADMIN_PORT is not set. See docs/PORTS.md.\n");
  process.exit(1);
}
const logPath = fileURLToPath(new URL("../../.playwright/server-logs/admin.log", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/** How many lines of the captured log to surface when startup fails. */
const LOG_TAIL_LINES = 30;
/** How often to probe the dev server's URL while waiting for it to come up. */
const READINESS_POLL_MS = 250;
/** Grace period before reading the log tail, so a full stack trace has landed. */
const FLUSH_GRACE_MS = 300;
/** Cap on the retained startup output that `FATAL_STARTUP` is matched against. */
const STARTUP_SCAN_WINDOW = 64 * 1024;

/**
 * Process-fatal Node markers, deliberately narrow: Node prints these only when a handler
 * was installed (Next installs them) and the process therefore did NOT die, which is
 * exactly the case Playwright cannot see. A child that dies on its own is covered by the
 * exit path instead. Next's compile-error glyph is intentionally absent: a route that
 * fails to compile still leaves a reachable server.
 */
const FATAL_STARTUP = /^(?:Unhandled Rejection|Uncaught Exception):/m;

mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, "", "utf8");

/**
 * Absolute path to `ps`, never resolved through `PATH`: a writable directory earlier in
 * `PATH` could otherwise shadow it (`sonarjs/no-os-command-from-path`). Both locations
 * are covered because distributions differ on which is the file and which the symlink.
 */
const PS_BINARY = ["/bin/ps", "/usr/bin/ps"].find((candidate) => existsSync(candidate));

let child;
let ready = false;
let finished = false;
let startupOutput = "";

function logTail() {
  let text;
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return "(server log could not be read)";
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return "(server log is empty)";
  return lines.slice(-LOG_TAIL_LINES).join("\n");
}

/** Every live descendant pid of `rootPid`, from a single `ps` snapshot. */
function descendantsOf(rootPid) {
  if (PS_BINARY === undefined) return [];
  const listed = spawnSync(PS_BINARY, ["-e", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (listed.status !== 0 || typeof listed.stdout !== "string") return [];
  const childrenOf = new Map();
  for (const line of listed.stdout.split("\n")) {
    const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;
    const siblings = childrenOf.get(parentPid);
    if (siblings === undefined) childrenOf.set(parentPid, [pid]);
    else siblings.push(pid);
  }
  const found = [];
  const pending = [rootPid];
  while (pending.length > 0) {
    const parent = pending.pop();
    for (const pid of childrenOf.get(parent) ?? []) {
      found.push(pid);
      pending.push(pid);
    }
  }
  return found;
}

/**
 * Kill the spawned command and everything under it. `child.kill()` is not enough: the
 * command runs through `sh -c`, which does not forward signals, so signalling the direct
 * child reaches at most `pnpm` and leaves `next dev` running. Playwright SIGKILLs the
 * whole process group on a normal teardown, but skips that entirely once this wrapper has
 * already exited by itself, which is what the fail-fast path does.
 */
function reapChildTree() {
  const rootPid = child?.pid;
  if (rootPid === undefined) return;
  for (const pid of [rootPid, ...descendantsOf(rootPid)]) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is the normal case for most of the tree.
    }
  }
}

/**
 * Report why startup failed and exit nonzero, so Playwright abandons its webServer wait
 * immediately. `writeSync(2, ...)` rather than `process.stderr.write`: stderr to a pipe
 * can be asynchronous and `process.exit` would truncate the very tail this prints.
 */
function failFast(reason, exitCode) {
  finished = true;
  writeSync(
    2,
    [
      "",
      `[admin-server] admin dev server failed during startup: ${reason}.`,
      `[admin-server] last ${LOG_TAIL_LINES} non-blank lines of ${logPath}:`,
      logTail(),
      `[admin-server] exiting ${exitCode} so the Playwright webServer wait ends now.`,
      "",
    ].join("\n"),
  );
  reapChildTree();
  process.exit(exitCode);
}

function tee(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  try {
    appendFileSync(logPath, text);
  } catch {
    // A transient append failure must not crash the dev server.
  }
  if (ready || finished) return;
  startupOutput = (startupOutput + text).slice(-STARTUP_SCAN_WINDOW);
  if (!FATAL_STARTUP.test(startupOutput)) return;
  finished = true;
  setTimeout(
    () => failFast("the dev server reported a fatal startup error and did not exit", 1),
    FLUSH_GRACE_MS,
  );
}

function handleChildEnd(code, signal) {
  if (finished) return;
  if (ready) {
    finished = true;
    process.exit(code ?? 0);
    return;
  }
  const reason = signal
    ? `the dev-server process was killed by ${signal} before the server was reachable`
    : `the dev-server process exited with code ${code} before the server was reachable`;
  // A clean `0` must still become a nonzero wrapper exit: a dev server that stops during
  // startup never served anything.
  failFast(reason, code === null || code === 0 ? 1 : code);
}

/** Resolves true when the dev server answers on its port, false otherwise. */
function probeReady() {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let request;
    try {
      request = get({ host: "localhost", port: Number(port), path: "/" }, (response) => {
        response.resume();
        settle(true);
      });
    } catch {
      settle(false);
      return;
    }
    request.setTimeout(READINESS_POLL_MS * 4, () => request.destroy());
    request.on("error", () => settle(false));
    request.on("close", () => settle(false));
  });
}

/** Unref'd, so polling alone never keeps this process alive once the run is over. */
const pollSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());

// A single command string (not argv + shell:true) avoids Node's DEP0190 warning, which
// would otherwise land in the captured log.
child = spawn(`pnpm --filter qcms-admin dev --port ${port}`, {
  shell: true,
  cwd: repoRoot,
  env: process.env,
});

child.stdout.on("data", tee);
child.stderr.on("data", tee);

// Prefer `close` (both stdio streams ended, so crash output has been teed) over `exit`
// (which can fire with final chunks unflushed). A grandchild holding the inherited pipes
// open would stall `close` indefinitely, so `exit` arms a short fallback.
child.on("close", handleChildEnd);
child.on("exit", (code, signal) => {
  setTimeout(() => handleChildEnd(code, signal), FLUSH_GRACE_MS);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    finished = true;
    reapChildTree();
    process.exit(0);
  });
}

// Poll until the server is up, then stop: `ready` disarms the startup watch.
void (async () => {
  while (!ready && !finished) {
    if (await probeReady()) {
      ready = true;
      startupOutput = "";
      return;
    }
    await pollSleep(READINESS_POLL_MS);
  }
})();
