// Portal dev-server wrapper for the Playwright suite (task 045, exit criterion 5;
// startup fail-fast from issue #58).
//
// Playwright's webServer captures a child's stdout into its own report, not a
// file a spec can scan. So we spawn the portal dev server ourselves, mirror its
// stdout/stderr to the console (so nothing is hidden) AND tee it to
// `.playwright/server-logs/portal.log`, which the server-side log gate scans for
// error/warn lines. Playwright still detects readiness by polling the URL, so
// teeing does not interfere with startup detection.
//
// ## Why this wrapper fails fast (issue #58)
//
// Playwright races its URL poll against the webServer process exiting, so a dead
// command is reported at once. That was not enough here, for three reasons found
// by reproducing the failure rather than assuming it:
//
//  1. **The dying process is usually not this wrapper's child.** `next dev`
//     reports a fatal startup error (a bad port, a bad config) as an *unhandled
//     rejection* and then keeps running: the parent stays alive, so `pnpm` stays
//     alive, so this wrapper's child never exits. There is nothing for Playwright
//     to notice, and the run burns the full webServer timeout before reporting a
//     bare "Timed out waiting ...ms from config.webServer", with the real cause
//     only in the captured log. So the wrapper also watches the child's startup
//     output for process-fatal markers and terminates itself when one appears.
//  2. **A zero exit is a lie.** Exiting 0 when the child died (or was killed by a
//     signal, where `code` is `null`) tells Playwright the process merely "exited
//     early" and tells CI that this wrapper succeeded. Any death before readiness
//     now exits nonzero.
//  3. **The diagnosis was invisible.** `tee` mirrors the child's stderr onto
//     *this* process's stdout, and Playwright's webServer defaults to
//     `stdout: "ignore"` while forwarding `stderr`. So the failure banner and the
//     log tail below go to stderr, which is where the operator actually reads
//     them.
//
// The output watch is armed only until the server is reachable, so once the suite
// is running the wrapper behaves exactly as it did before: a post-readiness fault
// stays the server-log gate's business, not a reason to kill the dev server.

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

// Required, never defaulted. The port belongs to the run's seat (`QCMS_PORT_SEAT`,
// see docs/PORTS.md) and Playwright's webServer entry always passes it in; a literal
// fallback here would be a second, silently divergent source of truth for the one
// thing issue #255 was about. A wrapper started without it is a harness bug, so say
// so rather than binding some other lane's port.
const port = process.env.PORTAL_PORT;
if (port === undefined || port === "") {
  writeSync(2, "[portal-server] PORTAL_PORT is not set. See docs/PORTS.md.\n");
  process.exit(1);
}
const defaultLogPath = fileURLToPath(
  new URL("../../.playwright/server-logs/portal.log", import.meta.url),
);
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

// Two test-only seams, so the wrapper's failure paths can be driven by a Vitest
// test (`portal-server.test.ts`) with a stub child instead of a real Next server:
// the command to run, and where to tee it. Both default to the real thing, so
// nothing about a normal Playwright run changes.
const devCommand =
  process.env.QCMS_PORTAL_SERVER_COMMAND ?? `pnpm --filter qcms-portal dev --port ${port}`;
const logPath = process.env.QCMS_PORTAL_SERVER_LOG ?? defaultLogPath;

/** How many lines of the captured log to surface when startup fails. */
const LOG_TAIL_LINES = 30;

/** How often to probe the dev server's URL while waiting for it to come up. */
const READINESS_POLL_MS = 250;

/**
 * Grace period before reading the log tail, so the rest of a stack trace (which
 * arrives in later chunks, or after the `exit` event but before the pipes close)
 * is in the file we are about to quote. Weighed against a full webServer timeout,
 * this is free.
 */
const FLUSH_GRACE_MS = 300;

/** Cap on the retained startup output that `FATAL_STARTUP` is matched against. */
const STARTUP_SCAN_WINDOW = 64 * 1024;

/**
 * Process-fatal Node markers, deliberately narrow. Node prints these two only
 * when something installed a handler for the corresponding process event (Next
 * does) and therefore did NOT die: exactly the case Playwright cannot see. A
 * child that dies on its own is covered by the exit path instead.
 *
 * Next's compile-error glyph is intentionally NOT here. A route that fails to
 * compile still leaves a reachable server, so the suite should start and let the
 * server-log gate report it, rather than have the harness kill a dev server that
 * was going to work.
 */
const FATAL_STARTUP = /^(?:Unhandled Rejection|Uncaught Exception):/m;

mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, "", "utf8");

// A single command string (not argv + shell:true) avoids Node's DEP0190 warning,
// which would otherwise land in the captured portal log.
const child = spawn(devCommand, {
  shell: true,
  cwd: repoRoot,
  env: process.env,
});

/** Set once the dev server answers on its port: disarms the startup watch. */
let ready = false;
/** Set once the ending is decided, so only the first cause wins. */
let finished = false;
/** Pre-readiness output, retained only so a marker split across chunks matches. */
let startupOutput = "";

/** The last `LOG_TAIL_LINES` non-blank lines of the captured server log. */
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

/**
 * Absolute path to `ps`, never resolved through `PATH`: a writable directory
 * earlier in `PATH` could otherwise shadow it (`sonarjs/no-os-command-from-path`).
 * Both locations are covered because Linux distributions differ on which is the
 * real file and which is the merged-usr symlink.
 */
const PS_BINARY = ["/bin/ps", "/usr/bin/ps"].find((candidate) => existsSync(candidate));

/**
 * Every live descendant pid of `rootPid`, from a single `ps` snapshot.
 *
 * One `ps` rather than recursive `pgrep -P` calls: a single snapshot cannot race
 * against itself, and `ps -e -o pid=,ppid=` is portable across Linux and macOS.
 */
function descendantsOf(rootPid) {
  if (PS_BINARY === undefined) return [];
  const listed = spawnSync(PS_BINARY, ["-e", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (listed.status !== 0 || typeof listed.stdout !== "string") return [];
  /** parent pid -> its immediate children. */
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
 * Kill the spawned command and every process under it.
 *
 * Why this has to exist, and why `child.kill()` is not enough: the command runs
 * through `sh -c`, which does not forward signals, so signalling the direct child
 * reaches at most `pnpm` and leaves `next dev` and `next-server` running. On a
 * NORMAL teardown that does not matter, because Playwright SIGKILLs the whole
 * process group and the child is deliberately not `detached`, so it shares this
 * process's group and dies with it. But Playwright skips that cleanup entirely
 * once the wrapper has already exited by itself (`killProcess` short-circuits on
 * `processClosed=true`), which is exactly what the fail-fast path below does. So
 * a self-exiting wrapper must reap its own subtree, or a zombie `next-server`
 * survives holding the port and `reuseExistingServer` latches onto it next run.
 *
 * Deliberately NOT solved with `detached: true` on the child: giving the child its
 * own process group would put it outside the group Playwright SIGKILLs, leaking on
 * every normal teardown instead, and SIGKILL is untrappable so the wrapper could
 * not compensate.
 */
function reapChildTree() {
  const rootPid = child.pid;
  if (rootPid === undefined) return;
  // Snapshot before killing anything, then kill the root first so it cannot spawn
  // a replacement behind the snapshot.
  for (const pid of [rootPid, ...descendantsOf(rootPid)]) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is the normal case for most of the tree.
    }
  }
}

/**
 * Report why startup failed and exit nonzero, so Playwright abandons its
 * webServer wait immediately instead of polling to its timeout.
 *
 * `writeSync(2, ...)` rather than `process.stderr.write`: stderr to a pipe can be
 * asynchronous, and the `process.exit` below would truncate the very tail this
 * function exists to print.
 */
function failFast(reason, exitCode) {
  finished = true;
  writeSync(
    2,
    [
      "",
      `[portal-server] portal dev server failed during startup: ${reason}.`,
      `[portal-server] last ${LOG_TAIL_LINES} non-blank lines of ${logPath}:`,
      logTail(),
      `[portal-server] exiting ${exitCode} so the Playwright webServer wait ends now.`,
      "",
    ].join("\n"),
  );
  // Always, not just on the "child never exited" path: even when the child itself
  // has gone, `sh -c` may have left the dev server behind it running.
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
  // The child has reported a fatal error but, as in issue #58, may never exit.
  // Claim the ending now and let the rest of the trace land before quoting it.
  finished = true;
  const reason = "the dev server reported a fatal startup error and did not exit";
  setTimeout(() => failFast(reason, 1), FLUSH_GRACE_MS);
}

/**
 * The child ended. Before readiness that is always a failure, including a clean
 * `code === 0` (a dev server that stops during startup never served anything) and
 * a signal kill (`code === null`). After readiness, keep the original behaviour.
 */
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
  // A clean `0` must still become a nonzero wrapper exit: `code ?? 1` would pass
  // the 0 straight through and report success for a server that never started.
  failFast(reason, code === null || code === 0 ? 1 : code);
}

child.stdout.on("data", tee);
child.stderr.on("data", tee);

// Prefer `close` (both stdio streams ended, so the crash output has been teed)
// over `exit` (which can fire with the final chunks still unflushed). A grandchild
// holding the inherited pipes open would stall `close` indefinitely, so `exit`
// arms a short fallback.
child.on("close", handleChildEnd);
child.on("exit", (code, signal) => {
  setTimeout(() => handleChildEnd(code, signal), FLUSH_GRACE_MS);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    finished = true;
    // Same reasoning as the fail-fast path: this handler exits the wrapper itself,
    // so nothing else is going to reap the subtree afterwards. (Playwright's own
    // teardown SIGKILLs the group and never reaches here.)
    reapChildTree();
    process.exit(0);
  });
}

/**
 * Highest status code that counts as "this server is serving".
 *
 * Any HTTP response used to settle this probe true, which disarmed the startup
 * watch for a server that was answering nothing but errors (issue #381). The case
 * that found it: `@roonga/qcms-ui`'s `fonts` subpath resolves to `dist`, so in a tree
 * where it had not been built the portal 500'd on every request, including `/`.
 * The wrapper called that ready, cleared `startupOutput`, and never looked at the
 * fatal output again - so the whole failure reduced to Playwright's own poll
 * running out after 180s with a bare "Timed out waiting" and the cause visible
 * only inside the captured log, which is precisely what issue #58's machinery
 * exists to prevent.
 *
 * 400 rather than 500 as the line: a dev server that answers 4xx on `/` is not
 * serving this app either, and Playwright's own `webServer` readiness check draws
 * it in the same place. The portal's `/` is a real page (`app/page.tsx`), so a 200
 * is what a working dev server returns here.
 */
const READY_STATUS_CEILING = 400;

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
        // An absent status is treated as not ready: the probe's job is to be sure,
        // and the poll simply asks again a quarter of a second later.
        const status = response.statusCode;
        settle(status !== undefined && status < READY_STATUS_CEILING);
      });
    } catch {
      // An unusable port is simply never ready: the startup watch and the exit
      // path are what end the run in that case.
      settle(false);
      return;
    }
    request.setTimeout(READINESS_POLL_MS * 4, () => request.destroy());
    // `error` covers a refused connection; `close` is the backstop so a destroyed
    // socket can never leave this promise (and the poll loop) hanging.
    request.on("error", () => settle(false));
    request.on("close", () => settle(false));
  });
}

// Poll until the server is up, then stop: `ready` disarms the startup watch and
// restores the pre-#58 behaviour for the rest of the run. The sleep is unref'd so
// polling never keeps this process alive by itself.
void (async () => {
  while (!ready && !finished) {
    if (await probeReady()) {
      ready = true;
      startupOutput = "";
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_POLL_MS).unref());
  }
})();
