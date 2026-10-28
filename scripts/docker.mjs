// @ts-check

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const DOCKER = resolveDocker();

/** @returns {string} */
function resolveDocker() {
  const override = process.env.QCMS_DOCKER_BIN;
  if (override !== undefined && override !== "") return override;
  if (process.platform === "win32" && process.env.ProgramFiles !== undefined) {
    const desktop = join(
      process.env.ProgramFiles,
      "Docker",
      "Docker",
      "resources",
      "bin",
      "docker.exe",
    );
    if (existsSync(desktop)) return desktop;
  }
  return "docker";
}

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
 * Throws rather than exiting: `process.exit()` does not unwind the stack, so it skips
 * every enclosing `finally` and leaves containers, volumes and credentials behind.
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
 * Asked of Compose rather than parsed from the YAML: overlay merge semantics are
 * Compose's rules, so a hand-rolled parser would assert against a guess at them.
 * `files` is in overlay order.
 *
 * @param {object} options
 * @param {readonly string[]} options.files
 * @param {Record<string, string>} [options.env]
 * @param {string} [options.envFile]
 * @returns {any}
 */
export function composeConfig({ files, env = {}, envFile = ".env.compose.example" }) {
  const args = [];
  for (const file of files) args.push("--file", file);
  args.push("--env-file", envFile, "config", "--format", "json");
  const json = captureProcess(DOCKER, ["compose", ...args], { ...process.env, ...env });
  return JSON.parse(json);
}

/**
 * @param {any} config
 * @param {string} service
 * @returns {string[]}
 */
export function publishedPorts(config, service) {
  const definition = config.services?.[service];
  if (definition === undefined)
    throw new Error(`no service named "${service}" in this configuration`);
  const ports = definition.ports ?? [];
  return ports.map(
    /** @param {any} entry */
    (entry) =>
      typeof entry === "string"
        ? entry
        : `${entry.host_ip === undefined ? "" : `${entry.host_ip}:`}${String(entry.published)}:${String(entry.target)}/${String(entry.protocol)}`,
  );
}
