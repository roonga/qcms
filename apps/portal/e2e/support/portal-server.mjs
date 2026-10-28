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

const port = process.env.PORTAL_PORT;
if (port === undefined || port === "") {
  writeSync(2, "[portal-server] PORTAL_PORT is not set. See docs/PORTS.md.\n");
  process.exit(1);
}
const defaultLogPath = fileURLToPath(
  new URL("../../.playwright/server-logs/portal.log", import.meta.url),
);
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

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
  for (const pid of [rootPid, ...descendantsOf(rootPid)]) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone, which is the outcome this wanted.
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
  reapChildTree();
  process.exit(exitCode);
}

function tee(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  try {
    appendFileSync(logPath, text);
  } catch {
    // A log that cannot be written must not take the server down.
  }
  if (ready || finished) return;
  startupOutput = (startupOutput + text).slice(-STARTUP_SCAN_WINDOW);
  if (!FATAL_STARTUP.test(startupOutput)) return;
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
  failFast(reason, code === null || code === 0 ? 1 : code);
}

child.stdout.on("data", tee);
child.stderr.on("data", tee);

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
        const status = response.statusCode;
        settle(status !== undefined && status < READY_STATUS_CEILING);
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
