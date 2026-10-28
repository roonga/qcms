/**
 * The full-stack browser-smoke harness: bring the solo Compose stack up in an isolated
 * Compose project, bootstrap an administrator in it, drive the suite, take it down.
 *
 * It takes the seat's HARNESS port block, not the stable one the same compose file
 * defaults to, and its project name carries a `-full-stack-e2e` suffix: two Compose
 * stacks sharing a project name are one stack, and `down --volumes --remove-orphans`
 * here would otherwise delete the dev database running under the same seat.
 */

import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createFirstAdmin, generatePassword } from "./compose-admin.mjs";
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
/**
 * Must be identical in every environment, or a local pass stops covering what CI runs.
 * Hence the browsed origin is always `http://localhost`, which Chromium treats as
 * trustworthy so `Secure` cookies work; and hence no `QCMS_BIND_ADDRESS` and no cookie
 * flag here, leaving the compose file's loopback publish and the containers' own
 * `NODE_ENV` to decide.
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
    QCMS_PORTAL_ENVIRONMENTS: "test",
  };
}

/**
/**
 * The `--env-file` carries placeholders the API now refuses to boot on, so real values
 * are generated here. Shell environment beats `--env-file` in Compose interpolation.
 * Hex rather than base64url, so a generated value can never begin with a placeholder
 * prefix by chance.
 *
 * @param {() => string} [generate]
 * @returns {Record<string, string>}
 */
export function harnessSecrets(generate = () => randomBytes(32).toString("hex")) {
  return {
    QCMS_LINK_KEYS: generate(),
    QCMS_SESSION_KEYS: generate(),
    QCMS_INTERNAL_TOKEN: generate(),
    QCMS_APP_KEY: generate(),
    QCMS_ADMIN_AUTH_SECRET: generate(),
  };
}

const e2eEnvironment = {
  ...process.env,
  ...harnessSecrets(),
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
/**
 * Throws rather than exiting: `process.exit()` does not unwind, so it would skip
 * `runComplete()`'s `finally { down(); }` and strand the containers and volume.
 */
function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: root, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new CommandFailed(command, result.status ?? 1);
}

/**
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
/**
 * Exported so `drill-restore.mjs` addresses the same project name and env file rather
 * than reconstructing them: the project name is what `down()` deletes a stack under.
 *
 * @param {string[]} args
 * @returns {void}
 */
export function composeRun(args) {
  run(docker, [...compose, ...args], e2eEnvironment);
}

/**
 * @param {string[]} args
 * @returns {string}
 */
export function composeCapture(args) {
  return capture(docker, [...compose, ...args]);
}

// Inside the dev container the Docker host is another machine and the stack's publish is
// bound to its loopback, which no sibling container can reach at any address. Measured:
// an unpublished sibling port times out, and connects after `docker network connect`. So
// this joins the Compose network and forwards this container's own loopback, which is
// also why the compose file's bind can be left alone.

let forwarder;

let joinedNetwork;

/**
 * The hostname, which is the container id unless someone passed `--hostname`.
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
/**
 * More than one network is a refusal, not a pick: `Object.keys(...)[0]` would be a
 * lexicographic artifact of Docker's Go map serialization, and which network to join is
 * a real decision about the stack's shape.
 *
 * @param {Record<string, { IPAddress?: string }>} networks
 * @param {string} service
 * @returns {string}
 */
export function soleNetworkName(networks, service) {
  const names = Object.keys(networks ?? {});
  if (names.length === 0) throw new Error(`compose-e2e: ${service} is on no network`);
  if (names.length > 1)
    throw new Error(
      `compose-e2e: ${service} is on more than one network (${names.join(", ")}); ` +
        "the harness joins exactly one and cannot guess which carries the service, " +
        "so name it in scripts/compose-e2e.mjs rather than letting key order decide",
    );
  return names[0];
}

/**
/**
 * Read from the container because the listening port is the image's business, never a
 * QCMS allocation. UDP keys are filtered out, and several TCP ports is a refusal rather
 * than a pick: nothing in the list says which one serves the application.
 *
 * @param {Record<string, unknown>} exposed
 * @param {string} service
 * @returns {number}
 */
export function soleTcpPort(exposed, service) {
  const tcp = Object.keys(exposed ?? {}).filter((key) => key.endsWith("/tcp"));
  if (tcp.length === 0) throw new Error(`compose-e2e: ${service} exposes no TCP port`);
  if (tcp.length > 1)
    throw new Error(
      `compose-e2e: ${service} exposes more than one TCP port (${tcp.join(", ")}); ` +
        "the harness cannot tell which one serves the application, " +
        "so name it in scripts/compose-e2e.mjs rather than letting key order decide",
    );
  const port = Number(tcp[0].slice(0, -"/tcp".length));
  if (!Number.isInteger(port) || port <= 0)
    throw new Error(`compose-e2e: ${service} exposes an unreadable port key ${tcp[0]}`);
  return port;
}

/**
 * @param {string} service
 * @returns {{ network: string; address: string; port: number }}
 */
function serviceEndpoint(service) {
  const containerId = capture(docker, [...compose, "ps", "--quiet", service]);
  if (containerId === "") throw new Error(`compose-e2e: service ${service} has no container`);
  const networks = JSON.parse(
    capture(docker, ["inspect", containerId, "--format", "{{json .NetworkSettings.Networks}}"]),
  );
  const network = soleNetworkName(networks, service);
  const exposed = JSON.parse(
    capture(docker, ["inspect", containerId, "--format", "{{json .NetworkSettings.Ports}}"]),
  );
  return {
    network,
    address: networks[network].IPAddress,
    port: soleTcpPort(exposed, service),
  };
}

/**
/**
 * An id Docker cannot resolve throws here, naming where the id came from, rather than
 * silently skipping the join and leaving the forwarder pointing into an isolated bridge.
 *
 * @param {string} containerId
 * @returns {string[]}
 */
function attachedNetworkNames(containerId) {
  let raw;
  try {
    raw = capture(docker, [
      "inspect",
      containerId,
      "--format",
      "{{json .NetworkSettings.Networks}}",
    ]);
  } catch (error) {
    throw new Error(
      `compose-e2e: cannot inspect this container (id ${containerId}, read from /etc/hostname): ` +
        `${describe(error)}. That file is a container id only while the container keeps ` +
        "Docker's default hostname; a --hostname override makes it something else.",
      { cause: error },
    );
  }
  return Object.keys(JSON.parse(raw));
}

/**
 * The connect may fail because the endpoint is already there, but the same failure also
 * covers a missing network, a missing container and a dead daemon. Swallowing those
 * leaves the forwarder binding and printing `ready` while every connection times out, so
 * the outcome is read back from Docker rather than inferred from an exit status.
 *
 * @param {string} network
 * @param {string} containerId
 * @param {object} [io]
 * @param {(network: string, containerId: string) => { failure?: string }} [io.connect]
 * @param {(containerId: string) => string[]} [io.attached]
 * @returns {void}
 */
export function joinComposeNetwork(network, containerId, io = {}) {
  const connect = io.connect ?? connectContainerToNetwork;
  const attached = io.attached ?? attachedNetworkNames;
  const { failure } = connect(network, containerId);
  if (attached(containerId).includes(network)) return;
  throw new Error(
    `compose-e2e: this container (${containerId}) is not attached to the Compose network ` +
      `${network} after docker network connect` +
      (failure === undefined || failure === "" ? "" : `: ${failure}`) +
      ". Forwarded connections would time out on Docker's cross-bridge isolation rather " +
      "than be refused, and the run would fail minutes later inside a Playwright timeout.",
  );
}

/**
/**
 * Output captured rather than inherited, so the reason lands inside the thrown error.
 *
 * @param {string} network
 * @param {string} containerId
 * @returns {{ failure?: string }}
 */
function connectContainerToNetwork(network, containerId) {
  const result = spawnSync(docker, ["network", "connect", network, containerId], {
    cwd: root,
    env: e2eEnvironment,
    encoding: "utf8",
  });
  if (result.error) return { failure: result.error.message };
  if (result.status !== 0) return { failure: (result.stderr ?? "").trim() };
  return {};
}

/**
/**
 * A no-op outside a container: on a host checkout and on CI the published port is already
 * on `localhost`, and the container-only path must never run where it is not needed.
 *
 * @returns {Promise<void>}
 */
async function startLoopbackForwarding() {
  if (!isInDockerContainer()) return;
  const self = selfContainerId();
  if (self === undefined) throw new Error("compose-e2e: cannot determine this container's id");

  const portal = serviceEndpoint("portal");
  const admin = serviceEndpoint("admin");
  // One join covers both routes only while both services sit on the same network. If
  // that changed, the admin route would forward into a network never joined, and the
  // symptom would be a timeout rather than a refusal.
  if (admin.network !== portal.network)
    throw new Error(
      `compose-e2e: portal is on ${portal.network} but admin is on ${admin.network}; ` +
        "the harness joins one network and forwards both, so this stack needs a second join",
    );

  // Recorded before the join is attempted: a connect that half-succeeded and then failed
  // verification still needs teardown to try leaving the network.
  joinedNetwork = portal.network;
  joinComposeNetwork(portal.network, self);

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
      // stdin stays open for the run: its close is how the forwarder notices this process
      // died without getting to run any teardown.
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
 * Must run before `docker compose down`, which cannot remove a network this container is
 * still attached to. Both steps tolerate failure, so an already-gone forwarder never
 * masks the real reason a run failed.
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
  // Container-only: outside one no run ever joins a network, so this would only fire a
  // `docker network disconnect` that always fails and is always discarded.
  if (!isInDockerContainer()) return;
  // Attempted even when this run recorded no join, so an interrupted previous run's
  // leftover endpoint gets cleaned rather than blocking `compose down`.
  const network = joinedNetwork ?? `${project}_default`;
  const self = selfContainerId();
  if (self !== undefined) {
    spawnSync(docker, ["network", "disconnect", network, self], { cwd: root, stdio: "ignore" });
  }
  joinedNetwork = undefined;
}

/**
/**
 * Deliberately not exported: `createInitialAdmin` is the sole door an account comes
 * through and it closes the moment one exists (SEC-1), so "bootstrap another
 * administrator" is not an operation this harness can offer anything.
 *
 * @returns {{ email: string, password: string }}
 */
function bootstrapAdmin() {
  const credentials = {
    email: `compose.e2e.${Date.now().toString(36)}@admin.test`,
    password: generatePassword("e2e-"),
  };
  writeFileSync(credentialsPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  // The `mode` above applies only when the call creates the file, so an interrupted run
  // that left a 0644 file behind would keep it. This file holds a live administrator
  // password, so the permission is set rather than requested.
  chmodSync(credentialsPath, 0o600);
  // `up()` removed the volume first, so "created" is the only correct outcome: a skip
  // would mean driving a browser against an account whose password this run cannot know.
  const outcome = createFirstAdmin({ compose, credentials, environment: e2eEnvironment });
  if (outcome !== "created")
    throw new Error(
      `compose-e2e: the stack already had an administrator after down --volumes (${outcome}); ` +
        "the spec's credentials would not open it",
    );
  // Suppressed on CI: the workflow log of a public repository is a public log, and the
  // spec reads the credentials file rather than this output.
  if (process.env.CI === undefined || process.env.CI === "")
    process.stdout.write(
      `E2E admin: ${credentials.email}\nE2E password: ${credentials.password}\n`,
    );
  else process.stdout.write(`E2E admin credentials written to ${credentialsPath}\n`);
  return credentials;
}

export async function up() {
  // Test-only stack: removing its named volume makes each run independent, including the
  // first-admin bootstrap state.
  down();
  run(docker, [...compose, "up", "--detach", "--build", "--wait"], e2eEnvironment);
  bootstrapAdmin();
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
  // The runner process resolves workspace packages from their local dist directories,
  // unlike the Compose images, so they have to be built before it starts.
  const args = ["--filter", "@roonga/qcms-db...", "build"];
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
/**
 * So the seat refusal offers the fix for the command in front of the reader.
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
  // Before anything is spawned: the seat picks this stack's Compose project name, and
  // `down()` runs `down --volumes --remove-orphans` under it, so an adopted seat does not
  // just read another lane's stack, it deletes it. Rethrown as a UsageError so the
  // message prints without a stack trace burying it.
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

// Only when run as a command, so the tests can import the pure helpers above without a
// Compose run firing on import.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // This command holds the process open rather than backgrounding the stack, because the
  // forwarder is tethered to this process's stdin. So the interrupt paths below are what
  // clean up when a human stops it.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopLoopbackForwarding();
      process.exit(1);
    });
  }
  main().catch((error) => {
    // Teardown first, because `up` leaves the forwarder running on purpose and that live
    // child would keep the event loop alive, hanging the command after it printed its
    // error. A no-op after `runComplete`'s own `down()`.
    stopLoopbackForwarding();
    // Set the code rather than calling process.exit, so stdio flushes normally.
    process.exitCode = error instanceof CommandFailed ? error.status : 1;
    process.stderr.write(`compose-e2e: ${describe(error)}\n`);
  });
}
