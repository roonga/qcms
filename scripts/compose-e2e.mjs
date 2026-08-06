/**
 * The full-stack browser-smoke harness (task 036): bring the solo Compose stack up
 * in an isolated Compose project, bootstrap a first administrator in it, drive
 * `playwright.compose.config.ts` against it, and take it back down again. The flow
 * is called "full-stack" everywhere it is named - the CI job, the report
 * directories, the spec in `apps/e2e/` - and this file keeps its Compose-shaped
 * filename only because it is what `package.json` and the workflow already invoke.
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
 * containers rather than run beside them. It is derived per seat as well, with a
 * `-full-stack-e2e` suffix so this throwaway stack can never be confused with (or
 * torn down on top of) the dev database `scripts/dev-portal.mjs` runs under the
 * same seat's project name: `down --volumes --remove-orphans` here would otherwise
 * delete it.
 *
 * `playwright.compose.config.ts` and the spec read the two base URLs exported
 * below and nothing else, so the allocation reaches the browser side through one
 * set of names.
 */

import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publishedPortHost, publishedPortOrigin } from "./docker-host.mjs";
import { assertPortSeatChosen, composeProjectName, harnessPort } from "./ports.mjs";

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
/**
 * The address this process reaches the published stack on (issue #316).
 *
 * `localhost` on a host checkout and on a CI runner; the default-route gateway in
 * the dev container, where `docker compose` drives the mounted host socket and every
 * container it starts is a sibling published on the HOST's loopback, not on this
 * one. See `scripts/docker-host.mjs` for the full reasoning.
 */
const publishHost = publishedPortHost();

/**
 * Everything that has to move when the stack is addressed by something other than
 * `localhost`, as a pure function of the resolved host.
 *
 * Pure and exported so all three environments are testable without being in them.
 * The three knobs below are not independent: moving the address without moving the
 * other two produces a stack that comes up healthy and fails anyway, which is the
 * shape of #316 twice over.
 *
 * **The publish interface.** `docker-compose.yml` publishes to
 * `${QCMS_BIND_ADDRESS:-127.0.0.1}` deliberately: a bare `PORT:3000` would put the
 * authoring admin on every network the host can reach, past the host firewall,
 * because Docker's forwarding rules sit ahead of it. But a listener on the host's
 * loopback is unreachable from a sibling container whatever address it dials, so
 * resolving the gateway and leaving the bind alone would still be refused. The
 * answer is the gateway interface itself rather than `0.0.0.0`: that is the Docker
 * bridge on the host, so the stack is reachable from this container and from the
 * host, and from nothing else. The property the default protects is kept, not
 * widened. (`api` and `postgres` have no `ports:` key at all, so this cannot expose
 * them either way, and ADR-20 stands.)
 *
 * **The admin's `Secure` cookie flag.** A `Secure` cookie can only be stored by a
 * trustworthy origin. `http://localhost` is trustworthy, which is why CI has never
 * needed this; a bare IPv4 gateway is not, so Chromium silently drops the
 * `Set-Cookie` and sign-in appears to succeed and bounce. Unset, the containers'
 * `NODE_ENV=production` decides and marks them `Secure`
 * (`apps/api/src/config.ts:502-507` -> `features/auth/instance.ts:167`), so moving
 * the origin off loopback without moving this flag breaks the admin half of the
 * spec: sign-in, the `/two-factor/enroll` redirect and the TOTP verification all
 * need that cookie. `.env.compose.example` documents this exact case, in the comment
 * above `QCMS_ADMIN_SECURE_COOKIES`: "Set it to false only if the admin is reached
 * over plain HTTP at a NON-loopback hostname". This is that configuration. The
 * portal side already sets `QCMS_SECURE_COOKIES=false` in the env file and needs
 * nothing here.
 *
 * An explicit value from the environment wins in both cases, and a `localhost` host
 * (a plain checkout, and CI) produces byte-identical output to before this existed:
 * `127.0.0.1`, and no cookie override at all.
 *
 * @param {object} options
 * @param {string} options.publishHost the address this process reaches the stack on.
 * @param {number} options.portalPort
 * @param {number} options.adminPort
 * @param {Record<string, string | undefined>} [options.env] the ambient environment.
 * @returns {Record<string, string>}
 */
export function composeEnvironmentOverrides({
  publishHost,
  portalPort,
  adminPort,
  env = process.env,
}) {
  const loopback = publishHost === "localhost";
  return {
    QCMS_BIND_ADDRESS: env.QCMS_BIND_ADDRESS ?? (loopback ? "127.0.0.1" : publishHost),
    QCMS_ADMIN_PORT: String(adminPort),
    QCMS_PORTAL_PORT: String(portalPort),
    // The two `*_PORT` values are what Compose publishes ON THE DOCKER HOST; the two
    // `*_BASE_URL` values are how this process, the Playwright runner it starts, and
    // the browser that runner drives all reach the result. Both apps also read their
    // own base URL at container boot (better-auth scopes admin cookies to that exact
    // origin, and the portal builds respondent redirects from it), so the two must
    // agree: one resolution, used for the publish, the runner and the containers.
    QCMS_ADMIN_BASE_URL: publishedPortOrigin(adminPort, { override: publishHost }),
    QCMS_PORTAL_BASE_URL: publishedPortOrigin(portalPort, { override: publishHost }),
    ...(loopback || env.QCMS_ADMIN_SECURE_COOKIES !== undefined
      ? {}
      : { QCMS_ADMIN_SECURE_COOKIES: "false" }),
  };
}

const e2eEnvironment = {
  ...process.env,
  ...composeEnvironmentOverrides({ publishHost, portalPort, adminPort }),
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
  // Bootstrapped through the **api** service, not admin: since task 056 the API owns
  // better-auth and is the only container with a database credential, so it is the only
  // one that can create an account (ADR-35 as amended 2026-07-31). The entry is a
  // compiled one (`dist/create-admin.js`) because the image is built by
  // `pnpm deploy --prod`, which ships only what the package's `files` field lists.
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
      "api",
      "node",
      "dist/create-admin.js",
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
  // The full-stack spec imports the admin suite's browser helpers, which reach
  // workspace packages. Unlike the Compose images, the runner process resolves those
  // from their local dist directories, so build the database package and its workspace
  // closure before starting the runner.
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

/**
 * The `pnpm` script a given subcommand was almost certainly reached through.
 *
 * So the seat refusal offers the fix for the command in front of the reader rather
 * than for a different one. Unknown or missing subcommands get the self-contained
 * entry point, which is also what the usage error is about to recommend.
 *
 * @param {string | undefined} command
 * @returns {string}
 */
function invokedAs(command) {
  const scripts = {
    up: "docker:up",
    down: "docker:down",
    test: "test:e2e",
    "test-headed": "test:e2e:headed",
    run: "up:e2e",
    "run-headed": "up:e2e:headed",
  };
  return `pnpm ${(command !== undefined && scripts[command]) || "up:e2e"}`;
}

function main() {
  const command = process.argv[2];
  // Before anything is spawned. A silent fallback to seat 0 here is worse than it is
  // in the browser harness (issue #296): the seat picks this stack's Compose PROJECT
  // NAME, and `down()` runs `docker compose down --volumes --remove-orphans` under
  // it, so an adopted seat does not just read another lane's stack, it deletes it.
  // The primary checkout and CI keep the silent default, exactly as they do today.
  //
  // Rethrown as a UsageError because that is exactly what it is: it prints its
  // message without a stack trace, like the usage error below, and a stack trace on
  // a "you forgot a variable" message buries the one line that matters.
  try {
    assertPortSeatChosen(root, invokedAs(command));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
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

// Only when run as a command, so `compose-e2e.test.ts` can import the pure helper
// above without a Compose run firing on import. Same guard as `check-ports.mjs` and
// `check-changeset.mjs`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    // Set the code rather than calling process.exit: the stack has already
    // unwound through every `finally`, and this lets stdio flush normally.
    process.exitCode = error instanceof CommandFailed ? error.status : 1;
    process.stderr.write(`compose-e2e: ${describe(error)}\n`);
  }
}
