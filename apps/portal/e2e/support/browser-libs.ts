import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { chromium } from "@playwright/test";

/** How a dynamic linker reports a dependency it could not resolve. */
const NOT_FOUND = "=> not found";

const LDD_PATHS = ["/usr/bin/ldd", "/bin/ldd"];

/**
 * Shared libraries `binary` needs and the loader cannot find.
 *
 * Empty for anything this cannot answer honestly (no `ldd`, no binary, a static or
 * non-ELF file), because "could not check" and "nothing missing" must both end in the
 * run proceeding. Only a positive, parsed list of names is ever acted on.
 */
export function missingSharedLibraries(binary: string): string[] {
  if (!existsSync(binary)) return [];
  const ldd = LDD_PATHS.find((candidate) => existsSync(candidate));
  if (ldd === undefined) return [];
  const result = spawnSync(ldd, [binary], { encoding: "utf8", timeout: 20_000 });
  if (result.error !== undefined || typeof result.stdout !== "string") return [];
  return parseMissingLibraries(result.stdout);
}

/**
 * The library names in `ldd` output that resolved to nothing.
 *
 * Exported so the parse is testable without a broken machine, which is the only way
 * this code path can be exercised on a host where the gate already works.
 *
 * @param lddOutput raw stdout from `ldd <binary>`.
 */
export function parseMissingLibraries(lddOutput: string): string[] {
  const missing: string[] = [];
  for (const line of lddOutput.split("\n")) {
    if (!line.includes(NOT_FOUND)) continue;
    const name = line.slice(0, line.indexOf(NOT_FOUND)).trim();
    if (name !== "") missing.push(name);
  }
  return missing;
}

export function launchableBinaries(chromePath: string): string[] {
  const found = [chromePath];
  const browsersRoot = dirname(dirname(dirname(chromePath)));
  let entries: string[];
  try {
    entries = readdirSync(browsersRoot);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.startsWith("chromium_headless_shell-")) continue;
    let inner: string[];
    try {
      inner = readdirSync(join(browsersRoot, entry));
    } catch {
      continue;
    }
    for (const dir of inner) {
      const candidate = join(browsersRoot, entry, dir, "chrome-headless-shell");
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  return found;
}

/** One binary and what it is missing, in the order the refusal prints them. */
export interface BrowserLibraryGap {
  readonly binary: string;
  readonly missing: readonly string[];
}

export function describeLibraryGaps(gaps: readonly BrowserLibraryGap[]): string {
  return [
    "Playwright's browsers are installed, but the OS libraries they need are not.",
    "",
    ...gaps.map((gap) => `  ${gap.binary}\n    missing: ${gap.missing.join(", ")}`),
    "",
    "Without these the browser exits during launch and every test in the suite fails",
    'with "Target page, context or browser has been closed", which reads as a harness',
    "bug rather than a missing package. `playwright install` reports nothing wrong,",
    "because the binaries ARE downloaded - only their dependencies are absent, and",
    "often only for chrome-headless-shell while the full chrome beside it resolves.",
    "",
    "Fix it one of these ways:",
    "",
    "  1. Install the libraries on this host, once (needs sudo):",
    "       sudo pnpm exec playwright install-deps chromium",
    "",
    "  2. Run the gate in the dev container or leave it to CI, both of which run",
    "     `playwright install --with-deps chromium` already. Note this does NOT work",
    "     from a host-created worktree: the repository mounts at a different path",
    "     inside the container and its pnpm refuses to reuse the host node_modules",
    "     (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY), so it would purge the install",
    "     the other gates depend on.",
    "",
    "docs/DEVELOPER_GUIDE.md records both routes next to the gate itself.",
  ].join("\n");
}

/**
 * Refuse the run when a browser it will launch cannot resolve its libraries.
 *
 * @param chromePath what `chromium.executablePath()` reports.
 * @param platform `process.platform`; injectable, and the check is Linux-only because
 *   `ldd` is.
 */
export function assertBrowserLibrariesPresent(
  chromePath: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "linux") return;
  const gaps: BrowserLibraryGap[] = [];
  for (const binary of launchableBinaries(chromePath)) {
    const missing = missingSharedLibraries(binary);
    if (missing.length > 0) gaps.push({ binary, missing });
  }
  if (gaps.length === 0) return;
  throw new Error(describeLibraryGaps(gaps));
}

export function preflightBrowserLibraries(): void {
  let chromePath;
  try {
    chromePath = chromium.executablePath();
  } catch {
    return;
  }
  assertBrowserLibrariesPresent(chromePath);
}
