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

/** Comfortably under the real 180s webServer timeout, comfortably over the 300ms grace. */
const FAST_FAILURE_BUDGET_MS = 20_000;

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
}

const tempDirs: string[] = [];
const running: WrapperProcess[] = [];

/**
 * Reap a wrapper and everything under it. The wrapper reaches its dev server
 * through `sh -c`, which does not always `exec`, so signalling the wrapper alone
 * can orphan the stub and leave it holding a port. In a real run Playwright owns
 * that cleanup (it launches the wrapper detached and kills the whole group); here
 * the test has to be its own umbrella, so it spawns detached too and kills by
 * negative pid.
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
  // Drained so a chatty stub can never fill the pipe and stall the wrapper.
  child.stdout.resume();

  const ended = new Promise<{ code: number | null; elapsedMs: number }>((resolve) => {
    child.on("close", (code) => resolve({ code, elapsedMs: Date.now() - startedAt }));
  });

  return { child, ended, stderr: () => stderr };
}

/** The #58 shape: a fatal error is reported, but the process keeps running. */
const FATAL_THEN_HANGS = `
process.stdout.write("> qcms-portal@0.0.0 dev\\n> next dev --port 99999\\n");
process.stdout.write("Unhandled Rejection: RangeError: options.port should be >= 0 and < 65536.\\n");
process.stdout.write("  code: 'ERR_SOCKET_BAD_PORT'\\n");
setInterval(() => {}, 1000);
`;

describe("portal-server wrapper startup fail-fast (issue #58)", () => {
  it("fails fast with the log tail when the child reports a fatal error but never exits", async () => {
    const wrapper = startWrapper(FATAL_THEN_HANGS, await freePort());
    const { code, elapsedMs } = await wrapper.ended;

    // Nonzero is what makes Playwright abandon its URL poll instead of waiting
    // out the timeout.
    expect(code).not.toBe(0);
    expect(elapsedMs).toBeLessThan(FAST_FAILURE_BUDGET_MS);

    const stderr = wrapper.stderr();
    expect(stderr).toContain("portal dev server failed during startup");
    expect(stderr).toContain("did not exit");
    // The tail, on stderr: the cause is in the failure output, not just the file.
    expect(stderr).toContain("last 30 lines of");
    expect(stderr).toContain("ERR_SOCKET_BAD_PORT");
    expect(stderr).toContain("RangeError: options.port should be >= 0 and < 65536.");
  }, 30_000);

  it("propagates a nonzero child exit code and quotes the log tail", async () => {
    const wrapper = startWrapper(
      `process.stderr.write("Error: Cannot find module 'next'\\n");\nprocess.exit(7);\n`,
      await freePort(),
    );
    const { code, elapsedMs } = await wrapper.ended;

    expect(code).toBe(7);
    expect(elapsedMs).toBeLessThan(FAST_FAILURE_BUDGET_MS);
    expect(wrapper.stderr()).toContain("exited with code 7");
    expect(wrapper.stderr()).toContain("Cannot find module 'next'");
  }, 30_000);

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

  it("leaves a healthy slow start alone and shuts down cleanly on SIGTERM", async () => {
    // The regression that would be worse than the bug: a server that is merely
    // slow and quiet must not be killed. Nothing ever listens on this port, so
    // the wrapper stays in its pre-readiness window the whole time and still must
    // not act.
    const port = await freePort();
    const wrapper = startWrapper(
      `process.stdout.write("  \\u25b2 Next.js 16.2.11\\n  - Local: http://localhost:${port}\\n");\nsetInterval(() => {}, 1000);\n`,
      port,
    );

    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(wrapper.child.exitCode).toBeNull();
    expect(wrapper.stderr()).toBe("");

    wrapper.child.kill("SIGTERM");
    const { code } = await wrapper.ended;
    expect(code).toBe(0);
  }, 30_000);

  it("disarms the startup watch once the server is reachable", async () => {
    // The scope limit that keeps this change off the happy path: after readiness
    // the wrapper behaves exactly as it did pre-#58, so a late fault is reported
    // by the server-log gate per test instead of killing the dev server and
    // reddening the whole run.
    const wrapper = startWrapper(
      `import { createServer } from "node:http";\n` +
        `createServer((_req, res) => res.end("ok")).listen(Number(process.env.PORTAL_PORT));\n` +
        `setTimeout(() => process.stdout.write("Unhandled Rejection: Error: late boom\\n"), 2_000);\n` +
        `setInterval(() => {}, 1000);\n`,
      await freePort(),
    );

    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect(wrapper.child.exitCode).toBeNull();
    expect(wrapper.stderr()).toBe("");

    wrapper.child.kill("SIGTERM");
    expect((await wrapper.ended).code).toBe(0);
  }, 30_000);
});
