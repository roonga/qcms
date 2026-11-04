// Do not wait for globalSetup: Playwright waits for webServers before running it.

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

// Require the seat-assigned port; a fallback would let separate runs contend for one listener.
const port = process.env.ADMIN_PORT;
if (port === undefined || port === "") {
  writeSync(2, "[admin-server] ADMIN_PORT is not set. See docs/PORTS.md.\n");
  process.exit(1);
}
const defaultLogPath = fileURLToPath(
  new URL("../../.playwright/server-logs/admin.log", import.meta.url),
);
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

// A production build avoids dev-server recompilation replacing the document during browser interaction.
const production = process.env.QCMS_HARNESS_BUILD === "1";
const defaultCommand = production
  ? `pnpm --filter qcms-admin build && pnpm --filter qcms-admin start --port ${port}`
  : `pnpm --filter qcms-admin dev --port ${port}`;
const devCommand = process.env.QCMS_ADMIN_SERVER_COMMAND ?? defaultCommand;
const logPath = process.env.QCMS_ADMIN_SERVER_LOG ?? defaultLogPath;

const LOG_TAIL_LINES = 30;
const READINESS_POLL_MS = 250;
// Allow the final stack-trace bytes to reach the log before reading its tail.
const FLUSH_GRACE_MS = 300;
const STARTUP_SCAN_WINDOW = 64 * 1024;

// These markers catch fatal errors whose installed handlers keep the process alive.
// A compile error can leave the server reachable, so it is not a process-fatal marker.
const FATAL_STARTUP = /^(?:Unhandled Rejection|Uncaught Exception):/m;

mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, "", "utf8");

// Resolve ps absolutely so a writable PATH entry cannot shadow the process-tree command.
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

// The shell does not forward signals, and Playwright skips group cleanup after this wrapper exits itself.
function reapChildTree() {
  const rootPid = child?.pid;
  if (rootPid === undefined) return;
  for (const pid of [rootPid, ...descendantsOf(rootPid)]) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // A descendant may have exited between the process snapshot and the kill.
    }
  }
}

// Use synchronous stderr: process.exit can truncate buffered pipe output.
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
    // A transient log append failure must not crash the dev server.
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
  // Exiting before readiness is a startup failure even if the child reports success.
  failFast(reason, code === null || code === 0 ? 1 : code);
}

// Probe /healthz: the root route needs an API that globalSetup has not started yet.
// A server returning only errors must not disarm startup failure detection.
const READY_STATUS_CEILING = 400;
const READY_PATH = "/healthz";

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
      request = get({ host: "localhost", port: Number(port), path: READY_PATH }, (response) => {
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

const pollSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());

// Passing one shell-command string avoids command/argv warnings in the captured server log.
child = spawn(devCommand, {
  shell: true,
  cwd: repoRoot,
  env: process.env,
});

child.stdout.on("data", tee);
child.stderr.on("data", tee);

// Wait for close so crash output is captured; a grandchild can hold the pipes open,
// so exit also arms a fallback.
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
