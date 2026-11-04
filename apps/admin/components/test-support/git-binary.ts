import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const GIT_BIN_OVERRIDE_ENV_VAR = "QCMS_GIT_BIN";

// Use a plain optional record because Next's ProcessEnv requires NODE_ENV even in minimal test fixtures.
type Environment = Readonly<Record<string, string | undefined>>;

// Use absolute git paths to avoid executing an uncontrolled PATH lookup.
const POSIX_CANDIDATES = [
  "/usr/bin/git",
  "/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];

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

export function gitCandidates(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  return platform === "win32" ? windowsCandidates(environment) : POSIX_CANDIDATES;
}

export function gitBinary(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = environment[GIT_BIN_OVERRIDE_ENV_VAR];
  if (override !== undefined && override !== "") {
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
