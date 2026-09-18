import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  DEFAULT_LOCK_DIR,
  buildWaitingForLock,
  isBuildLockContention,
  lockHolders,
  parseArgs,
  parseLockHolderPids,
  positiveNumber,
  resolveCommand,
  stripAnsi,
} from "./next-build.mjs";

/**
 * Tests for the Next build-lock wait (issue #925).
 *
 * The property that matters is a two-sided one, so both sides are pinned: the lock
 * signature is waited out, and every other failure is returned on the first attempt.
 * A wrapper that retried a genuinely broken build would turn a red into a ten-minute
 * red, which is worse than the failure it was added for.
 *
 * The lock itself is not simulated here. Holding a real one needs Next's native
 * bindings, and what this suite can assert instead is the reading of `/proc/locks`
 * (against captured text) and the shape of the wait (against an injected clock). The
 * live collision was reproduced by hand at the pinned Next, and the reproduction is
 * on the pull request rather than in a suite that would cost two real builds.
 */

const SCRIPT = fileURLToPath(new URL("next-build.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The message Next prints, exactly as `packages/next/src/build/lockfile.ts` writes it. */
const CONTENTION_OUTPUT = [
  " Next.js 16.3.5 (Turbopack)",
  " Running next.config.ts took 45ms",
  " Another next build process is already running.",
  "",
  "  This could be:",
  "  - A next build still in progress",
  "  - A previous build that didn't exit cleanly",
  "",
  "  Suggestion: Wait for the build to complete.",
].join("\n");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "next-build-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A fake attempt sequence, so the wait can be driven without a build. */
function fakeRun(codes: readonly number[], output: string) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: async () => {
      const code = codes[Math.min(calls, codes.length - 1)] ?? 0;
      calls += 1;
      return { code, output: code === 0 ? "ready in 4s" : output };
    },
  };
}

/** Runs the wait with an injected clock, so a ten-minute bound costs no time. */
async function runWait(
  run: () => Promise<{ code: number; output: string }>,
  options: { waitMs?: number; pollMs?: number; holders?: string[] } = {},
) {
  const lines: string[] = [];
  let clock = 0;
  const code = await buildWaitingForLock({
    run,
    holders: () => options.holders ?? [],
    log: (line) => lines.push(line),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    waitMs: options.waitMs ?? 600_000,
    pollMs: options.pollMs ?? 5_000,
  });
  return { code, lines, elapsedMs: clock };
}

describe("telling the lock apart from a broken build", () => {
  it("recognises the message Next prints", () => {
    expect(isBuildLockContention(CONTENTION_OUTPUT)).toBe(true);
  });

  it("recognises it through the colouring turbo's FORCE_COLOR adds", () => {
    // turbo gives its tasks a TTY-coloured pipe, so the sentence arrives with escape
    // sequences INSIDE it, around the `next build` that picocolors dyes cyan. A
    // matcher written against the plain text alone reads a coloured run as a real
    // failure, which is the one case this whole script exists for.
    const esc = String.fromCharCode(0x1b);
    const coloured = `Another ${esc}[36mnext build${esc}[39m process is already running.`;
    expect(stripAnsi(coloured)).toBe("Another next build process is already running.");
    expect(isBuildLockContention(coloured)).toBe(true);
  });

  it("does not recognise an ordinary build failure", () => {
    const failure = [
      "Failed to compile.",
      "./app/page.tsx:3:9",
      "Type error: Property 'slug' does not exist.",
    ].join("\n");
    expect(isBuildLockContention(failure)).toBe(false);
  });
});

describe("waiting", () => {
  it("retries while the lock is held and reports how long it waited", async () => {
    const attempts = fakeRun([1, 1, 0], CONTENTION_OUTPUT);
    const result = await runWait(attempts.run, { pollMs: 5_000 });

    expect(result.code).toBe(0);
    expect(attempts.calls).toBe(3);
    expect(result.lines.at(-1)).toContain("waited 10 s for another next build in this checkout");
  });

  it("says nothing at all when the first attempt succeeds", async () => {
    // The wrapper is on the build path of both Next apps, so silence in the ordinary
    // case is a requirement rather than a nicety: a line per build would be read as a
    // wait that did not happen.
    const attempts = fakeRun([0], CONTENTION_OUTPUT);
    const result = await runWait(attempts.run);

    expect(result.code).toBe(0);
    expect(attempts.calls).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it("names the process holding the lock, so the wait is attributed", async () => {
    const attempts = fakeRun([1, 0], CONTENTION_OUTPUT);
    const result = await runWait(attempts.run, {
      holders: ["pid 1058382  cwd /checkout/apps/portal  next-build (v16.3.5)"],
    });

    expect(result.lines[0]).toContain("holds the build lock; waiting");
    expect(result.lines[1]).toContain("pid 1058382");
    expect(result.lines[1]).toContain("/checkout/apps/portal");
  });

  it("gives up at the bound, and says the failure is contention", async () => {
    const attempts = fakeRun([1], CONTENTION_OUTPUT);
    const result = await runWait(attempts.run, { waitMs: 30_000, pollMs: 5_000 });

    expect(result.code).toBe(1);
    expect(result.elapsedMs).toBe(30_000);
    const gaveUp = result.lines.at(-1) ?? "";
    expect(gaveUp).toContain("gave up after 30 s");
    expect(gaveUp).toContain("THIS checkout");
    expect(gaveUp).toContain("never a sibling worktree");
  });

  it("returns a real build failure on the first attempt", async () => {
    const attempts = fakeRun([1], "Failed to compile.\nType error: nope");
    const result = await runWait(attempts.run);

    expect(result.code).toBe(1);
    expect(attempts.calls).toBe(1);
    expect(result.lines).toEqual([]);
  });
});

describe("reading who holds the lock", () => {
  // Captured from this host while a process held a Next lock, with the unrelated rows
  // kept: the parse has to pick one inode out of a file that lists every lock open on
  // the machine.
  const PROC_LOCKS = [
    "1: FLOCK  ADVISORY  WRITE 1014430 08:50:739629 0 EOF",
    "2: POSIX  ADVISORY  WRITE 169340 00:85:425434 1073741824 1073742335",
    "42: FLOCK  ADVISORY  WRITE 1015609 00:85:3053324 0 EOF",
    "43: -> FLOCK  ADVISORY  WRITE 1015999 00:85:3053324 0 EOF",
    "60: FLOCK  ADVISORY  WRITE 247 08:50:49261 0 EOF",
    "",
  ].join("\n");

  it("picks the holder of one inode out of the whole machine's locks", () => {
    expect(parseLockHolderPids(PROC_LOCKS, 3_053_324)).toEqual([1_015_609]);
  });

  it("ignores a process that is blocked WAITING for the same lock", () => {
    // The `->` row is the other next build queueing behind the holder. Naming it as a
    // holder would point a reader at the victim rather than at the cause.
    expect(parseLockHolderPids(PROC_LOCKS, 3_053_324)).not.toContain(1_015_999);
  });

  it("returns nothing for an inode nothing holds", () => {
    expect(parseLockHolderPids(PROC_LOCKS, 999)).toEqual([]);
  });

  it("describes the holder with its pid, working directory and command", () => {
    const lines = lockHolders("/checkout/apps/portal/.next/lock", {
      inodeOf: () => 3_053_324,
      readText: (path) =>
        path === "/proc/locks"
          ? PROC_LOCKS
          : ["next-build", "(v16.3.5)"].join(String.fromCharCode(0)),
      readDir: () => ["0", "1", "17"],
      readLink: (path) =>
        path.endsWith("/fd/17")
          ? "/checkout/apps/portal/.next/lock"
          : path.endsWith("/cwd")
            ? "/checkout/apps/portal"
            : "/dev/null",
    });

    expect(lines).toEqual(["pid 1015609  cwd /checkout/apps/portal  next-build (v16.3.5)"]);
  });

  it("stays silent when the pid holds no descriptor on the lock file", () => {
    // An inode number can repeat across devices, so the `/proc/locks` match is only a
    // candidate. This text is read as an accusation; an unconfirmed pid is worse than
    // no pid.
    const lines = lockHolders("/checkout/apps/portal/.next/lock", {
      inodeOf: () => 3_053_324,
      readText: () => PROC_LOCKS,
      readDir: () => ["0", "1"],
      readLink: () => "/some/other/file",
    });

    expect(lines).toEqual([]);
  });

  it("stays silent rather than throwing when /proc cannot be read", () => {
    const lines = lockHolders("/checkout/apps/portal/.next/lock", {
      inodeOf: () => {
        throw new Error("ENOENT");
      },
      readText: () => "",
      readDir: () => [],
      readLink: () => "",
    });

    expect(lines).toEqual([]);
  });
});

describe("arguments and resolution", () => {
  it("takes the command to run, with the default lock directory", () => {
    expect(parseArgs(["next", "build"])).toEqual({
      ok: true,
      lockDir: DEFAULT_LOCK_DIR,
      command: "next",
      commandArgs: ["build"],
    });
  });

  it("takes an explicit lock directory", () => {
    expect(parseArgs(["--lock-dir", ".next-other", "next", "build"])).toMatchObject({
      ok: true,
      lockDir: ".next-other",
      command: "next",
    });
  });

  it("refuses an invocation with no command", () => {
    expect(parseArgs([])).toEqual({ ok: false, reason: "no build command given" });
    expect(parseArgs(["--lock-dir"])).toEqual({
      ok: false,
      reason: "--lock-dir needs a directory",
    });
  });

  it("prefers the calling package's own bin over PATH", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    const local = join(dir, "node_modules", ".bin", "next");
    writeFileSync(local, "", "utf8");

    expect(resolveCommand("next", dir)).toBe(local);
    expect(resolveCommand("next", tempDir())).toBe("next");
    expect(resolveCommand("./tool", dir)).toBe("./tool");
  });

  it("falls back to the default for an unusable env bound", () => {
    expect(positiveNumber(undefined, 600_000)).toBe(600_000);
    expect(positiveNumber("nonsense", 600_000)).toBe(600_000);
    expect(positiveNumber("-1", 600_000)).toBe(600_000);
    expect(positiveNumber("0", 600_000)).toBe(0);
    expect(positiveNumber("1500", 600_000)).toBe(1500);
  });
});

describe("the wiring the wait depends on", () => {
  it("is on the build script of every Next app", () => {
    // Derived rather than listed: a third Next app that did not go through the wrapper
    // would reintroduce the failure silently, and the scaffolding generator's
    // APP_SCRIPT_FRAGMENTS entry would then describe a transform that never fires.
    for (const app of ["portal", "admin"]) {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, "apps", app, "package.json"), "utf8"),
      ) as { scripts: Record<string, string> };
      expect(manifest.scripts.build).toBe("node ../../scripts/next-build.mjs next build");
    }
  });

  it("looks for the lock where the apps actually put their production build", () => {
    // The holder diagnostic reads `<lockDir>/lock`. If an app moved its production
    // distDir, the wait would still work (an attempt is the poll) but it would stop
    // being able to say who is holding the lock, silently.
    for (const app of ["portal", "admin"]) {
      const config = readFileSync(join(REPO_ROOT, "apps", app, "next.config.ts"), "utf8");
      expect(config).toContain(`const PRODUCTION_DIST_DIR = "${DEFAULT_LOCK_DIR}";`);
    }
  });
});

describe("end to end", () => {
  it("waits out a command that reports the lock, then succeeds", () => {
    // The whole script, over a stand-in build that fails with Next's message until a
    // marker file appears. It proves the parts the unit tests inject: argv handling,
    // the tee, the exit code, and the env bounds.
    const dir = tempDir();
    const marker = join(dir, "other-build-finished");
    const stub = join(dir, "stub-build.mjs");
    writeFileSync(
      stub,
      [
        'import { existsSync, writeFileSync } from "node:fs";',
        `const marker = ${JSON.stringify(marker)};`,
        "if (existsSync(marker)) {",
        '  console.log("Compiled successfully");',
        "  process.exit(0);",
        "}",
        'writeFileSync(marker, "");',
        `console.error(${JSON.stringify(CONTENTION_OUTPUT)});`,
        "process.exit(1);",
      ].join("\n"),
      "utf8",
    );

    const output = execFileSync(process.execPath, [SCRIPT, process.execPath, stub], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, QCMS_NEXT_BUILD_WAIT_MS: "20000", QCMS_NEXT_BUILD_POLL_MS: "10" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(output).toContain("Compiled successfully");
  });

  it("leaves an ordinary failure failing, with its exit code", () => {
    const dir = tempDir();
    const stub = join(dir, "stub-build.mjs");
    writeFileSync(stub, 'console.error("Failed to compile.");\nprocess.exit(3);\n', "utf8");

    let status: number | undefined;
    try {
      execFileSync(process.execPath, [SCRIPT, process.execPath, stub], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, QCMS_NEXT_BUILD_WAIT_MS: "20000", QCMS_NEXT_BUILD_POLL_MS: "10" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      status = (error as { status?: number }).status;
    }

    expect(status).toBe(3);
  });
});
