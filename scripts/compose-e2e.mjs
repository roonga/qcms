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
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isInDockerContainer } from "./docker-host.mjs";
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
export const credentialsPath = join(root, ".e2e-full-stack-credentials.json");
const portalPort = harnessPort("portal");
const adminPort = harnessPort("admin");
/**
 * What this harness hands Compose, the Playwright runner and the two application
 * containers - and, as an invariant, the SAME thing in every environment.
 *
 * That invariance is the point, not an accident of the current implementation.
 * `full-stack-e2e` exists to catch regressions at the auth boundary, and while CI is
 * down a local pass is the only evidence there is. Anything here that varied by
 * environment - the bind address, and above all the admin's `Secure` cookie flag -
 * would make the local run exercise a *different configuration than CI* and quietly
 * stop covering the thing it is run for. So the browsed origin is `http://localhost`
 * everywhere, which Chromium treats as a trustworthy origin, so `Secure` cookies
 * work and `QCMS_ADMIN_SECURE_COOKIES` is never set here at all.
 *
 * Making `localhost` true inside the dev container is `startLoopbackForwarding`'s
 * job, below. Notice what is NOT in this object: no `QCMS_BIND_ADDRESS`, so
 * `docker-compose.yml`'s loopback publish stands untouched (that exposure property
 * is not tradeable), and no cookie flag, so the containers' own `NODE_ENV` decides
 * exactly as it does on CI.
 *
 * Pure and exported so the invariant is a test rather than a comment.
 *
 * @param {object} options
 * @param {number} options.portalPort
 * @param {number} options.adminPort
 * @returns {Record<string, string>}
 */
export function composeEnvironmentOverrides({ portalPort, adminPort }) {
  return {
    QCMS_ADMIN_PORT: String(adminPort),
    QCMS_PORTAL_PORT: String(portalPort),
    QCMS_ADMIN_BASE_URL: `http://localhost:${String(adminPort)}`,
    QCMS_PORTAL_BASE_URL: `http://localhost:${String(portalPort)}`,
  };
}

const e2eEnvironment = {
  ...process.env,
  ...composeEnvironmentOverrides({ portalPort, adminPort }),
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

/**
 * Run a child process and return its stdout, for the `docker inspect` reads below.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: e2eEnvironment, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new CommandFailed(command, result.status ?? 1);
  return result.stdout.trim();
}

/**
 * Run a Compose subcommand against THIS harness's stack, streaming its output.
 *
 * Exported for `scripts/drill-restore.mjs`, which wraps its own dump/restore steps
 * around `up()` and `test()` below. The drill must address the same project name and
 * the same env file, and reconstructing either at the call site is how two copies of
 * an allocation drift apart (the project name in particular is what `down()` deletes
 * a stack under, so a drill that guessed it wrong would tear down the wrong stack).
 *
 * @param {string[]} args
 * @returns {void}
 */
export function composeRun(args) {
  run(docker, [...compose, ...args], e2eEnvironment);
}

/**
 * As {@link composeRun}, but returns trimmed stdout instead of streaming it.
 *
 * @param {string[]} args
 * @returns {string}
 */
export function composeCapture(args) {
  return capture(docker, [...compose, ...args]);
}

// ---------------------------------------------------------------------------
// Loopback forwarding, so `http://localhost:<port>` is a real address inside the
// dev container (issue #316).
//
// The stack publishes on the Docker host. Inside the dev container that host is
// another machine (ADR-29: `docker compose` drives the mounted host socket, so the
// services are sibling containers), and the publish is bound to the host's loopback,
// which no sibling can reach at any address. Rather than browse a different address
// - which drops `Secure` cookies and would need the local run to differ from CI -
// this joins the Compose network and forwards this container's own loopback to the
// service containers. Publishing then plays no part in how the suite connects, which
// is exactly why `docker-compose.yml`'s bind can be left alone.
//
// Measured before it was built: from this container, a sibling's unpublished port
// TIMEOUTs (Docker's cross-bridge isolation drops it) and CONNECTs after
// `docker network connect`. That is the whole reason the join step exists.
// ---------------------------------------------------------------------------

/** The running forwarder, or `undefined` when there is none. */
let forwarder;

/** The Compose network this container joined, so teardown can leave it again. */
let joinedNetwork;

/**
 * This container's id, which is its hostname unless someone overrode it.
 *
 * @returns {string | undefined}
 */
function selfContainerId() {
  try {
    return readFileSync("/etc/hostname", "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * A Compose service's address on the Compose network, and the port it listens on.
 *
 * The listening port is read from the container rather than written here: it is the
 * image's own business, never a QCMS allocation (`docs/PORTS.md`), so hardcoding it
 * would be inventing a number this repo does not own.
 *
 * @param {string} service
 * @returns {{ network: string; address: string; port: number }}
 */
function serviceEndpoint(service) {
  const containerId = capture(docker, [...compose, "ps", "--quiet", service]);
  if (containerId === "") throw new Error(`compose-e2e: service ${service} has no container`);
  const networks = JSON.parse(
    capture(docker, ["inspect", containerId, "--format", "{{json .NetworkSettings.Networks}}"]),
  );
  const network = Object.keys(networks)[0];
  if (network === undefined) throw new Error(`compose-e2e: ${service} is on no network`);
  const exposed = JSON.parse(
    capture(docker, ["inspect", containerId, "--format", "{{json .NetworkSettings.Ports}}"]),
  );
  const first = Object.keys(exposed)[0];
  if (first === undefined) throw new Error(`compose-e2e: ${service} exposes no port`);
  return {
    network,
    address: networks[network].IPAddress,
    port: Number(first.split("/")[0]),
  };
}

/**
 * Put this seat's harness ports on this container's loopback, pointing at the stack.
 *
 * A no-op outside a container: on a plain host checkout and on CI the published port
 * is already on `localhost` and there is nothing to forward. Same early-return
 * discipline as `publishedPortHost`, and for the same reason - the container-only
 * path must never run where it is not needed.
 *
 * @returns {Promise<void>}
 */
async function startLoopbackForwarding() {
  if (!isInDockerContainer()) return;
  const self = selfContainerId();
  if (self === undefined) throw new Error("compose-e2e: cannot determine this container's id");

  const portal = serviceEndpoint("portal");
  const admin = serviceEndpoint("admin");

  // Idempotent in effect: a second connect fails harmlessly when the endpoint is
  // already there, which is the state a previous interrupted run leaves behind.
  try {
    run(docker, ["network", "connect", portal.network, self], e2eEnvironment);
  } catch {
    // Already attached, which is exactly as good as attaching.
  }
  joinedNetwork = portal.network;

  const routes = [
    { listenPort: portalPort, targetHost: portal.address, targetPort: portal.port },
    { listenPort: adminPort, targetHost: admin.address, targetPort: admin.port },
  ];
  const child = spawn(
    process.execPath,
    [join(root, "scripts", "loopback-forward.mjs"), JSON.stringify(routes)],
    {
      cwd: root,
      env: e2eEnvironment,
      // stdin stays open for the run: its close is how the forwarder notices this
      // process died without getting to run any teardown.
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  forwarder = child;

  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("compose-e2e: loopback forwarder did not become ready"));
    }, 30_000);
    child.stdout.on("data", (chunk) => {
      if (settled || !chunk.toString().includes("ready")) return;
      settled = true;
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`compose-e2e: loopback forwarder exited early (code ${String(code)})`));
    });
  });
  process.stdout.write(
    `compose-e2e: forwarding localhost:${String(portalPort)} and localhost:${String(adminPort)} to the stack\n`,
  );
}

/**
 * Stop forwarding and leave the Compose network.
 *
 * Called from `down()`, which every exit path runs, and deliberately BEFORE
 * `docker compose down`: Compose cannot remove a network this container is still
 * attached to, so leaving it late turns teardown into a failure that strands the
 * network. Both steps tolerate failure, so an already-gone forwarder or an
 * already-removed network never masks the real reason a run failed.
 */
function stopLoopbackForwarding() {
  if (forwarder !== undefined) {
    try {
      forwarder.kill("SIGTERM");
    } catch {
      // Already exited.
    }
    forwarder = undefined;
  }
  // Attempted even when this run never recorded a join, so an interrupted previous
  // run's leftover endpoint gets cleaned up rather than blocking `compose down`.
  const network = joinedNetwork ?? `${project}_default`;
  const self = selfContainerId();
  if (self !== undefined) {
    spawnSync(docker, ["network", "disconnect", network, self], { cwd: root, stdio: "ignore" });
  }
  joinedNetwork = undefined;
}

export async function up() {
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
  // Last, so it only ever points at a stack that is already up and bootstrapped.
  await startLoopbackForwarding();
}

export function down() {
  // Before Compose: it cannot remove a network this container is still attached to.
  stopLoopbackForwarding();
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

export function test({ headed = false } = {}) {
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

async function runComplete({ headed = false } = {}) {
  /** @type {unknown} */
  let failure;
  try {
    await up();
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

async function main() {
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
  if (command === "up") await up();
  else if (command === "down") down();
  else if (command === "test") test();
  else if (command === "test-headed") test({ headed: true });
  else if (command === "run") await runComplete();
  else if (command === "run-headed") await runComplete({ headed: true });
  else
    throw new UsageError(
      "Usage: node scripts/compose-e2e.mjs <up|down|test|test-headed|run|run-headed>",
    );
}

// Only when run as a command, so `compose-e2e.test.ts` can import the pure helpers
// above without a Compose run firing on import. Same guard as `check-ports.mjs` and
// `check-changeset.mjs`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `pnpm docker:up` holds this process open rather than backgrounding the stack: the
  // forwarder is tethered to this process's stdin, so the stack stays reachable for
  // exactly as long as this command runs, and a second terminal drives the suite
  // against it. The interrupt paths below are therefore what clean up when a human
  // stops that command. `runComplete` has its own `down()` on every exit path, and the
  // forwarder additionally dies when this process's stdin pipe to it closes, whatever
  // kills this process.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopLoopbackForwarding();
      process.exit(1);
    });
  }
  main().catch((error) => {
    // Set the code rather than calling process.exit: the stack has already
    // unwound through every `finally`, and this lets stdio flush normally.
    process.exitCode = error instanceof CommandFailed ? error.status : 1;
    process.stderr.write(`compose-e2e: ${describe(error)}\n`);
  });
}
