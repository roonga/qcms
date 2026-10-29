import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";

const WRAPPER = fileURLToPath(new URL("portal-server.mjs", import.meta.url));

const FAST_FAILURE_BUDGET_MS = 60_000;

const BUDGET_TEST_TIMEOUT_MS = FAST_FAILURE_BUDGET_MS + 30_000;

const WRAPPER_BOOT_BUDGET_MS = 60_000;

const SIGTERM_TEST_TIMEOUT_MS = WRAPPER_BOOT_BUDGET_MS + 30_000;

const DESCENDANT_EXIT_BUDGET_MS = 10_000;

const DESCENDANT_TEST_TIMEOUT_MS = WRAPPER_BOOT_BUDGET_MS + DESCENDANT_EXIT_BUDGET_MS * 2;

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

function reap(child: WrapperProcess): void {
  const { pid } = child;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone, which is the outcome this wanted.
  }
}

afterEach(() => {
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
      // Quoted: the wrapper runs this through a shell, and on Windows both halves can
      // hold a path with a space.
      QCMS_PORTAL_SERVER_COMMAND: `"${process.execPath}" "${stub}"`,
      QCMS_PORTAL_SERVER_LOG: join(dir, "portal.log"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  running.push(child);

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
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
async function waitUntilGone(pid: number, timeoutMs = DESCENDANT_EXIT_BUDGET_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isAlive(pid);
}

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
      "Unhandled Rejection: Error: Cannot find module '@roonga/qcms-ui/fonts'\\n",
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

      expect(code).not.toBe(0);
      expect(
        elapsedMs,
        `fail-fast took ${String(elapsedMs)}ms, which is no longer "seconds not minutes"`,
      ).toBeLessThan(FAST_FAILURE_BUDGET_MS);

      const stderr = wrapper.stderr();
      expect(stderr).toContain("portal dev server failed during startup");
      expect(stderr).toContain("did not exit");
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
    expect(stderr).not.toContain("line-01");
  }, 30_000);

  it(
    "does not call a server that answers 500 to everything ready (issue #381)",
    async () => {
      const wrapper = startWrapper(SERVES_ONLY_ERRORS, await freePort());
      const { code, elapsedMs } = await wrapper.ended;

      expect(code).not.toBe(0);
      expect(
        elapsedMs,
        `fail-fast took ${String(elapsedMs)}ms, which is no longer "seconds not minutes"`,
      ).toBeLessThan(FAST_FAILURE_BUDGET_MS);
      const stderr = wrapper.stderr();
      expect(stderr).toContain("portal dev server failed during startup");
      expect(stderr).toContain("Cannot find module '@roonga/qcms-ui/fonts'");
    },
    BUDGET_TEST_TIMEOUT_MS,
  );

  it(
    "leaves a healthy slow start alone and shuts down cleanly on SIGTERM",
    async () => {
      const port = await freePort();
      const wrapper = startWrapper(
        `process.stdout.write("  \\u25b2 Next.js 16.2.11\\n  - Local: http://localhost:${port}\\n");\nsetInterval(() => {}, 1000);\n`,
        port,
      );

      await waitForTeedOutput(wrapper, "Next.js 16.2.11");
      expect(wrapper.child.exitCode).toBeNull();
      expect(wrapper.stderr()).toBe("");

      wrapper.child.kill("SIGTERM");
      const { code } = await wrapper.ended;
      expect(code).toBe(0);
    },
    SIGTERM_TEST_TIMEOUT_MS,
  );

  it(
    "leaves no surviving descendant behind after a fail-fast exit",
    async () => {
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
      expect(pids, `stub never reported its pids; stdout was:\n${wrapper.stdout()}`).not.toBeNull();
      const stubPid = Number(pids?.[1]);
      const grandchildPid = Number(pids?.[2]);
      expect(Number.isInteger(stubPid)).toBe(true);
      expect(Number.isInteger(grandchildPid)).toBe(true);

      expect(await waitUntilGone(stubPid), `stub ${stubPid} survived the fail-fast exit`).toBe(
        true,
      );
      expect(
        await waitUntilGone(grandchildPid),
        `grandchild ${grandchildPid} survived the fail-fast exit`,
      ).toBe(true);
    },
    DESCENDANT_TEST_TIMEOUT_MS,
  );

  it(
    "disarms the startup watch once the server is reachable",
    async () => {
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

      await waitForTeedOutput(wrapper, "late boom");
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(wrapper.child.exitCode).toBeNull();
      expect(wrapper.stderr()).toBe("");

      wrapper.child.kill("SIGTERM");
      expect((await wrapper.ended).code).toBe(0);
    },
    SIGTERM_TEST_TIMEOUT_MS,
  );
});
