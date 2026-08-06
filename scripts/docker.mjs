// @ts-check
/**
 * Shared Docker plumbing for the repo's Compose-driven harnesses (task 036).
 *
 * Three callers now spawn `docker` from this repository - the full-stack browser
 * harness (`compose-e2e.mjs`), the restore drill (`drill-restore.mjs`) and the
 * Compose-configuration gate (`compose-config.test.ts`) - and they had started to
 * agree only by copy. Binary resolution, the "throw, never exit" child-process
 * rule and the `docker compose config` reader live here once so all three agree by
 * construction.
 *
 * Nothing in here knows about a particular stack: project names, Compose file
 * lists and environments are the caller's business.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, resolved from this file rather than from the process cwd. */
export const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The `docker` executable.
 *
 * `QCMS_DOCKER_BIN` wins when set, which is the escape hatch for a host where the
 * CLI is somewhere unusual. Otherwise Windows gets Docker Desktop's known install
 * path when it exists, and every other platform gets the PATH lookup. The dev
 * container (ADR-29) is the canonical environment and always takes the last
 * branch; the Windows probe survives only because a contributor's host may still
 * drive these scripts through a shell that has no `docker` shim on PATH.
 */
export const DOCKER = resolveDocker();

/** @returns {string} */
function resolveDocker() {
  const override = process.env.QCMS_DOCKER_BIN;
  if (override !== undefined && override !== "") return override;
  if (process.platform === "win32" && process.env.ProgramFiles !== undefined) {
    const desktop = join(process.env.ProgramFiles, "Docker", "Docker", "resources", "bin", "docker.exe");
    if (existsSync(desktop)) return desktop;
  }
  return "docker";
}

/** A child process that exited non-zero, carrying its status to the top level. */
export class CommandFailed extends Error {
  /**
   * @param {string} command
   * @param {number} status
   */
  constructor(command, status) {
    super(`${command} exited with status ${String(status)}`);
    this.name = "CommandFailed";
    this.status = status;
  }
}

/**
 * Run a child process to completion with inherited stdio, and THROW on a non-zero
 * exit rather than exiting here.
 *
 * `process.exit()` does not unwind the stack, so calling it from inside a step
 * skips every enclosing `finally` - which is how a failing full-stack run used to
 * leave its containers, its named volume and its credentials file behind. Throwing
 * lets the cleanup run and lets the top level decide the exit code.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function runProcess(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new CommandFailed(command, result.status ?? 1);
}

/**
 * Run a child process and CAPTURE its stdout, throwing on a non-zero exit.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {string}
 */
export function captureProcess(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: environment,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new CommandFailed(command, result.status ?? 1);
  }
  return result.stdout;
}

/**
 * The fully merged, interpolated Compose configuration for `files`, as Compose
 * itself resolves it.
 *
 * Asking Compose rather than parsing the YAML is the whole point: an overlay's
 * merge semantics (which keys replace, which concatenate) are Compose's rules, and
 * a hand-rolled parser would be asserting against our guess at them instead of
 * against the configuration an operator actually gets.
 *
 * @param {object} options
 * @param {readonly string[]} options.files repo-relative Compose file paths, in overlay order.
 * @param {Record<string, string>} [options.env] extra interpolation variables.
 * @param {string} [options.envFile] repo-relative env file supplying the rest.
 * @returns {any} the parsed `docker compose config --format json` document.
 */
export function composeConfig({ files, env = {}, envFile = ".env.compose.example" }) {
  const args = [];
  for (const file of files) args.push("--file", file);
  args.push("--env-file", envFile, "config", "--format", "json");
  const json = captureProcess(DOCKER, ["compose", ...args], { ...process.env, ...env });
  return JSON.parse(json);
}

/**
 * The host-published ports of one service in a parsed Compose configuration, as
 * `host:container` strings. Empty means the service publishes nothing.
 *
 * @param {any} config a document from {@link composeConfig}.
 * @param {string} service
 * @returns {string[]}
 */
export function publishedPorts(config, service) {
  const definition = config.services?.[service];
  if (definition === undefined) throw new Error(`no service named "${service}" in this configuration`);
  const ports = definition.ports ?? [];
  return ports.map(
    /** @param {any} entry */
    (entry) =>
      typeof entry === "string"
        ? entry
        : `${entry.host_ip === undefined ? "" : `${entry.host_ip}:`}${String(entry.published)}:${String(entry.target)}/${String(entry.protocol)}`,
  );
}
