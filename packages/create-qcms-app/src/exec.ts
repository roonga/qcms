/**
 * Running the two external programs the scaffolder needs: a package manager, and git.
 *
 * ## Why every path here is absolute
 *
 * A subprocess launched by bare name is resolved through `PATH`, which the process
 * that invoked us controls. For a tool whose whole job is to write a tree and then
 * run a build inside it, that is a real escalation shape, and `sonarjs/no-os-command-
 * from-path` fails the lint gate on it workspace-wide. So: an explicit override
 * first, then `npm_execpath` (the interpreter that launched us, which is how
 * `pnpm create` invokes this package), then a probe of absolute locations. If none
 * of those finds the binary, the scaffolder says so and stops rather than falling
 * back to a name lookup.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";

import type { PackageManager } from "./options.js";

/** Absolute locations a package manager shim is installed to, in likelihood order. */
const PACKAGE_MANAGER_CANDIDATES = [
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/opt/homebrew/bin",
  "/usr/local/share/npm-global/bin",
];

/** Absolute locations git is installed to. */
const GIT_CANDIDATES = ["/usr/bin/git", "/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

/** A resolved program: the executable, plus any arguments that must lead. */
export interface Program {
  readonly command: string;
  readonly leadingArguments: readonly string[];
}

/**
 * The environment variable that overrides each program's location.
 *
 * Held in one place because {@link ProgramNotFound} tells the operator to set it and
 * the resolvers are what read it. Those were two independently written strings, and
 * they disagreed: the message derived a name from the package manager
 * (`QCMS_PNPM_BIN`), while `resolvePackageManager` read `QCMS_PACKAGE_MANAGER_BIN`,
 * so the remedy the error suggested did nothing. One constant per program, used by
 * both sides, and `exec.test.ts` pins the correspondence.
 */
export const BIN_OVERRIDE_ENV_VAR = {
  packageManager: "QCMS_PACKAGE_MANAGER_BIN",
  git: "QCMS_GIT_BIN",
} as const;

/** Thrown when a required program cannot be found at any absolute location. */
export class ProgramNotFound extends Error {
  constructor(name: string, looked: readonly string[], overrideVariable: string) {
    super(
      `Could not find ${name}. Looked at: ${looked.join(", ")}.\n` +
        `Set ${overrideVariable} to its absolute path, or rerun with --no-install.`,
    );
    this.name = "ProgramNotFound";
  }
}

/**
 * Locate the chosen package manager.
 *
 * `npm_execpath` is preferred when it names the same manager, because that is the
 * exact interpreter and version that launched this process: `pnpm create qcms-app`
 * sets it, and honouring it means the scaffold installs with the pnpm the operator
 * actually runs rather than another copy earlier on `PATH`. It is used only when the
 * basenames agree, since a `pnpm create` invocation that then chooses npm must not
 * silently install with pnpm.
 */
export function resolvePackageManager(
  manager: PackageManager,
  environment: NodeJS.ProcessEnv = process.env,
): Program {
  const override = environment[BIN_OVERRIDE_ENV_VAR.packageManager];
  if (override !== undefined && override !== "") {
    return { command: override, leadingArguments: [] };
  }
  const execPath = environment["npm_execpath"];
  if (execPath !== undefined && execPath !== "" && basename(execPath).startsWith(manager)) {
    // The entry point is a JavaScript file, so it runs under this same Node binary
    // (absolute by definition) rather than through a shell shim.
    return { command: process.execPath, leadingArguments: [execPath] };
  }
  const looked = PACKAGE_MANAGER_CANDIDATES.map((directory) => `${directory}/${manager}`);
  const found = looked.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new ProgramNotFound(manager, looked, BIN_OVERRIDE_ENV_VAR.packageManager);
  }
  return { command: found, leadingArguments: [] };
}

/** Locate git. */
export function resolveGit(environment: NodeJS.ProcessEnv = process.env): Program {
  const override = environment[BIN_OVERRIDE_ENV_VAR.git];
  if (override !== undefined && override !== "") {
    return { command: override, leadingArguments: [] };
  }
  const found = GIT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined)
    throw new ProgramNotFound("git", GIT_CANDIDATES, BIN_OVERRIDE_ENV_VAR.git);
  return { command: found, leadingArguments: [] };
}

/** What a run produced. */
export interface RunResult {
  readonly ok: boolean;
  readonly status: number;
  readonly stderr: string;
}

/**
 * Run a resolved program in `cwd`, inheriting stdio so the operator sees the install.
 *
 * `shell` stays off: arguments are passed as an array and never re-parsed, so a
 * project name that reached a command line could not be interpreted as one.
 */
export function run(
  program: Program,
  args: readonly string[],
  cwd: string,
  capture = false,
): RunResult {
  const result = spawnSync(program.command, [...program.leadingArguments, ...args], {
    cwd,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
    shell: false,
  });
  if (result.error !== undefined) {
    return { ok: false, status: -1, stderr: result.error.message };
  }
  const status = result.status ?? -1;
  return { ok: status === 0, status, stderr: result.stderr ?? "" };
}
