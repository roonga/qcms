import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  resolveSpawn,
  stripAnsi,
} from "./next-build.mjs";
import { trackedFilesUnder } from "./tracked-files.mjs";

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

interface NextApp {
  /** Repository-relative directory, e.g. `apps/portal`. */
  directory: string;
  manifest: { dependencies?: Record<string, string>; scripts?: Record<string, string> };
}

/**
 * Asked of `git ls-files` rather than a walk of `apps/`, which also finds `.next` and
 * `.next-dev` output and would assert a property of this machine.
 */
function nextApps(): NextApp[] {
  const manifests = trackedFilesUnder(REPO_ROOT, {
    match: /^apps\/[^/]+\/package\.json$/,
  });
  return manifests
    .map((path) => {
      const parsed: unknown = JSON.parse(readFileSync(join(REPO_ROOT, path), "utf8"));
      return { directory: dirname(path), manifest: parsed as NextApp["manifest"] };
    })
    .filter((app) => app.manifest.dependencies?.next !== undefined);
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "next-build-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

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
  // Real `/proc/locks` text: the unrelated rows are kept because the parse has to pick
  // one inode out of every lock open on the machine.
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
    // A `->` row is a process queueing behind the holder, so naming it would point at
    // the victim rather than the cause.
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
    // candidate and an unconfirmed pid is worse than no pid.
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

  it("spawns the POSIX script directly and the Windows shim through a shell", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    const script = join(dir, "node_modules", ".bin", "next");
    const shim = join(dir, "node_modules", ".bin", "next.CMD");
    writeFileSync(script, "", "utf8");
    writeFileSync(shim, "", "utf8");

    expect(resolveSpawn("next", ["build"], dir, "linux")).toEqual({
      command: script,
      args: ["build"],
      shell: false,
    });
    expect(resolveSpawn("next", ["build"], dir, "win32")).toEqual({
      command: `"${shim}" "build"`,
      args: [],
      shell: true,
    });
  });

  it("falls back to a PATH lookup on Windows when no shim is installed", () => {
    expect(resolveSpawn("next", ["build"], tempDir(), "win32")).toEqual({
      command: `"next" "build"`,
      args: [],
      shell: true,
    });
  });

  it("spawns a Windows command that already names an executable path directly", () => {
    // No shell where none is needed: a shell would report a missing command as its own
    // exit 1 and take the wrapper's 127 with it.
    const dir = tempDir();
    expect(resolveSpawn(join(dir, "tool.exe"), ["build"], dir, "win32")).toEqual({
      command: join(dir, "tool.exe"),
      args: ["build"],
      shell: false,
    });
    expect(resolveSpawn(join(dir, "tool.CMD"), ["build"], dir, "win32")).toEqual({
      command: `"${join(dir, "tool.CMD")}" "build"`,
      args: [],
      shell: true,
    });
  });

  it("keeps a usable bound, and falls back to the default for an unusable one", () => {
    expect(positiveNumber(undefined, 600_000)).toBe(600_000);
    expect(positiveNumber("nonsense", 600_000)).toBe(600_000);
    expect(positiveNumber("-1", 600_000)).toBe(600_000);
    expect(positiveNumber("1500", 600_000)).toBe(1500);
    // `0` is usable and means do not wait at all, so it must survive the guard.
    expect(positiveNumber("0", 600_000)).toBe(0);
  });
});

describe("the wiring the wait depends on", () => {
  it("is on the build script of every Next app", () => {
    for (const app of nextApps()) {
      expect(app.manifest.scripts?.build).toBe("node ../../scripts/next-build.mjs next build");
    }
  });

  it("looks for the lock where the apps actually put their production build", () => {
    for (const app of nextApps()) {
      const config = readFileSync(join(REPO_ROOT, app.directory, "next.config.ts"), "utf8");
      expect(config).toContain(`const PRODUCTION_DIST_DIR = "${DEFAULT_LOCK_DIR}";`);
    }
  });

  it("derives that set from git, and the derivation reaches something", () => {
    // A filter that matched nothing would leave the two assertions above vacuously true.
    const apps = nextApps();
    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) expect(app.directory.startsWith("apps/")).toBe(true);
  });
});

describe("end to end", () => {
  it("waits out a command that reports the lock, then succeeds", () => {
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

  it("says so cleanly when the build command cannot be started", () => {
    const dir = tempDir();
    let status: number | undefined;
    let stderrText = "";
    try {
      execFileSync(process.execPath, [SCRIPT, join(dir, "no-such-build")], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      status = failure.status;
      stderrText = failure.stderr ?? "";
    }

    expect(status).toBe(127);
    expect(stderrText).toContain("next-build: could not start");
    expect(stderrText).not.toContain("UnhandledPromiseRejection");
  });

  it("forwards a stop signal to the build instead of orphaning it", async () => {
    // Only a process this test started is signalled: `spawn` gives back the pid, and
    // that pid is the only one touched.
    const dir = tempDir();
    const received = join(dir, "received-signal");
    const started = join(dir, "child-started");
    const stub = join(dir, "stub-build.mjs");
    writeFileSync(
      stub,
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(started)}, String(process.pid));`,
        'for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {',
        "  process.on(signal, () => {",
        `    writeFileSync(${JSON.stringify(received)}, signal);`,
        "    process.exit(0);",
        "  });",
        "}",
        "setTimeout(() => process.exit(0), 20_000);",
      ].join("\n"),
      "utf8",
    );

    const wrapper = spawn(process.execPath, [SCRIPT, process.execPath, stub], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
      wrapper.on("close", (code, signal) => done({ code, signal }));
    });

    const deadline = Date.now() + 10_000;
    while (!existsSync(started) && Date.now() < deadline) {
      await new Promise((tick) => setTimeout(tick, 20));
    }
    expect(existsSync(started)).toBe(true);

    wrapper.kill("SIGTERM");
    const result = await exited;

    expect(readFileSync(received, "utf8")).toBe("SIGTERM");
    // 143 is 128 + SIGTERM, the conventional shell code.
    expect(result.code).toBe(143);
  }, 30_000);
});
