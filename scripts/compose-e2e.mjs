/**
 * The Compose browser-smoke harness (task 036): bring the solo stack up in an
 * isolated Compose project, bootstrap a first administrator in it, drive
 * `playwright.compose.config.ts` against it, and take it back down again.
 *
 * ## Ports and the project name
 *
 * This stack is ephemeral and nothing outside the suite points at it, so it takes
 * the seat's HARNESS block (`17S00` portal, `17S40` admin) rather than the stable
 * one the same compose file defaults to for a human-run stack. The numbers are
 * derived from `scripts/ports.mjs`, never written here: R8 is a rule about
 * derivation, and a literal is how three copies of an allocation drift apart.
 *
 * The project name matters as much as the ports. Two Compose stacks sharing a
 * project name ARE one stack, so a second seat would recreate the first seat's
 * containers rather than run beside them. It is derived per seat as well, with an
 * `-e2e` suffix so this throwaway stack can never be confused with (or torn down
 * on top of) the dev database `scripts/dev-portal.mjs` runs under the same seat's
 * project name: `down --volumes --remove-orphans` here would otherwise delete it.
 *
 * `playwright.compose.config.ts` and the spec read the two base URLs exported
 * below and nothing else, so the allocation reaches the browser side through one
 * set of names.
 */

import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { composeProjectName, harnessPort } from "./ports.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const project = `${composeProjectName()}-full-stack-e2e`;
const dockerForWindows =
  process.env.ProgramFiles === undefined
    ? undefined
    : join(process.env.ProgramFiles, "Docker", "Docker", "resources", "bin", "docker.exe");
const docker =
  process.env.QCMS_DOCKER_BIN ??
  (process.platform === "win32" && dockerForWindows !== undefined && existsSync(dockerForWindows)
    ? dockerForWindows
    : "docker");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pnpmEntrypoint = process.env.npm_execpath;
const compose = ["compose", "--project-name", project, "--env-file", ".env.compose.example"];
const credentialsPath = join(root, ".e2e-full-stack-credentials.json");
const portalPort = harnessPort("portal");
const adminPort = harnessPort("admin");
const e2eEnvironment = {
  ...process.env,
  QCMS_ADMIN_PORT: String(adminPort),
  QCMS_PORTAL_PORT: String(portalPort),
  QCMS_ADMIN_BASE_URL: `http://localhost:${String(adminPort)}`,
  QCMS_PORTAL_BASE_URL: `http://localhost:${String(portalPort)}`,
};

/** A bad or missing subcommand: a user error, so it prints without a stack trace. */
class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/** A child process that exited non-zero, carrying its status to the top level. */
class CommandFailed extends Error {
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
 * Run a child process, and THROW on a non-zero exit rather than exiting here.
 *
 * `process.exit()` does not unwind the stack, so calling it from inside `up()` or
 * `test()` skipped `runComplete()`'s `finally { down(); }` entirely: any failing
 * run left the containers, the named volume and the credentials file behind, which
 * is the opposite of what README.md promises. Throwing lets the cleanup run and
 * lets the top level decide the exit code.
 */
function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: root, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new CommandFailed(command, result.status ?? 1);
}

function up() {
  // This stack is test-only. Removing its named volume makes each browser run
  // independent, including the first-admin bootstrap state.
  down();
  run(docker, [...compose, "up", "--detach", "--build", "--wait"], e2eEnvironment);
  const credentials = {
    email: `compose.e2e.${Date.now().toString(36)}@admin.test`,
    password: `e2e-${randomBytes(24).toString("base64url")}`,
  };
  writeFileSync(credentialsPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  run(
    docker,
    [
      ...compose,
      "exec",
      "--no-TTY",
      "--env",
      `QCMS_ADMIN_EMAIL=${credentials.email}`,
      "--env",
      `QCMS_ADMIN_PASSWORD=${credentials.password}`,
      "admin",
      "node",
      "scripts/create-admin.ts",
    ],
    e2eEnvironment,
  );
  // Printed for a human who wants to sign in to the stack by hand, and suppressed
  // on CI: the workflow log of a public repository is a public log, and the spec
  // reads the credentials file rather than this output.
  if (process.env.CI === undefined || process.env.CI === "")
    process.stdout.write(
      `E2E admin: ${credentials.email}\nE2E password: ${credentials.password}\n`,
    );
  else process.stdout.write(`E2E admin credentials written to ${credentialsPath}\n`);
}

function down() {
  run(docker, [...compose, "down", "--volumes", "--remove-orphans"], e2eEnvironment);
  if (existsSync(credentialsPath)) unlinkSync(credentialsPath);
}

function buildTestDependencies() {
  // Playwright imports the admin's auth helper in its host-side setup. Unlike the
  // Compose images, that process resolves workspace packages from their local
  // dist directories, so build the database package and its workspace closure
  // before starting the runner.
  const args = ["--filter", "@qcms/db...", "build"];
  if (pnpmEntrypoint !== undefined)
    run(process.execPath, [pnpmEntrypoint, ...args], e2eEnvironment);
  else run(pnpm, args, e2eEnvironment);
}

function test({ headed = false } = {}) {
  buildTestDependencies();
  const args = [
    "exec",
    "playwright",
    "test",
    "--config=playwright.compose.config.ts",
    ...(headed ? ["--headed"] : []),
  ];
  if (pnpmEntrypoint !== undefined)
    run(process.execPath, [pnpmEntrypoint, ...args], e2eEnvironment);
  else run(pnpm, args, e2eEnvironment);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describe(error) {
  if (error instanceof CommandFailed || error instanceof UsageError) return error.message;
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function runComplete({ headed = false } = {}) {
  /** @type {unknown} */
  let failure;
  try {
    up();
    test({ headed });
  } catch (error) {
    failure = error;
  }
  try {
    down();
  } catch (error) {
    // A failing teardown must never hide why the run failed in the first place.
    if (failure === undefined) failure = error;
    else process.stderr.write(`compose-e2e: teardown also failed: ${describe(error)}\n`);
  }
  if (failure !== undefined) throw failure;
}

function main() {
  const command = process.argv[2];
  if (command === "up") up();
  else if (command === "down") down();
  else if (command === "test") test();
  else if (command === "test-headed") test({ headed: true });
  else if (command === "run") runComplete();
  else if (command === "run-headed") runComplete({ headed: true });
  else
    throw new UsageError(
      "Usage: node scripts/compose-e2e.mjs <up|down|test|test-headed|run|run-headed>",
    );
}

try {
  main();
} catch (error) {
  // Set the code rather than calling process.exit: the stack has already
  // unwound through every `finally`, and this lets stdio flush normally.
  process.exitCode = error instanceof CommandFailed ? error.status : 1;
  process.stderr.write(`compose-e2e: ${describe(error)}\n`);
}
