import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * Where the tests that ask git for the admin's source list find git (issue #1126).
 *
 * Two admin checks list sources with `git ls-files` rather than walking the tree
 * (`app/(shell)/table-cell-rules.test.ts` and `app/(shell)/table-anchors.test.tsx`, both
 * for issue #629). They each carried their own POSIX-only candidate list, which is a
 * stable red on a native Windows checkout and two places to fix it. One module, shared.
 *
 * The override's name and its two rules match
 * `packages/create-qcms-app/scripts/sync-templates.mjs`, so the one variable a developer
 * sets works for every git-using check in the repository.
 */
export const GIT_BIN_OVERRIDE_ENV_VAR = "QCMS_GIT_BIN";

/**
 * Absolute candidates, never a bare `git`: a bare name is a `PATH` lookup, which is what
 * `sonarjs/no-os-command-from-path` forbids workspace-wide.
 */
const POSIX_CANDIDATES = [
  "/usr/bin/git",
  "/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];

/**
 * The Windows install locations, built from the environment rather than written out: a
 * drive-letter literal here would be a machine-specific path, which `check:paths` forbids
 * in committed text and which is wrong on a machine that installed elsewhere anyway.
 */
function windowsCandidates(environment: NodeJS.ProcessEnv): string[] {
  const systemWide = [environment.ProgramFiles, environment["ProgramFiles(x86)"]]
    .filter((root): root is string => root !== undefined && root !== "")
    .map((root) => join(root, "Git", "cmd", "git.exe"));
  const perUser =
    environment.LOCALAPPDATA === undefined || environment.LOCALAPPDATA === ""
      ? []
      : [join(environment.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe")];
  return [...systemWide, ...perUser];
}

/** Everything that would be probed, in order, on this platform. */
export function gitCandidates(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  return platform === "win32" ? windowsCandidates(environment) : POSIX_CANDIDATES;
}

/** The absolute path of git, or a named failure listing what was tried. */
export function gitBinary(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = environment[GIT_BIN_OVERRIDE_ENV_VAR];
  if (override !== undefined && override !== "") {
    // A relative override would be a PATH lookup, which is the thing being avoided (#458).
    if (!isAbsolute(override)) {
      throw new Error(
        `${GIT_BIN_OVERRIDE_ENV_VAR}=${override} is not an absolute path, so it would be ` +
          `resolved through PATH. Set it to the absolute path of the executable, or unset it.`,
      );
    }
    if (!existsSync(override)) {
      throw new Error(
        `${GIT_BIN_OVERRIDE_ENV_VAR}=${override} does not exist. Set it to the absolute path ` +
          `of the executable, or unset it.`,
      );
    }
    return override;
  }
  const candidates = gitCandidates(environment, platform);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      `no git binary at any of: ${candidates.join(", ")}. ` +
        `Set ${GIT_BIN_OVERRIDE_ENV_VAR} to its absolute path.`,
    );
  }
  return found;
}
