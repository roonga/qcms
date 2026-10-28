// @ts-check
/**
 * Drives the solo topology (`docker-compose.yml`) with the toolbox overlay.
 *
 * It has a Postgres of its own, which is a different database from the one
 * `docker-compose.dev.yml` publishes for `pnpm dev:portal`. An administrator created
 * against that one is invisible here, and the symptom is a sign-in that fails with
 * nothing wrong anywhere it is looked for, so the bootstrap runs `create-admin` inside
 * this stack's own `api` container.
 *
 * Two Compose stacks sharing a project name are one stack, so a wrong project name
 * means `dev:down` tears down nothing or tears down another lane's. That is also why a
 * linked worktree with no `QCMS_PORT_SEAT` is refused rather than defaulted: this
 * command runs `down --volumes --remove-orphans`, which would delete it.
 */

import { closeSync, fchmodSync, fstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createFirstAdmin, generatePassword } from "./compose-admin.mjs";
import { databaseUrlFor, seedFixtures } from "./compose-seed.mjs";
import { CommandFailed, DOCKER, REPOSITORY_ROOT, runProcess } from "./docker.mjs";
import { isInDockerContainer } from "./docker-host.mjs";
import { assertPortSeatChosen, localStackProjectName, stablePort } from "./ports.mjs";

export const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.dev-tools.yml"];

/**
 * Named explicitly rather than left to Compose's implicit load, so the error when it is
 * missing names it. `QCMS_DB_VIEWER_PASSWORD` is documented in `docs/DEVELOPER_GUIDE.md`
 * rather than in the template.
 */
export const ENV_FILE = ".env";

/**
 * Separate from `.env`, which a developer may re-copy from the template: this is the one
 * value that must not change once an account has enrolled.
 */
export const ADMIN_SECRET_FILE = ".env.dev-admin";

export const SUPPLIED_VARIABLES = [
  "QCMS_PORTAL_BASE_URL",
  "QCMS_ADMIN_BASE_URL",
  "QCMS_ADMIN_AUTH_SECRET",
];

/** `.test` is reserved for testing and can never resolve (RFC 6761). */
const DEFAULT_ADMIN_EMAIL = "dev@qcms.test";

/** Scanned rather than listed, so a `:?` added to either file is preflighted anyway. */
export function requiredVariablesIn(text) {
  const found = new Set();
  for (const match of text.matchAll(/\$\{([A-Z0-9_]+):\?/g)) found.add(match[1]);
  return [...found];
}

export function requiredVariables(files = COMPOSE_FILES) {
  const supplied = new Set(SUPPLIED_VARIABLES);
  const names = new Set();
  for (const file of files)
    for (const name of requiredVariablesIn(readFileSync(join(REPOSITORY_ROOT, file), "utf8")))
      if (!supplied.has(name)) names.add(name);
  return [...names];
}

/**
 * Deliberately naive, and not Compose's full `.env` grammar: Compose reads the file
 * itself, so a misread here only makes the preflight lenient, never the stack wrong.
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")))
      if (value.endsWith(value[0])) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

export function missingVariables(required, fileValues, environment) {
  return required.filter((name) => {
    const value = environment[name] ?? fileValues[name] ?? "";
    return value.trim() === "";
  });
}

/**
 * No value is ever invented here, which is a control rather than an omission: the viewer
 * password is undefaulted in the overlay so a read-only database client cannot be stood
 * up by accident, and a default picked here would put one in everybody's stack.
 */
export function preflightMessage(missing, envFileExists) {
  const lines = [
    `pnpm dev:up needs ${String(missing.length)} more value(s) before Compose can start the stack:`,
    "",
    ...missing.map((name) => `  - ${name}`),
    "",
  ];
  if (!envFileExists) {
    lines.push(
      `There is no ${ENV_FILE} yet. Start from the operator template and fill in every secret:`,
      "",
      `  cp .env.compose.example ${ENV_FILE}`,
      "",
    );
  }
  lines.push(
    `Every value above belongs in ${ENV_FILE} (or in your shell, which wins over the file).`,
    "All but one are described in .env.compose.example.",
    "",
    "QCMS_DB_VIEWER_PASSWORD is the exception and is NOT in that template: it is the",
    "password for the read-only role the toolbox's database viewer connects as, so it",
    "is a developer's value rather than an operator's, and docs/DEVELOPER_GUIDE.md is",
    "where it is documented. Nothing in this repo picks one for you, deliberately.",
    "",
    `  echo "QCMS_DB_VIEWER_PASSWORD=$(openssl rand -hex 24)" >> ${ENV_FILE}`,
  );
  return lines.join("\n");
}

/** Permission bits belonging to group and other: what must be off on a secret file. */
const GROUP_AND_OTHER = 0o077;

const OWNER_ONLY = 0o600;

/**
 * One descriptor for both halves: `existsSync` then `readFileSync`, or `statSync` then
 * `chmodSync`, is a check-then-use race on a path (CodeQL `js/file-system-race`).
 *
 * Only `ENOENT` means "no pin yet". Anything else is rethrown, because regenerating
 * would overwrite a secret this process could not read.
 */
function readAndSecurePinFile(path) {
  /** @type {number} */
  let handle;
  try {
    handle = openSync(path, "r");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const text = readFileSync(handle, "utf8");
    const mode = fstatSync(handle).mode & 0o777;
    /** @type {string | undefined} */
    let tightenedFrom;
    if ((mode & GROUP_AND_OTHER) !== 0) {
      // Preserve the owner's own bits rather than forcing 0600: a file deliberately made
      // 0400 asked for read-only, and tightening must never add a write bit back.
      fchmodSync(handle, mode & 0o700);
      tightenedFrom = mode.toString(8);
    }
    const secret = (parseEnvFile(text).QCMS_ADMIN_AUTH_SECRET ?? "").trim();
    return tightenedFrom === undefined ? { secret } : { secret, tightenedFrom };
  } finally {
    closeSync(handle);
  }
}

/**
 * `open`'s `mode` applies only when the call creates the file and is ignored on one that
 * exists, which is exactly the regenerate path, so the permission is set afterwards and
 * on the descriptor rather than on the name.
 */
function writePinFile(path, secret) {
  const handle = openSync(path, "w", OWNER_ONLY);
  try {
    writeFileSync(
      handle,
      [
        "# Generated by pnpm dev:up. Gitignored.",
        "#",
        "# better-auth encrypts the enrolled TOTP secret under this value and decrypts with",
        "# whatever it holds at the time, so changing it makes an existing authenticator",
        "# permanently unverifiable and costs a recovery code per restart. Keep it.",
        `QCMS_ADMIN_AUTH_SECRET=${secret}`,
        "",
      ].join("\n"),
    );
    fchmodSync(handle, OWNER_ONLY);
  } finally {
    closeSync(handle);
  }
}

/**
 * Left unset, the API generates a fresh secret every boot, and better-auth stores the
 * enrolled TOTP secret encrypted under this value: a restart would make an existing
 * authenticator permanently unverifiable, and the admin ships no re-enrolment screen.
 *
 * `.env` is deliberately not one of the rungs, because re-copying the template would put
 * its placeholder back over a pinned secret. The file is made owner-only on every path,
 * not only when created, since `mode` is ignored on a file that already exists.
 */
export function pinAdminAuthSecret({
  environment = process.env,
  path = join(REPOSITORY_ROOT, ADMIN_SECRET_FILE),
} = {}) {
  const ambient = (environment.QCMS_ADMIN_AUTH_SECRET ?? "").trim();
  if (ambient !== "") return { secret: ambient, source: "environment" };

  const stored = readAndSecurePinFile(path);
  if (stored !== undefined && stored.secret !== "")
    return stored.tightenedFrom === undefined
      ? { secret: stored.secret, source: "file" }
      : { secret: stored.secret, source: "file", tightenedFrom: stored.tightenedFrom };

  const secret = randomBytes(32).toString("base64url");
  writePinFile(path, secret);
  return { secret, source: "generated" };
}

/** Names the variable, the file and the mode, and never the value (SEC-8). */
export function pinNoticeLines(pin, file = ADMIN_SECRET_FILE) {
  const lines = [
    {
      environment: "QCMS_ADMIN_AUTH_SECRET taken from your environment (pinned by you).",
      file: `QCMS_ADMIN_AUTH_SECRET read from ${file} (pinned by an earlier run).`,
      generated: `QCMS_ADMIN_AUTH_SECRET generated and written to ${file} (gitignored). Keep it: an enrolled authenticator stops verifying if it changes.`,
    }[pin.source],
  ];
  if (pin.tightenedFrom !== undefined)
    lines.push(
      `${file} was mode ${pin.tightenedFrom}, which lets other users on this machine read ` +
        "a secret. Tightened it to owner-only. Nothing else was changed.",
    );
  return lines;
}

/** Derived from the seat and never written down (R8, `docs/PORTS.md`). */
export function seatPorts(seat) {
  return {
    portal: stablePort("portal", seat),
    admin: stablePort("admin", seat),
    observability: stablePort("observability", seat),
    dbViewer: stablePort("dbViewer", seat),
  };
}

/**
 * better-auth trusts the admin origin and no other, so a base URL that disagrees with
 * the published port is a sign-in that redirects forever.
 *
 * The bind address is an override rather than a pass-through, unlike every other value
 * here: this stack prints a plaintext administrator credential and runs a Grafana whose
 * login is `admin`/`admin`, so it stays on loopback whatever `.env` said.
 */
export function devStackEnvironmentOverrides({ ports, adminAuthSecret }) {
  return {
    QCMS_PORTAL_PORT: String(ports.portal),
    QCMS_ADMIN_PORT: String(ports.admin),
    QCMS_OBSERVABILITY_PORT: String(ports.observability),
    QCMS_DB_VIEWER_PORT: String(ports.dbViewer),
    QCMS_PORTAL_BASE_URL: `http://localhost:${String(ports.portal)}`,
    QCMS_ADMIN_BASE_URL: `http://localhost:${String(ports.admin)}`,
    QCMS_BIND_ADDRESS: "127.0.0.1",
    QCMS_ADMIN_AUTH_SECRET: adminAuthSecret,
  };
}

/**
 * The only credential on screen is the local administrator one this command generated:
 * never the database password, the link or session keys, or the internal token (SEC-8).
 */
export function devStackBannerLines({ ports, project, credentials, inContainer }) {
  const url = (/** @type {number} */ port) => `http://localhost:${String(port)}`;
  const lines = [
    "",
    "==================================================================",
    `  The stack is up (Compose project ${project}).`,
    "",
    `      Admin      ${url(ports.admin)}`,
    `      Portal     ${url(ports.portal)}`,
    `      Grafana    ${url(ports.observability)}`,
    `      pgweb      ${url(ports.dbViewer)}`,
    "",
  ];

  if (credentials === undefined) {
    lines.push(
      "  This stack already had an administrator, so none was created (SEC-1: the",
      "  bootstrap command only runs against an empty admin table, and that refusal",
      "  is correct). Sign in with the credential from when it was created, or run",
      "  pnpm dev:down and then pnpm dev:up for a fresh database and a fresh account.",
      "",
    );
  } else {
    const signInUrl = new URL("/sign-in", url(ports.admin));
    signInUrl.search = new URLSearchParams(credentials).toString();
    lines.push(
      "  Sign in to the admin with the account this run created:",
      "",
      `      email     ${credentials.email}`,
      `      password  ${credentials.password}`,
      `      Login     ${signInUrl.href}`,
      "",
      "  It is printed because it is the only copy: nothing writes it to disk. This",
      "  is a local, loopback-only stack, which is the whole reason that is acceptable.",
      "",
      "  Have an authenticator app open. First sign-in forces TOTP enrolment before",
      "  anything else (SEC-1), and the recovery codes are shown exactly once.",
      "",
    );
  }

  lines.push(
    "  Grafana logs in with admin / admin (the image's own default). Its QCMS",
    "  Observability home dashboard shows qcms-admin, qcms-portal and qcms-api.",
    "  Explore -> Loki remains available for ad-hoc LogQL queries.",
    "  Trace-correlated records link to Tempo; requestId follows a call across apps.",
    "  Exported fields are a strict SEC-13 allowlist: no answers, PII or secrets.",
    "",
    "  Nothing persists in the dashboard either (the overlay declares no volumes),",
    "  and the first request after a cold start may be missing: lgtm takes tens of",
    "  seconds to accept OTLP and the earliest spans exhaust their retry budget.",
    "",
  );

  if (inContainer) {
    lines.push(
      "  You are inside the dev container, so these ports are published on the HOST's",
      "  loopback (Compose drives the host daemon, ADR-29). Open them in a browser on",
      "  the host; they are not reachable from this container's own localhost.",
      "",
    );
  }

  lines.push(
    "  Stop and remove everything (containers, network, volumes):  pnpm dev:down",
    "==================================================================",
    "",
  );
  return lines;
}

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Computed once so `up` and `down` cannot disagree: a `down` that derived the name again
 * and got it wrong would remove nothing and leave a stack no documented command stops.
 */
const project = process.env.COMPOSE_PROJECT_NAME ?? localStackProjectName();

/**
 * `--env-file` is attached only when the file is there, because Compose errors on a
 * missing one and `down` has to keep working in exactly that state.
 */
function composeArgs(hasEnvFile) {
  const args = ["compose", "--project-name", project];
  if (hasEnvFile) args.push("--env-file", ENV_FILE);
  for (const file of COMPOSE_FILES) args.push("--file", file);
  return args;
}

function composeEnvironment(overrides) {
  return { ...process.env, ...overrides };
}

function log(message) {
  process.stdout.write(`[dev-stack] ${message}\n`);
}

/**
 * One read rather than `existsSync` then `readFileSync`, which is a check-then-use race.
 * The same answer decides whether `--env-file` is passed, so the two cannot disagree.
 */
function envFileState() {
  let text;
  try {
    text = readFileSync(join(REPOSITORY_ROOT, ENV_FILE), "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT")
      return { exists: false, values: {} };
    throw error;
  }
  return { exists: true, values: parseEnvFile(text) };
}

/** `up` only. Deliberately not run for `down`: see {@link teardownPlaceholders}. */
function preflight({ exists, values }) {
  const missing = missingVariables(requiredVariables(), values, process.env);
  if (missing.length > 0) throw new UsageError(preflightMessage(missing, exists));
}

/**
 * Compose interpolates the same files going down as going up, so an edited or deleted
 * `.env` would make `down` fail on a `:?` variable and leave a running stack no
 * documented command stops. Nothing on the teardown path reads these values: what
 * Compose removes comes from the project label and the volume and network declarations.
 */
export function teardownPlaceholders(required, fileValues, environment) {
  /** @type {Record<string, string>} */
  const filled = {};
  for (const name of missingVariables(required, fileValues, environment))
    filled[name] = "unused-during-teardown";
  return filled;
}

export function up() {
  const envFile = envFileState();
  preflight(envFile);
  const pin = pinAdminAuthSecret();
  for (const line of pinNoticeLines(pin)) log(line);

  const ports = seatPorts();
  const environment = composeEnvironment(
    devStackEnvironmentOverrides({ ports, adminAuthSecret: pin.secret }),
  );

  const compose = composeArgs(envFile.exists);
  log(`bringing up ${COMPOSE_FILES.join(" + ")} as project ${project} ...`);
  runProcess(DOCKER, [...compose, "up", "--detach", "--build", "--wait"], environment);

  const credentials = {
    email: process.env.QCMS_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL,
    // Never a value written in this repository: a committed credential is a credential
    // in every clone.
    password: process.env.QCMS_ADMIN_PASSWORD || generatePassword("dev-"),
  };
  const outcome = createFirstAdmin({ compose, credentials, environment });

  process.stdout.write(
    devStackBannerLines({
      ports,
      project,
      credentials: outcome === "created" ? credentials : undefined,
      inContainer: isInDockerContainer(),
    }).join("\n") + "\n",
  );
}

export function seedNoticeLine(mode, name) {
  return {
    seed: `seeding the sample question library and form into project ${name} ...`,
    clear: `clearing the seeded questions and form from project ${name} ...`,
    reset: `clearing and reseeding the sample data in project ${name} ...`,
  }[mode];
}

/**
 * Run the sample-data loader against the running stack: `pnpm dev:seed`,
 * `pnpm dev:seed:clear`, `pnpm dev:seed:reset`.
 *
 * For `clear` the shared door is a control rather than a convenience: a command that
 * deletes sample data must be unable to name any database but this stack's, so the URL
 * is composed from this stack's own variables and dials `postgres:5432`, a name that
 * resolves only on this Compose network.
 *
 * It preflights like `up` rather than filling placeholders like `down`, because the
 * database credential is read for real here.
 */
export function seed(mode = "seed") {
  const envFile = envFileState();
  preflight(envFile);

  const environment = composeEnvironment(
    devStackEnvironmentOverrides({
      ports: seatPorts(),
      // Never used on this path, but Compose interpolates the whole file whatever is
      // being run, so it has to be present rather than absent.
      adminAuthSecret: pinAdminAuthSecret().secret,
    }),
  );

  log(seedNoticeLine(mode, project));
  seedFixtures({
    compose: composeArgs(envFile.exists),
    databaseUrl: databaseUrlFor({ ...envFile.values, ...process.env }),
    environment,
    mode,
  });
}

export function down() {
  // No preflight: a teardown that refuses because a value went missing leaves a running
  // stack the documented command cannot stop.
  const envFile = envFileState();
  const environment = composeEnvironment({
    ...teardownPlaceholders(requiredVariables(), envFile.values, process.env),
    ...devStackEnvironmentOverrides({
      ports: seatPorts(),
      adminAuthSecret: "unused-during-teardown",
    }),
  });
  // The same project and file list the `up` used, or this removes nothing. `--volumes`
  // takes this stack's database; `--remove-orphans` takes the overlay's containers.
  log(`removing project ${project} (containers, network, volumes, orphans) ...`);
  runProcess(
    DOCKER,
    [...composeArgs(envFile.exists), "down", "--volumes", "--remove-orphans"],
    environment,
  );
}

/**
 * A `UsageError` would have its one useful line buried by a stack trace, and a
 * `CommandFailed` means Compose already printed the real reason immediately above.
 * Everything else is unexpected and keeps its stack.
 */
function describe(error) {
  if (error instanceof UsageError || error instanceof CommandFailed) return error.message;
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

export const SUBCOMMANDS = {
  up,
  seed: () => {
    seed("seed");
  },
  "seed:clear": () => {
    seed("clear");
  },
  "seed:reset": () => {
    seed("reset");
  },
  down,
};

export function usageLine() {
  return `Usage: node scripts/dev-compose.mjs <${Object.keys(SUBCOMMANDS).join("|")}>`;
}

function main() {
  const command = process.argv[2] ?? "";
  const run = Object.hasOwn(SUBCOMMANDS, command) ? SUBCOMMANDS[command] : undefined;
  if (run === undefined) throw new UsageError(usageLine());
  // Before anything is spawned, for every subcommand: a silent fallback to seat 0 from
  // a worktree picks another lane's project name, and `down` deletes what it finds.
  try {
    assertPortSeatChosen(REPOSITORY_ROOT, `pnpm dev:${command}`);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  run();
}

// Guarded so the pure helpers above can be imported without a Compose run firing.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    // Carry Docker's own exit status through rather than flattening it to 1.
    process.exitCode = error instanceof CommandFailed ? error.status : 1;
    process.stderr.write(`${describe(error)}\n`);
  }
}
