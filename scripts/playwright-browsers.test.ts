import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrowserInstallRunner } from "./playwright-browsers.mjs";
import {
  CHECKED_ENV,
  SKIP_GC_ENV,
  cacheBuilds,
  ensureBrowsers,
  installBrowsers,
  missingBuilds,
  parseArgs,
  pinnedBuilds,
  prune,
} from "./playwright-browsers.mjs";

const created: string[] = [];

function cacheRoot(builds: Record<string, boolean>): string {
  const root = mkdtempSync(join(tmpdir(), "qcms-pw-cache-"));
  created.push(root);
  for (const [name, complete] of Object.entries(builds)) {
    mkdirSync(join(root, name), { recursive: true });
    if (complete) writeFileSync(join(root, name, "INSTALLATION_COMPLETE"), "");
  }
  return root;
}

interface Call {
  command: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
}

function recorder(status: number | null = 0): { calls: Call[]; run: BrowserInstallRunner } {
  const calls: Call[] = [];
  const run: BrowserInstallRunner = (command, args, environment) => {
    calls.push({ command, args, environment });
    return { status };
  };
  return { calls, run };
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const LINUX_CACHE = join(homedir(), ".cache", "ms-playwright");
const MACOS_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");

describe("pinnedBuilds", () => {
  it("reads the cache root and both builds off the executable path", () => {
    expect(pinnedBuilds(join(LINUX_CACHE, "chromium-1254", "chrome-linux64", "chrome"))).toEqual({
      root: LINUX_CACHE,
      builds: ["chromium-1254", "chromium_headless_shell-1254"],
    });
  });

  it("reads a macOS layout, where the binary sits deeper in the build", () => {
    const path = join(MACOS_CACHE, "chromium-1254", "chrome-mac", "Chromium.app", "MacOS", "x");
    expect(pinnedBuilds(path)?.builds).toEqual(["chromium-1254", "chromium_headless_shell-1254"]);
  });

  it("gives no answer for a layout it does not recognise", () => {
    expect(pinnedBuilds("/opt/chrome/chrome")).toBeUndefined();
    expect(pinnedBuilds("/chromium-1254/chrome")).toBeUndefined();
    expect(pinnedBuilds(undefined)).toBeUndefined();
  });
});

describe("missingBuilds", () => {
  it("counts a build present only once it carries the completion marker", () => {
    const root = cacheRoot({ "chromium-1254": true, "chromium_headless_shell-1254": false });
    expect(
      missingBuilds({ root, builds: ["chromium-1254", "chromium_headless_shell-1254"] }),
    ).toEqual(["chromium_headless_shell-1254"]);
  });

  it("reports nothing missing when both builds are complete", () => {
    const root = cacheRoot({ "chromium-1254": true, "chromium_headless_shell-1254": true });
    expect(
      missingBuilds({ root, builds: ["chromium-1254", "chromium_headless_shell-1254"] }),
    ).toEqual([]);
  });
});

describe("installBrowsers", () => {
  it("disables the garbage collection that removes another lane's build", () => {
    const { calls, run } = recorder();
    installBrowsers({ run, environment: { PATH: "/usr/bin" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["exec", "playwright", "install", "chromium"]);
    expect(calls[0]?.environment[SKIP_GC_ENV]).toBe("1");
    expect(calls[0]?.environment["PATH"]).toBe("/usr/bin");
  });

  it("fails loudly on a non-zero install", () => {
    const { run } = recorder(1);
    expect(() => {
      installBrowsers({ run, environment: {} });
    }).toThrow(/exited 1/);
  });
});

describe("ensureBrowsers", () => {
  it("installs when a pinned build is gone from the shared cache", () => {
    const root = cacheRoot({ "chromium-1254": true });
    const { calls, run } = recorder();
    const result = ensureBrowsers({
      executablePath: join(root, "chromium-1254", "chrome-linux64", "chrome"),
      run,
      environment: {},
      out: () => {},
    });
    expect(result).toEqual({
      checked: true,
      installed: true,
      missing: ["chromium_headless_shell-1254"],
    });
    expect(calls[0]?.environment[SKIP_GC_ENV]).toBe("1");
  });

  it("installs nothing when both builds are present", () => {
    const root = cacheRoot({ "chromium-1254": true, "chromium_headless_shell-1254": true });
    const { calls, run } = recorder();
    const result = ensureBrowsers({
      executablePath: join(root, "chromium-1254", "chrome-linux64", "chrome"),
      run,
      environment: {},
      out: () => {},
    });
    expect(result.installed).toBe(false);
    expect(calls).toEqual([]);
  });

  it("installs when the layout cannot be read, rather than guessing it is fine", () => {
    const { calls, run } = recorder();
    const result = ensureBrowsers({
      executablePath: undefined,
      run,
      environment: {},
      out: () => {},
    });
    expect(result.installed).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("checks once per process tree, so workers do not repeat it", () => {
    const environment: NodeJS.ProcessEnv = {};
    const { calls, run } = recorder();
    ensureBrowsers({ executablePath: undefined, run, environment, out: () => {} });
    expect(environment[CHECKED_ENV]).toBe("1");
    const second = ensureBrowsers({ executablePath: undefined, run, environment, out: () => {} });
    expect(second).toEqual({ checked: false, installed: false, missing: [] });
    expect(calls).toHaveLength(1);
  });
});

describe("prune", () => {
  it("lists every build and marks the ones this checkout pins", () => {
    const root = cacheRoot({
      "chromium-1248": true,
      "chromium-1254": true,
      "chromium_headless_shell-1254": true,
    });
    const lines: string[] = [];
    const { calls, run } = recorder();
    const code = prune({
      pinned: { root, builds: ["chromium-1254", "chromium_headless_shell-1254"] },
      apply: false,
      run,
      environment: {},
      out: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(lines.some((line) => /other\s+chromium-1248/.test(line))).toBe(true);
    expect(lines.some((line) => /pinned here\s+chromium-1254/.test(line))).toBe(true);
  });

  it("removes through Playwright's own uninstall only with --apply", () => {
    const root = cacheRoot({ "chromium-1254": true });
    const { calls, run } = recorder();
    const code = prune({
      pinned: { root, builds: ["chromium-1254"] },
      apply: true,
      run,
      environment: {},
      out: () => {},
    });
    expect(code).toBe(0);
    expect(calls[0]?.args).toEqual(["exec", "playwright", "uninstall", "--all"]);
  });

  it("refuses when the cache cannot be located", () => {
    const lines: string[] = [];
    expect(
      prune({ apply: true, run: recorder().run, environment: {}, out: (l) => lines.push(l) }),
    ).toBe(1);
  });
});

describe("cacheBuilds", () => {
  it("is empty for a root that does not exist", () => {
    expect(cacheBuilds(join(tmpdir(), "qcms-pw-cache-absent"))).toEqual([]);
  });

  it("lists builds in path order and leaves Playwright's own bookkeeping out", () => {
    const root = cacheRoot({
      ".links": true,
      "chromium_headless_shell-1248": true,
      "chromium-1248": true,
      "ffmpeg-1013": true,
    });
    expect(cacheBuilds(root)).toEqual([
      "chromium-1248",
      "chromium_headless_shell-1248",
      "ffmpeg-1013",
    ]);
  });
});

describe("parseArgs", () => {
  it("defaults to install", () => {
    expect(parseArgs([])).toEqual({ mode: "install", apply: false });
  });

  it("takes --apply on prune only", () => {
    expect(parseArgs(["prune", "--apply"])).toEqual({ mode: "prune", apply: true });
    expect(() => parseArgs(["install", "--apply"])).toThrow(/prune only/);
  });

  it("rejects an unknown mode or option", () => {
    expect(() => parseArgs(["uninstall"])).toThrow(/unknown mode/);
    expect(() => parseArgs(["prune", "--force"])).toThrow(/unknown option/);
  });
});
