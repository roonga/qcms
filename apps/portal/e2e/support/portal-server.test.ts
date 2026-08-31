import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";

/**
 * Startup fail-fast for the portal dev-server wrapper (issue #58).
 *
 * The failure class: a portal dev server that dies during e2e startup used to
 * present as a bare 180s Playwright `webServer` timeout, with the cause only in
 * `apps/portal/.playwright/server-logs/portal.log`. Measured on the real thing
 * (`next dev --port 99999`, which reports a fatal `RangeError` and then keeps
 * running), the operator's entire output was one line, `Timed out waiting
 * 180000ms from config.webServer.`, after 199 seconds. These tests pin the three
 * properties that replaced it, and the one that must not change.
 *
 * ## Why this test lives here and not in `scripts/`
 *
 * `scripts/agent-loop.test.ts` is the closest precedent in shape (spawn a real
 * script, assert its exit code and stderr) and this borrows that shape. But the
 * `tooling` Vitest project those files sit in is documented in `vitest.config.ts`
 * as deliberately neither typechecked nor linted, and it is excluded from
 * `turbo run test` (it needs the separate `pnpm test:tooling` invocation).
 * `portal-server.mjs` is portal e2e harness code, so the test belongs to the
 * package that owns it: in the `qcms-portal` project it is typechecked (the
 * portal `tsconfig.json` includes every TypeScript file under the app), linted
 * (the portal `lint` script covers `e2e`), and covered by plain `pnpm test`
 * rather than only `pnpm test:tooling`. It is a `.test.ts`, not a
 * `.pw.ts`, so Playwright never collects it, and ADR-23 keeps Vitest as the only
 * runner below the browser.
 */

const WRAPPER = fileURLToPath(new URL("portal-server.mjs", import.meta.url));

/**
 * Wall-clock ceiling for a fail-fast exit.
 *
 * The property this pins is "seconds, not the webServer timeout": #58 measured
 * 199s before the fix and 2s after, against the 180_000ms
 * `webServer.timeout` in the root `playwright.config.ts`. So the number that has
 * to be ruled out is 180s, and any bound well under it proves the fix decisively.
 * What proves the fail-fast *path* was taken is the mechanism each test asserts
 * alongside this (a nonzero exit code, the fatal-marker message, the quoted log
 * tail); this bound only rules out the hang, so it can afford to be loose.
 *
 * Loose is required, because `elapsedMs` is wall clock across a real
 * child-process lifecycle: spawn, the stub's own Node boot, the wrapper's 300ms
 * flush grace, subtree reaping. That cost scales with the CPU share the runner
 * gets, which is why a loaded GitHub runner measured 23278ms against the original
 * 20000ms ceiling while the duplicate run of the same commit passed (issue #136,
 * the same class as #61). A third of the webServer timeout leaves 2.5x headroom
 * over that worst observation and still fails any regression toward the 180s hang.
 */
const FAST_FAILURE_BUDGET_MS = 60_000;

/**
 * Per-test timeout for the two tests that assert `FAST_FAILURE_BUDGET_MS`. It has
 * to sit above the budget, or an over-budget run would die on an opaque Vitest
 * timeout instead of on the assertion that names the elapsed time. Derived rather
 * than written out so the two cannot drift apart. Scoped to those two tests, and
 * nothing outside this file changes. The pattern has since been reused once, for
 * the pair that gained a readiness wait in issue #140 (`SIGTERM_TEST_TIMEOUT_MS`);
 * the three tests with no derived wait of their own keep the 30s they had.
 */
const BUDGET_TEST_TIMEOUT_MS = FAST_FAILURE_BUDGET_MS + 30_000;

/**
 * Ceiling on `waitForTeedOutput`, the readiness wait the two SIGTERM tests use in
 * place of a fixed sleep (issue #140).
 *
 * It has to clear three serial process boots under load: this wrapper, the `sh -c`
 * it spawns its command through, and the stub itself, since the first thing the
 * wrapper can echo is something the stub printed. At the ~50x starvation that
 * reproduces #140 that chain measured a little over 20s, so a bound near the
 * fail-fast budget keeps the wait honest to roughly 150x while still failing any
 * wrapper that never speaks at all. Unloaded the wait ends in well under a second,
 * so the ceiling costs nothing in the normal case.
 */
const WRAPPER_BOOT_BUDGET_MS = 60_000;

/**
 * Per-test timeout for the two SIGTERM tests, derived from the wait they contain
 * for the same reason `BUDGET_TEST_TIMEOUT_MS` is derived: a wait that reaches its
 * ceiling must die on the message that names what it was waiting for, not on an
 * opaque Vitest timeout. The 30s on top covers the SIGTERM round trip after the
 * wait: the wrapper's handler reaps its subtree with a `ps` snapshot, which is
 * itself a process spawn and so is one of the things load stretches.
 */
const SIGTERM_TEST_TIMEOUT_MS = WRAPPER_BOOT_BUDGET_MS + 30_000;

/**
 * Claim a port from the ephemeral range and release it again. Most tests here
 * want a port that stays CLOSED, so the wrapper's readiness probe never succeeds
 * and they stay in the pre-readiness window that the fail-fast logic is armed in;
 * the readiness test hands the same port to a stub that does listen. Allocating
 * rather than hard-coding keeps a stray listener from silently inverting a result.
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

/** What `spawn` returns for this file's `stdio: ["ignore", "pipe", "pipe"]`. */
type WrapperProcess = ChildProcessByStdio<null, Readable, Readable>;

interface Wrapper {
  readonly child: WrapperProcess;
  /** Resolves when the wrapper process ends. */
  readonly ended: Promise<{ readonly code: number | null; readonly elapsedMs: number }>;
  /** Everything the wrapper wrote to stderr, which is what Playwright forwards. */
  stderr: () => string;
  /** The tee'd child output, which is how a stub reports the pids it created. */
  stdout: () => string;
}

const tempDirs: string[] = [];
const running: WrapperProcess[] = [];

/**
 * A last-resort net so a failed expectation cannot leak a stub that holds a port
 * into the next test. It is NOT the mechanism under test: the wrapper is required
 * to have reaped its own subtree before it exits, which
 * "leaves no surviving descendant behind after a fail-fast exit" asserts.
 *
 * Playwright group-SIGKILLs the wrapper only while the wrapper is still alive; it
 * skips that cleanup once the wrapper has self-exited, which is every failure path
 * here. So each wrapper gets its own process group and is killed by negative pid.
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
  // Leaving even one stub alive would let it hold a port into the next test.
  for (const child of running) reap(child);
  running.length = 0;
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Launch the real wrapper with `stubSource` standing in for `next dev`, and its
 * log teed into a throwaway directory. Both substitutions use the wrapper's
 * documented test-only env seams, so the code under test is the shipped code.
 */
function startWrapper(stubSource: string, port: string): Wrapper {
  const dir = mkdtempSync(join(tmpdir(), "portal-server-"));
  tempDirs.push(dir);
  const stub = join(dir, "stub.mjs");
  writeFileSync(stub, stubSource, "utf8");

  const startedAt = Date.now();
  const child = spawn(process.execPath, [WRAPPER], {
    env: {
      ...process.env,
      PORTAL_PORT: port,
      QCMS_PORTAL_SERVER_COMMAND: `${process.execPath} ${stub}`,
      QCMS_PORTAL_SERVER_LOG: join(dir, "portal.log"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group, so `reap` can take the wrapper's whole subtree down.
    detached: true,
  });
  running.push(child);

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  // Collected rather than merely drained, so a chatty stub can never fill the pipe
  // and stall the wrapper.
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  const ended = new Promise<{ code: number | null; elapsedMs: number }>((resolve) => {
    child.on("close", (code) => resolve({ code, elapsedMs: Date.now() - startedAt }));
  });

  return { child, ended, stderr: () => stderr, stdout: () => stdout };
}

/** True while `pid` still exists (signal 0 probes without delivering anything). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for `pid` to disappear. Polled rather than asserted outright because a
 * SIGKILLed process lingers as a zombie until whoever inherited it reaps it.
 */
async function waitUntilGone(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isAlive(pid);
}

/**
 * Wait until `match` shows up in the wrapper's teed stdout.
 *
 * This is the readiness signal the two SIGTERM tests below need (issue #140). A
 * fixed sleep before signalling is not a signal at all: `code === null` from the
 * wrapper means it died from the raw SIGTERM, which is only possible before its
 * `process.on("SIGTERM", ...)` registration has run, and under CPU starvation the
 * wrapper's Node boot outlasts any sleep length picked from an idle machine's
 * timings (~40-50x slowdown reproduces it).
 *
 * Teed output is proof that the registration has happened. `portal-server.mjs`
 * attaches the stdout tee (`child.stdout.on("data", tee)`) before it registers the
 * signal handlers, inside one synchronous module body with no top-level await, so
 * the first `data` event cannot be delivered until the whole body, handlers
 * included, has finished running. Anything the wrapper echoes therefore places it
 * past that registration, which is the only thing this wait needs to establish.
 *
 * The wrapper's own exit is checked each turn so a wrapper that died early fails
 * here with its cause rather than burning the timeout in silence. This project
 * suppresses console output, so the thrown message is the only diagnostic channel.
 */
async function waitForTeedOutput(
  wrapper: Wrapper,
  match: string,
  timeoutMs = WRAPPER_BOOT_BUDGET_MS,
) {
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
 * The #381 shape: the port is open and every request is answered, but answered
 * with a 500. The stub arms the fatal line off its first request, so the line
 * always lands after the wrapper's first probe has been answered - which is the
 * window the old "any response is ready" rule closed the startup watch in.
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
    () => process.stdout.write(
      "Unhandled Rejection: Error: Cannot find module '@qcms/ui/fonts'\\n",
    ),
    500,
  );
}).listen(Number(process.env.PORTAL_PORT));
setInterval(() => {}, 1000);
`;

/** The #58 shape: a fatal error is reported, but the process keeps running. */
const FATAL_THEN_HANGS = `
process.stdout.write("> qcms-portal@0.0.0 dev\\n> next dev --port 99999\\n");
process.stdout.write("Unhandled Rejection: RangeError: options.port should be >= 0 and < 65536.\\n");
process.stdout.write("  code: 'ERR_SOCKET_BAD_PORT'\\n");
setInterval(() => {}, 1000);
`;

describe("portal-server wrapper startup fail-fast (issue #58)", () => {
  it(
    "fails fast with the log tail when the child reports a fatal error but never exits",
    async () => {
      const wrapper = startWrapper(FATAL_THEN_HANGS, await freePort());
      const { code, elapsedMs } = await wrapper.ended;

      // Nonzero is what makes Playwright abandon its URL poll instead of waiting
      // out the timeout.
      expect(code).not.toBe(0);
      expect(
        elapsedMs,
        `fail-fast took ${String(elapsedMs)}ms, which is no longer "seconds not minutes"`,
      ).toBeLessThan(FAST_FAILURE_BUDGET_MS);

      const stderr = wrapper.stderr();
      expect(stderr).toContain("portal dev server failed during startup");
      expect(stderr).toContain("did not exit");
      // The tail, on stderr: the cause is in the failure output, not just the file.
      expect(stderr).toContain("last 30 non-blank lines of");
      expect(stderr).toContain("ERR_SOCKET_BAD_PORT");
      expect(stderr).toContain("RangeError: options.port should be >= 0 and < 65536.");
    },
    BUDGET_TEST_TIMEOUT_MS,
  );

  it(
    "propagates a nonzero child exit code and quotes the log tail",
    async () => {
      const wrapper = startWrapper(
        `process.stderr.write("Error: Cannot find module 'next'\\n");\nprocess.exit(7);\n`,
        await freePort(),
      );
      const { code, elapsedMs } = await wrapper.ended;

      expect(code).toBe(7);
      expect(
        elapsedMs,
        `fail-fast took ${String(elapsedMs)}ms, which is no longer "seconds not minutes"`,
      ).toBeLessThan(FAST_FAILURE_BUDGET_MS);
      expect(wrapper.stderr()).toContain("exited with code 7");
      expect(wrapper.stderr()).toContain("Cannot find module 'next'");
    },
    BUDGET_TEST_TIMEOUT_MS,
  );

  it("still exits nonzero when the child exits 0 before the server is reachable", async () => {
    // A dev server that stops during startup served nothing, so a 0 here would
    // report success for a run that cannot work, and would degrade Playwright's
    // message to the vague "exited early".
    const wrapper = startWrapper(
      `process.stdout.write("stopping\\n");\nprocess.exit(0);\n`,
      await freePort(),
    );
    const { code } = await wrapper.ended;

    expect(code).toBe(1);
    expect(wrapper.stderr()).toContain("exited with code 0");
  }, 30_000);

  it("caps the surfaced tail at the last 30 log lines", async () => {
    const wrapper = startWrapper(
      `for (let i = 1; i <= 40; i += 1) process.stdout.write(\`line-\${String(i).padStart(2, "0")}\\n\`);\n` +
        `process.stdout.write("Uncaught Exception: Error: boom\\n");\nsetInterval(() => {}, 1000);\n`,
      await freePort(),
    );
    const { code } = await wrapper.ended;

    expect(code).not.toBe(0);
    const stderr = wrapper.stderr();
    expect(stderr).toContain("Uncaught Exception: Error: boom");
    expect(stderr).toContain("line-40");
    // Trimmed off the front rather than dumping the whole log.
    expect(stderr).not.toContain("line-01");
  }, 30_000);

  it(
    "does not call a server that answers 500 to everything ready (issue #381)",
    async () => {
      // The failure this pins: readiness used to mean "an HTTP response arrived",
      // so a dev server that 500s every request disarmed the startup watch. The
      // reproduction was a tree where `@qcms/ui` had not been built, which makes
      // the portal's `@qcms/ui/fonts` import fail on every render. Everything the
      // #58 machinery adds was then switched off, and the run degraded back to
      // Playwright's own 180-second poll ending in a bare "Timed out waiting",
      // with the cause only inside the captured log.
      //
      // Asserting the fail-fast happened is what proves the watch stayed armed:
      // the fatal marker is written after the first request has been answered, so
      // under the old rule `ready` was already true and this stub would have run
      // until the test timed out.
      const wrapper = startWrapper(SERVES_ONLY_ERRORS, await freePort());
      const { code, elapsedMs } = await wrapper.ended;

      expect(code).not.toBe(0);
      expect(
        elapsedMs,
        `fail-fast took ${String(elapsedMs)}ms, which is no longer "seconds not minutes"`,
      ).toBeLessThan(FAST_FAILURE_BUDGET_MS);
      const stderr = wrapper.stderr();
      expect(stderr).toContain("portal dev server failed during startup");
      expect(stderr).toContain("Cannot find module '@qcms/ui/fonts'");
    },
    BUDGET_TEST_TIMEOUT_MS,
  );

  it(
    "leaves a healthy slow start alone and shuts down cleanly on SIGTERM",
    async () => {
      // The regression that would be worse than the bug: a server that is merely
      // slow and quiet must not be killed. Nothing ever listens on this port, so
      // the wrapper stays in its pre-readiness window the whole time and still must
      // not act.
      const port = await freePort();
      const wrapper = startWrapper(
        `process.stdout.write("  \\u25b2 Next.js 16.2.11\\n  - Local: http://localhost:${port}\\n");\nsetInterval(() => {}, 1000);\n`,
        port,
      );

      // The banner coming back out of the wrapper is both halves of what this test
      // needs: the wrapper is past its own boot (so SIGTERM will reach the handler,
      // issue #140), and the one thing this stub ever prints has been through the
      // startup watch without arming it. Nothing is left that could act afterwards:
      // before readiness the wrapper only ever moves on a fatal marker in teed output
      // or on the child ending, and this stub does neither. So no settling delay is
      // needed here, and none is what the assertions rest on.
      await waitForTeedOutput(wrapper, "Next.js 16.2.11");
      expect(wrapper.child.exitCode).toBeNull();
      expect(wrapper.stderr()).toBe("");

      wrapper.child.kill("SIGTERM");
      const { code } = await wrapper.ended;
      expect(code).toBe(0);
    },
    SIGTERM_TEST_TIMEOUT_MS,
  );

  it("leaves no surviving descendant behind after a fail-fast exit", async () => {
    // The real tree is pnpm -> next dev -> next-server, and `sh -c` forwards no
    // signals, so killing the direct child reaches at most the first of those.
    // Nothing else will finish the job: Playwright group-SIGKILLs the webServer
    // only while it is still alive, and skips that cleanup once the wrapper has
    // self-exited. A survivor here would hold the port for the next run to latch
    // onto via `reuseExistingServer`.
    //
    // The grandchild is `detached`, so it sits in its own process group: killing a
    // group cannot be what reaps it, only walking the tree can.
    const wrapper = startWrapper(
      `import { spawn } from "node:child_process";\n` +
        `const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {\n` +
        `  detached: true,\n` +
        `  stdio: "ignore",\n` +
        `});\n` +
        `process.stdout.write(\`pids \${process.pid} \${grandchild.pid}\\n\`);\n` +
        `process.stdout.write("Unhandled Rejection: Error: boom\\n");\n` +
        `setInterval(() => {}, 1000);\n`,
      await freePort(),
    );

    const { code } = await wrapper.ended;
    expect(code).not.toBe(0);

    const pids = /pids (\d+) (\d+)/.exec(wrapper.stdout());
    // Guards the test itself: without this the assertions below could pass by
    // never having had a tree to reap.
    expect(pids, `stub never reported its pids; stdout was:\n${wrapper.stdout()}`).not.toBeNull();
    const stubPid = Number(pids?.[1]);
    const grandchildPid = Number(pids?.[2]);
    expect(Number.isInteger(stubPid)).toBe(true);
    expect(Number.isInteger(grandchildPid)).toBe(true);

    expect(await waitUntilGone(stubPid), `stub ${stubPid} survived the fail-fast exit`).toBe(true);
    expect(
      await waitUntilGone(grandchildPid),
      `grandchild ${grandchildPid} survived the fail-fast exit`,
    ).toBe(true);
  }, 30_000);

  it(
    "disarms the startup watch once the server is reachable",
    async () => {
      // The scope limit that keeps this change off the happy path: after readiness
      // the wrapper behaves exactly as it did pre-#58, so a late fault is reported
      // by the server-log gate per test instead of killing the dev server and
      // reddening the whole run.
      //
      // Getting the fatal line to land *after* readiness is what this test needs, and
      // a wall-clock deadline is the wrong way to arrange it (issue #140): under load
      // the wrapper is still booting when one fires. The stub instead reads readiness
      // off the wrapper's own behaviour. The wrapper polls the port every
      // READINESS_POLL_MS until it succeeds and then never knocks again, so each
      // request pushes the fatal line back and a quiet stretch means the probe that
      // mattered has landed. Anchoring on the *last* knock rather than the first is
      // the point: the wrapper abandons a probe that has not answered within
      // READINESS_POLL_MS * 4 and tries again, and under starvation this stub is slow
      // enough to be abandoned several times before one completes.
      //
      // The 3s of quiet is the delay retained on purpose, for two reasons: it is many
      // poll intervals, so it cannot be confused with the gap between two probes, and
      // the wrapper sets `ready` in a microtask *after* the probe response arrives, so
      // a line written in the request handler itself could still be teed while the
      // watch is armed.
      const wrapper = startWrapper(
        `import { createServer } from "node:http";\n` +
          `let lateBoom;\n` +
          `createServer((_req, res) => {\n` +
          `  clearTimeout(lateBoom);\n` +
          `  lateBoom = setTimeout(\n` +
          `    () => process.stdout.write("Unhandled Rejection: Error: late boom\\n"),\n` +
          `    3_000,\n` +
          `  );\n` +
          `  res.end("ok");\n` +
          `}).listen(Number(process.env.PORTAL_PORT));\n` +
          `setInterval(() => {}, 1000);\n`,
        await freePort(),
      );

      // Seeing the late fatal line teed back out means it reached the wrapper's watch
      // post-readiness, which is the property under test, and (as in the test above)
      // that the wrapper is booted enough to have a SIGTERM handler.
      await waitForTeedOutput(wrapper, "late boom");
      // A wrongly armed fail-fast would fire FLUSH_GRACE_MS (300ms) after that tee, so
      // this window exists only to let the failure happen before we assert it did not.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(wrapper.child.exitCode).toBeNull();
      expect(wrapper.stderr()).toBe("");

      wrapper.child.kill("SIGTERM");
      expect((await wrapper.ended).code).toBe(0);
    },
    SIGTERM_TEST_TIMEOUT_MS,
  );
});
