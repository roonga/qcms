import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";

/**
 * Readiness detection for the admin dev-server wrapper (issue #381).
 *
 * The wrapper is the portal's (`apps/portal/e2e/support/portal-server.mjs`) with an
 * admin command and log path, and it carried the portal's readiness defect too: any
 * HTTP response settled the probe true, so a dev server answering nothing but 500s
 * counted as up. That disarms the startup watch, and the whole fail-fast apparatus
 * issue #58 added collapses back to Playwright's bare 180-second "Timed out waiting".
 *
 * These two tests pin the fix and the thing the fix must not break. They live beside
 * the wrapper for the reason `portal-server.test.ts` records at length: the `tooling`
 * Vitest project is deliberately neither typechecked nor linted, while here the file
 * is both, and it runs under plain `pnpm test`. It is a `.test.ts`, not a `.pw.ts`,
 * so Playwright never collects it.
 *
 * The wrapper is driven through its two documented test-only environment seams, so
 * what runs is the shipped code with a stub standing in for `next dev`.
 */

const WRAPPER = fileURLToPath(new URL("admin-server.mjs", import.meta.url));

/**
 * Wall-clock ceiling for a fail-fast exit, and the per-test timeout derived from it.
 *
 * Same reasoning as the portal suite: the number being ruled out is the 180-second
 * `webServer.timeout`, so a loose bound well under it proves the point, and loose is
 * required because this is wall clock across a real child-process lifecycle on a
 * runner whose CPU share is not ours to choose.
 */
const FAST_FAILURE_BUDGET_MS = 60_000;
const BUDGET_TEST_TIMEOUT_MS = FAST_FAILURE_BUDGET_MS + 30_000;

/** Ceiling on the readiness wait, and the per-test timeout derived from it. */
const WRAPPER_BOOT_BUDGET_MS = 60_000;
const READINESS_TEST_TIMEOUT_MS = WRAPPER_BOOT_BUDGET_MS + 30_000;

/** What `spawn` returns for this file's `stdio: ["ignore", "pipe", "pipe"]`. */
type WrapperProcess = ChildProcessByStdio<null, Readable, Readable>;

interface Wrapper {
  readonly child: WrapperProcess;
  readonly ended: Promise<{ readonly code: number | null; readonly elapsedMs: number }>;
  stderr: () => string;
  stdout: () => string;
}

const tempDirs: string[] = [];
const running: WrapperProcess[] = [];

/**
 * Claim a port from the ephemeral range and release it again, so a stray listener
 * cannot silently invert a result. Each stub below binds the port it is handed.
 */
function freePort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("could not allocate a free port"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(String(port)));
    });
  });
}

/**
 * A last-resort net, not the mechanism under test: the wrapper reaps its own subtree
 * before exiting. Each wrapper gets its own process group so a failed expectation
 * cannot leak a stub that holds a port into the next test.
 */
function reap(child: WrapperProcess): void {
  const { pid } = child;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone, which is the normal case after a clean exit.
  }
}

afterEach(() => {
  for (const child of running) reap(child);
  running.length = 0;
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Launch the real wrapper with `stubSource` standing in for `next dev`. */
function startWrapper(stubSource: string, port: string): Wrapper {
  const dir = mkdtempSync(join(tmpdir(), "admin-server-"));
  tempDirs.push(dir);
  const stub = join(dir, "stub.mjs");
  writeFileSync(stub, stubSource, "utf8");

  const startedAt = Date.now();
  const child = spawn(process.execPath, [WRAPPER], {
    env: {
      ...process.env,
      ADMIN_PORT: port,
      QCMS_ADMIN_SERVER_COMMAND: `${process.execPath} ${stub}`,
      QCMS_ADMIN_SERVER_LOG: join(dir, "admin.log"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  running.push(child);

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  // Collected rather than merely drained, so a chatty stub cannot fill the pipe.
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  const ended = new Promise<{ code: number | null; elapsedMs: number }>((resolve) => {
    child.on("close", (code) => resolve({ code, elapsedMs: Date.now() - startedAt }));
  });

  return { child, ended, stderr: () => stderr, stdout: () => stdout };
}

/**
 * Wait until `match` shows up in the wrapper's teed stdout.
 *
 * Teed output is the readiness signal, never a fixed sleep (issue #140): the wrapper
 * attaches the stdout tee before it registers its signal handlers, in one synchronous
 * module body, so anything echoed places it past that registration. The wrapper's own
 * exit is checked each turn so an early death reports its cause here rather than
 * burning the timeout in silence.
 */
async function waitForTeedOutput(
  wrapper: Wrapper,
  match: string,
  timeoutMs = WRAPPER_BOOT_BUDGET_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (wrapper.stdout().includes(match)) return;
    const { exitCode, signalCode } = wrapper.child;
    if (exitCode !== null || signalCode !== null) {
      throw new Error(
        `wrapper ended (code ${String(exitCode)}, signal ${String(signalCode)}) before teeing ` +
          `${JSON.stringify(match)}; stdout was:\n${wrapper.stdout()}\nstderr was:\n${wrapper.stderr()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `wrapper never teed ${JSON.stringify(match)} within ${String(timeoutMs)}ms; stdout was:\n` +
      `${wrapper.stdout()}\nstderr was:\n${wrapper.stderr()}`,
  );
}

/**
 * The #381 shape: the port is open and every request is answered, but answered with
 * a 500. The fatal line is armed off the first request, so it always lands after the
 * wrapper's first probe has been answered - the window in which the old "any response
 * is ready" rule had already closed the startup watch.
 */
const SERVES_ONLY_ERRORS = `
import { createServer } from "node:http";
let armed = false;
createServer((_req, res) => {
  res.writeHead(500, { "content-type": "text/plain" });
  res.end("Internal Server Error");
  if (armed) return;
  armed = true;
  setTimeout(
    () => process.stdout.write("Unhandled Rejection: Error: admin boot failed\\n"),
    500,
  );
}).listen(Number(process.env.ADMIN_PORT));
setInterval(() => {}, 1000);
`;

/**
 * A healthy admin dev server as this suite meets it: `/healthz` answers, and every
 * page still 500s because `globalSetup` has not created the API yet. That split is
 * the whole reason the probe asks for `/healthz`, and it is what makes this stub a
 * test of the path as well as of the status gate.
 *
 * The late fatal line is rescheduled on every request, so it can only fire once the
 * knocking has stopped, which is once the wrapper is ready. Three seconds of quiet is
 * many poll intervals, so it cannot be mistaken for the gap between two probes.
 */
const HEALTHY_THEN_LATE_FAULT = `
import { createServer } from "node:http";
let lateBoom;
createServer((req, res) => {
  clearTimeout(lateBoom);
  lateBoom = setTimeout(
    () => process.stdout.write("Unhandled Rejection: Error: late boom\\n"),
    3_000,
  );
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok\\n");
    return;
  }
  res.writeHead(500, { "content-type": "text/plain" });
  res.end("no API yet");
}).listen(Number(process.env.ADMIN_PORT));
process.stdout.write("  \\u25b2 Next.js ready\\n");
setInterval(() => {}, 1000);
`;

describe("admin-server wrapper readiness detection (issue #381)", () => {
  it(
    "does not call a server that answers 500 to everything ready",
    async () => {
      const wrapper = startWrapper(SERVES_ONLY_ERRORS, await freePort());
      const { code, elapsedMs } = await wrapper.ended;

      // The fail-fast having happened at all is the proof that the startup watch
      // stayed armed: the fatal marker is written after the first request has been
      // answered, so under the old rule the wrapper was already "ready" and would
      // have ignored it until the test timed out.
      expect(code).not.toBe(0);
      expect(
        elapsedMs,
        `fail-fast took ${String(elapsedMs)}ms, which is no longer "seconds not minutes"`,
      ).toBeLessThan(FAST_FAILURE_BUDGET_MS);
      const stderr = wrapper.stderr();
      expect(stderr).toContain("admin dev server failed during startup");
      expect(stderr).toContain("admin boot failed");
    },
    BUDGET_TEST_TIMEOUT_MS,
  );

  it(
    "becomes ready on a 200 from /healthz and leaves a later fault to the log gate",
    async () => {
      // The regression that would be worse than the bug. Tightening the probe to a
      // status gate without moving it off `/` would leave this wrapper armed for the
      // entire run, because the admin's `/` needs the API that `globalSetup` has not
      // built yet - and it would then kill the dev server on the first post-readiness
      // fault, which is the server-log gate's business per spec, not the harness's.
      const wrapper = startWrapper(HEALTHY_THEN_LATE_FAULT, await freePort());

      // Seeing the late fatal teed back out means it reached the watch after
      // readiness, and that the wrapper is booted enough to have a SIGTERM handler.
      await waitForTeedOutput(wrapper, "late boom");
      // A wrongly armed fail-fast fires 300ms (FLUSH_GRACE_MS) after that tee, so
      // this window exists only to let the failure happen before we assert it did not.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(wrapper.child.exitCode).toBeNull();
      expect(wrapper.stderr()).toBe("");

      wrapper.child.kill("SIGTERM");
      expect((await wrapper.ended).code).toBe(0);
    },
    READINESS_TEST_TIMEOUT_MS,
  );
});
