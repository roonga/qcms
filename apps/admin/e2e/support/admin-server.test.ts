import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";

const WRAPPER = fileURLToPath(new URL("admin-server.mjs", import.meta.url));

// Keep the subprocess budget below Playwright's startup ceiling while allowing runner contention.
const FAST_FAILURE_BUDGET_MS = 60_000;
const BUDGET_TEST_TIMEOUT_MS = FAST_FAILURE_BUDGET_MS + 30_000;

const WRAPPER_BOOT_BUDGET_MS = 60_000;
const READINESS_TEST_TIMEOUT_MS = WRAPPER_BOOT_BUDGET_MS + 30_000;

type WrapperProcess = ChildProcessByStdio<null, Readable, Readable>;

interface Wrapper {
  readonly child: WrapperProcess;
  readonly ended: Promise<{ readonly code: number | null; readonly elapsedMs: number }>;
  stderr: () => string;
  stdout: () => string;
}

const tempDirs: string[] = [];
const running: WrapperProcess[] = [];

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

// Use a separate process group so a failed assertion cannot leak a stub into the next test.
function reap(child: WrapperProcess): void {
  const { pid } = child;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group may already have exited.
  }
}

afterEach(() => {
  for (const child of running) reap(child);
  running.length = 0;
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

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
      // Quote both paths because the wrapper invokes a shell and either can contain spaces.
      QCMS_ADMIN_SERVER_COMMAND: `"${process.execPath}" "${stub}"`,
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
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  const ended = new Promise<{ code: number | null; elapsedMs: number }>((resolve) => {
    child.on("close", (code) => resolve({ code, elapsedMs: Date.now() - startedAt }));
  });

  return { child, ended, stderr: () => stderr, stdout: () => stdout };
}

// Teed output proves signal-handler registration has completed; a fixed sleep cannot.
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

// Emit the fatal marker after the first error response to prove that error did not disarm the watch.
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

// Only /healthz is ready before the API exists.
// Rescheduling the late fault on each probe makes it fire only after readiness polling stops.
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
      const wrapper = startWrapper(HEALTHY_THEN_LATE_FAULT, await freePort());

      await waitForTeedOutput(wrapper, "late boom");
      // Leave time for an incorrectly armed fail-fast timer to fire before asserting the process survived.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(wrapper.child.exitCode).toBeNull();
      expect(wrapper.stderr()).toBe("");

      wrapper.child.kill("SIGTERM");
      expect((await wrapper.ended).code).toBe(0);
    },
    READINESS_TEST_TIMEOUT_MS,
  );
});
