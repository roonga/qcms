/**
 * The scaffolder's whole control flow (task 037).
 *
 * Separate from `cli.ts` so it can be called from a test without a subprocess: a bin
 * entry point runs on import by definition, and a module that runs on import cannot
 * be unit tested.
 *
 * Sequence, and every step is skippable by flag because CI needs to stop before the
 * ones that reach the network or the filesystem outside the target: stamp, install,
 * git init and first commit, print the next commands.
 */

import { readFileSync } from "node:fs";

import { ProgramNotFound, resolveGit, resolvePackageManager, run } from "./exec.js";
import {
  helpText,
  parseArguments,
  withDefaults,
  type PartialOptions,
  type ScaffoldOptions,
} from "./options.js";
import { nextSteps } from "./next-steps.js";
import { promptMissing, stdioAsker } from "./prompt.js";
import { scaffold, TargetNotEmpty } from "./scaffold.js";

/** This package's version, read from the manifest beside the built entry point. */
function version(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (typeof manifest === "object" && manifest !== null && "version" in manifest) {
    return String(manifest.version);
  }
  return "unknown";
}

/** Install workspace dependencies, reporting rather than throwing on failure. */
function install(options: ScaffoldOptions): string | undefined {
  const program = resolvePackageManager(options.packageManager);
  process.stdout.write(`\nInstalling dependencies with ${options.packageManager}...\n`);
  const result = run(program, ["install"], options.targetDirectory);
  if (result.ok) return undefined;
  return `${options.packageManager} install exited ${String(result.status)}. Run it yourself once the problem is fixed.`;
}

/**
 * Initialise a repository and make the first commit.
 *
 * A failing commit is reported, never fatal: the usual cause is a machine with no
 * git identity configured, and losing a correctly stamped tree over that would be
 * absurd. The files are staged either way, so the operator's own `git commit`
 * finishes the job.
 */
function initialiseRepository(options: ScaffoldOptions): string | undefined {
  const git = resolveGit();
  const cwd = options.targetDirectory;
  for (const args of [["init", "--quiet"], ["add", "-A"]]) {
    const result = run(git, args, cwd, true);
    if (!result.ok) return `git ${args.join(" ")} failed: ${result.stderr.trim()}`;
  }
  const commit = run(git, ["commit", "--quiet", "-m", "Initial commit from create-qcms-app"], cwd, true);
  if (!commit.ok) {
    return `The first commit failed (${commit.stderr.trim()}). Everything is staged; run \`git commit\` once your git identity is set.`;
  }
  return undefined;
}

/** The two post-stamp side effects, each reporting rather than throwing. */
function finishSetUp(options: ScaffoldOptions): readonly string[] {
  const warnings: string[] = [];
  try {
    if (options.install) {
      const problem = install(options);
      if (problem !== undefined) warnings.push(problem);
    }
    if (options.git) {
      const problem = initialiseRepository(options);
      if (problem !== undefined) warnings.push(problem);
    }
  } catch (error) {
    if (!(error instanceof ProgramNotFound)) throw error;
    warnings.push(error.message);
  }
  return warnings;
}

/** Ask for whatever the flags left open, when there is a terminal to ask through. */
async function resolveOptions(
  parsed: { readonly options: PartialOptions; readonly assumeYes: boolean },
  cwd: string,
): Promise<ScaffoldOptions> {
  if (parsed.assumeYes || process.stdin.isTTY !== true) {
    return withDefaults(parsed.options, cwd);
  }
  const asker = stdioAsker();
  try {
    return withDefaults(await promptMissing(parsed.options, asker, cwd), cwd);
  } finally {
    asker.close();
  }
}

export async function main(argv: readonly string[], cwd: string): Promise<number> {
  const parsed = parseArguments(argv, cwd);
  if (parsed.kind === "help") {
    process.stdout.write(helpText());
    return 0;
  }
  if (parsed.kind === "version") {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return 2;
  }

  const options = await resolveOptions(parsed, cwd);
  let result;
  try {
    result = scaffold(options);
  } catch (error) {
    if (!(error instanceof TargetNotEmpty)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  process.stdout.write(`Wrote ${String(result.files.length)} files to ${options.targetDirectory}\n`);

  const warnings = finishSetUp(options);
  process.stdout.write(nextSteps(options, result.unresolvedEnv));
  for (const warning of warnings) process.stderr.write(`\nWarning: ${warning}\n`);
  return 0;
}
