import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** Overrides the probe below with an absolute path, as `sync-templates.mjs` also reads. */
export const GIT_BIN_OVERRIDE_ENV_VAR = "QCMS_GIT_BIN";

// Not `NodeJS.ProcessEnv`: Next's types make `NODE_ENV` required on it, so a fixture
// naming two variables would not be assignable.
type Environment = Readonly<Record<string, string | undefined>>;

// Absolute, never a bare `git`: `sonarjs/no-os-command-from-path` forbids a PATH lookup.
const POSIX_CANDIDATES = [
  "/usr/bin/git",
  "/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];

// Built from the environment because a drive-letter literal is a machine-specific path,
// which `check:paths` forbids in committed text.
function windowsCandidates(environment: Environment): string[] {
  const systemWide = [environment.ProgramFiles, environment["ProgramFiles(x86)"]]
    .filter((root): root is string => root !== undefined && root !== "")
    .map((root) => join(root, "Git", "cmd", "git.exe"));
  const perUser =
    environment.LOCALAPPDATA === undefined || environment.LOCALAPPDATA === ""
      ? []
      : [join(environment.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe")];
  return [...systemWide, ...perUser];
}

/** Every location that would be probed, in order, on this platform. */
export function gitCandidates(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  return platform === "win32" ? windowsCandidates(environment) : POSIX_CANDIDATES;
}

/** The absolute path of git, or a named failure listing what was tried. */
export function gitBinary(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = environment[GIT_BIN_OVERRIDE_ENV_VAR];
  if (override !== undefined && override !== "") {
    // A relative override would be the PATH lookup this module exists to avoid.
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
