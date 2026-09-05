/**
 * The other startup preflight: can the browser this run is about to launch actually
 * start (issue #249)?
 *
 * ## Why a preflight rather than a better error at the failure
 *
 * On a WSL host with the Playwright browsers downloaded but the OS libraries absent,
 * every test in the suite failed identically, before any assertion, six minutes into
 * the run:
 *
 *     Error: browserType.launch: Target page, context or browser has been closed
 *       - [pid=76490] exception while trying to kill process: Error: kill ESRCH
 *
 * That reads as a harness bug or a resource problem. The real message, several frames
 * down in the launch log, is `error while loading shared libraries: libnspr4.so`.
 * Worse, `playwright install` reports nothing wrong and the browsers look present: it
 * was only `chrome-headless-shell` that was short of dependencies, while the full
 * `chrome` binary beside it resolved everything - so every hand check of "are the
 * browsers installed" said yes.
 *
 * `ldd` answers the question in milliseconds and names the missing libraries exactly.
 * Running it before the first launch turns a six-minute confusing red into a one-line
 * diagnosis, which is what the issue asked for.
 *
 * ## What it must not do
 *
 * It must never fail a run that would have worked. Anything unexpected - no `ldd`, a
 * binary that is not there yet, an unreadable browsers directory, a non-Linux host -
 * is silence, not a refusal: a preflight that blocks a working machine is worse than
 * the confusing error it replaces. It is also strictly additive to the seat guard in
 * `port-seat.ts`, which runs first and is unchanged.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { chromium } from "@playwright/test";

/** How a dynamic linker reports a dependency it could not resolve. */
const NOT_FOUND = "=> not found";

/**
 * Where `ldd` is, named rather than looked up on `PATH`.
 *
 * A preflight that resolves its own tool through `PATH` can be pointed at anything a
 * writable directory on that `PATH` contains, and this one runs automatically at
 * config load on every browser run. Both entries are the standard locations; a
 * distribution with neither simply gets no preflight, which is the correct outcome
 * for a check that must never block a working machine.
 */
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

/**
 * The Chromium binaries this suite can launch, given Playwright's full-Chrome path.
 *
 * Both are checked because the two are installed separately and fail separately, and
 * the one that failed was the one nobody looks at: Playwright launches
 * `chrome-headless-shell` for a headless run, while the Lighthouse gate launches the
 * full `chrome` through chrome-launcher (`apps/portal/e2e/a11y-lighthouse.pw.ts`).
 * The headless shell is found by name under the browsers root rather than by
 * rebuilding Playwright's directory scheme, so a revision bump needs no edit here.
 *
 * @param chromePath what `chromium.executablePath()` reports.
 */
export function launchableBinaries(chromePath: string): string[] {
  const found = [chromePath];
  // <browsers root>/chromium-<rev>/chrome-linux64/chrome -> <browsers root>
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

/**
 * The refusal text, kept separate from the check so its wording is testable.
 *
 * It names the cause, the reason the usual evidence looked fine, and both routes out.
 * The container route carries its own caveat because it does not work from a
 * host-created worktree, which is where every agent lane runs: the repository is
 * mounted at a different path inside the container and the container's pnpm refuses
 * to reuse the host `node_modules`, aborting with
 * `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` rather than proceeding. Sending
 * someone there without that sentence costs them the same hour twice.
 */
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

/**
 * The preflight as `playwright.config.ts` calls it: resolve Playwright's Chromium and
 * check it.
 *
 * `executablePath()` throws when the browsers have never been downloaded, and that is
 * emphatically not this preflight's question - Playwright's own "Executable doesn't
 * exist ... run `playwright install`" is already the clearest message anyone could
 * want, and it must not be replaced by a failure to load the config. So the resolution
 * is guarded and an unresolvable browser means no preflight.
 */
export function preflightBrowserLibraries(): void {
  let chromePath;
  try {
    chromePath = chromium.executablePath();
  } catch {
    return;
  }
  assertBrowserLibrariesPresent(chromePath);
}
