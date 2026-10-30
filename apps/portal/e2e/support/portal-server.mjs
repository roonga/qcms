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

// `QCMS_HARNESS_BUILD=1` serves a production build instead of `next dev`, for the reason
// the admin wrapper records: a dev server's first-visit compile replaces the document
// under the page. Opt-in, because it costs a build per run; CI does not set it.
const production = process.env.QCMS_HARNESS_BUILD === "1";
const defaultCommand = production
  ? `pnpm --filter qcms-portal build && pnpm --filter qcms-portal start --port ${port}`
  : `pnpm --filter qcms-portal dev --port ${port}`;
const devCommand = process.env.QCMS_PORTAL_SERVER_COMMAND ?? defaultCommand;
const logPath = process.env.QCMS_PORTAL_SERVER_LOG ?? defaultLogPath;

/** How many lines of the captured log to surface when startup fails. */
const LOG_TAIL_LINES = 30;

/** How often to probe the dev server's URL while waiting for it to come up. */
const READINESS_POLL_MS = 250;

const FLUSH_GRACE_MS = 300;

/** Cap on the retained startup output that `FATAL_STARTUP` is matched against. */
const STARTUP_SCAN_WINDOW = 64 * 1024;

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
