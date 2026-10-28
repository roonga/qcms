/**
 * Nothing here is resolved through `PATH`: override, then `npm_execpath`, then absolute
 * probes (`sonarjs/no-os-command-from-path`).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, isAbsolute } from "node:path";

import { PACKAGE_MANAGER } from "./options.js";

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

/** One constant per program, shared by the resolvers and the `ProgramNotFound` remedy. */
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

/** Thrown when an override is set to something this module refuses to run. */
export class InvalidBinOverride extends Error {
  constructor(variable: string, value: string, why: string) {
    super(
      `${variable}=${value} ${why}\nSet it to the absolute path of the executable, or unset it.`,
    );
    this.name = "InvalidBinOverride";
  }
}

/**
 * A bare name would resolve through `PATH`, which lint cannot see in a variable, so
 * the override must be absolute; `existsSync` turns a typo into a named error.
 */
export function overrideProgram(variable: string, value: string): Program {
  if (!isAbsolute(value)) {
    throw new InvalidBinOverride(
      variable,
      value,
      "is not an absolute path, so it would be resolved through PATH. This module never does that.",
    );
  }
  if (!existsSync(value)) {
    throw new InvalidBinOverride(variable, value, "does not exist.");
  }
  return { command: value, leadingArguments: [] };
}

/** `npm_execpath` is honoured only when it names pnpm: `npm create` sets it too. */
export function resolvePackageManager(
  manager: string = PACKAGE_MANAGER,
  environment: NodeJS.ProcessEnv = process.env,
): Program {
  const override = environment[BIN_OVERRIDE_ENV_VAR.packageManager];
  if (override !== undefined && override !== "") {
    return overrideProgram(BIN_OVERRIDE_ENV_VAR.packageManager, override);
  }
  const execPath = environment["npm_execpath"];
  if (execPath !== undefined && execPath !== "" && basename(execPath).startsWith(manager)) {
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
    return overrideProgram(BIN_OVERRIDE_ENV_VAR.git, override);
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

/** Inherits stdio; `shell` stays off so a project name is never re-parsed as a command line. */
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
