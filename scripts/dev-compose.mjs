// @ts-check
/**
 * `pnpm dev:up` / `pnpm dev:down` - the whole local stack, with the developer
 * toolbox, ready to sign in to.
 *
 * The bar this exists to clear: on a machine with nothing running, `pnpm dev:up`
 * returns and you can open the admin in a browser and **sign in**, with a credential
 * the command printed. No hand-assembled database URL, no bootstrap step to remember,
 * no reading two documents to find out which of six ways of starting QCMS this is.
 *
 * What it brings up is the solo topology plus the opt-in toolbox overlay:
 *
 *   docker compose -f docker-compose.yml -f docker-compose.dev-tools.yml
 *
 * so four containers a person can open (portal, admin, Grafana, pgweb) and three
 * they cannot (api, postgres, and the collector inside `lgtm`).
 *
 * ## Which stack this is, and which it is not
 *
 * QCMS has three Compose stacks and confusing them is the expensive mistake in this
 * area, so they are named here once:
 *
 *   - **`docker-compose.dev.yml`**, project `qcms-dev` (per seat), one Postgres on
 *     `7S20`. This is what `pnpm dev:portal` and `pnpm dev:admin` run against, with
 *     the API and the front end as ordinary processes on your machine.
 *   - **`docker-compose.yml`**, the solo topology, with a Postgres of **its own**
 *     that is never published. This file drives it, with the toolbox overlaid.
 *   - the same solo topology under `-full-stack-e2e`, thrown away per run by
 *     `scripts/compose-e2e.mjs`.
 *
 * The first two have *different databases*, which is the detail that bites: an
 * administrator created against the `7S20` dev database is invisible to this stack,
 * and the symptom is a sign-in that fails with nothing wrong anywhere it is looked
 * for. So the bootstrap here runs `create-admin` **inside this stack's `api`
 * container**, through the step `compose-e2e.mjs` already uses
 * (`scripts/compose-admin.mjs`).
 *
 * ## Seats, and why the project name matters more than the ports
 *
 * Ports come from this seat's stable block via `scripts/ports.mjs` and are never
 * written here (R8, `docs/PORTS.md`): `7S00` portal, `7S40` admin, `7S50` Grafana,
 * `7S60` pgweb. The project name comes from the same module for the same reason
 * (`localStackProjectName`): two Compose stacks sharing a project name ARE one
 * stack, so a wrong one means `dev:down` tears down nothing, or tears down another
 * lane's. Seat 0 is `qcms-local-stack`, which a person recognises in
 * `docker compose ls` and which collides with neither the dev database nor the e2e
 * stack.
 *
 * A linked worktree with no `QCMS_PORT_SEAT` is refused rather than defaulted
 * (issue #296), by the same guard the e2e harness uses: this command runs
 * `down --volumes --remove-orphans`, so a silently adopted seat 0 would not merely
 * read another lane's stack, it would delete it.
 *
 * Usage:  pnpm dev:up  |  pnpm dev:down
 */

import { closeSync, fchmodSync, fstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createFirstAdmin, generatePassword } from "./compose-admin.mjs";
import { CommandFailed, DOCKER, REPOSITORY_ROOT, runProcess } from "./docker.mjs";
import { isInDockerContainer } from "./docker-host.mjs";
import { assertPortSeatChosen, localStackProjectName, stablePort } from "./ports.mjs";

/** The base topology and the toolbox overlay, in overlay order. */
export const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.dev-tools.yml"];

/**
 * Where the operator-shaped secrets come from.
 *
 * Compose's own default file, and named explicitly rather than left to the implicit
 * load so the error when it is missing names it. `.env.compose.example` is the
 * template; `docs/DEVELOPER_GUIDE.md` is where the one variable that is NOT in that
 * template (`QCMS_DB_VIEWER_PASSWORD`) is documented.
 */
export const ENV_FILE = ".env";

/**
 * Where `QCMS_ADMIN_AUTH_SECRET` is pinned across restarts.
 *
 * Gitignored by the existing `.env.*` rule, and separate from `.env` on purpose:
 * `.env` is a copy of an operator template that a developer may re-copy, and this
 * value is the one in the set that must NOT change once an account has enrolled.
 * See {@link pinAdminAuthSecret}.
 */
export const ADMIN_SECRET_FILE = ".env.dev-admin";

/** The variables this command supplies itself, so a preflight must not demand them. */
export const SUPPLIED_VARIABLES = [
  "QCMS_PORTAL_BASE_URL",
  "QCMS_ADMIN_BASE_URL",
  "QCMS_ADMIN_AUTH_SECRET",
];

/** The generated administrator's address. Overridable, and `.test` is reserved (RFC 6761). */
const DEFAULT_ADMIN_EMAIL = "dev@qcms.test";

/**
 * Every `${NAME:?...}` variable in a Compose file: the ones Compose refuses to
 * interpolate rather than default.
 *
 * Scanned rather than listed, so a `:?` added to either file tomorrow is preflighted
 * without anyone remembering to come back here. A hand-kept copy of this list is
 * exactly the drift `docs/PORTS.md` argues against for ports, for the same reason.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function requiredVariablesIn(text) {
  const found = new Set();
  for (const match of text.matchAll(/\$\{([A-Z0-9_]+):\?/g)) found.add(match[1]);
  return [...found];
}

/**
 * The variables the developer has to supply, in file order, deduplicated.
 *
 * @param {readonly string[]} [files] repo-relative Compose files.
 * @returns {string[]}
 */
export function requiredVariables(files = COMPOSE_FILES) {
  const supplied = new Set(SUPPLIED_VARIABLES);
  const names = new Set();
  for (const file of files)
    for (const name of requiredVariablesIn(readFileSync(join(REPOSITORY_ROOT, file), "utf8")))
      if (!supplied.has(name)) names.add(name);
  return [...names];
}

/**
 * The `KEY=VALUE` pairs in an env file, for the preflight and for nothing else.
 *
 * Deliberately naive: it ignores comments and blank lines and strips one layer of
 * surrounding quotes, and it does not implement Compose's full `.env` grammar. It
 * does not have to, and it must not be relied on as if it did - **Compose reads the
 * file itself**, and this parse only decides whether to print a helpful message
 * before handing over. A value this misreads is still passed to Compose verbatim,
 * so the worst case is a preflight that lets something through, never a stack
 * configured from a bad parse.
 *
 * @param {string} text
 * @returns {Record<string, string>}
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

/**
 * The variables that are still missing, given the file and the ambient environment.
 *
 * @param {readonly string[]} required
 * @param {Record<string, string | undefined>} fileValues
 * @param {NodeJS.ProcessEnv} environment
 * @returns {string[]}
 */
export function missingVariables(required, fileValues, environment) {
  return required.filter((name) => {
    const value = environment[name] ?? fileValues[name] ?? "";
    return value.trim() === "";
  });
}

/**
 * The message a developer gets instead of Compose's own.
 *
 * Compose's is one line per variable, emitted from inside an interpolation pass, and
 * it names neither where the value is supposed to live nor which of the two files
 * documents it. `QCMS_DB_VIEWER_PASSWORD` is the sharp case: it is deliberately
 * absent from `.env.compose.example` (that file is the operator's, and the toolbox is
 * a developer's), so the obvious "copy the example" does not produce it and the
 * reader has no way to discover that from the error.
 *
 * No value is ever invented here, and that is a control rather than an omission. The
 * viewer password in particular is undefaulted in the overlay so that a read-only
 * database client cannot be stood up by accident; a default picked in this file
 * would put one in everybody's stack and undo that in a way no test would notice.
 *
 * Pure and exported so the text is asserted rather than reviewed.
 *
 * @param {readonly string[]} missing
 * @param {boolean} envFileExists
 * @returns {string}
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

/** What a file holding a secret is allowed to be, at most. */
const OWNER_ONLY = 0o600;

/**
 * Read the pin file and make it owner-only, both through ONE file descriptor.
 *
 * The descriptor is the point, not an implementation detail. The obvious spelling of
 * each half is a check-then-use race on a path: `existsSync` then `readFileSync`
 * (which CodeQL flags as `js/file-system-race`, correctly), and `statSync` then
 * `chmodSync`, which is the same mistake again and would simply move the alert. A
 * descriptor is bound to the inode at `open`, so `readFileSync(fd)`, `fstatSync(fd)`
 * and `fchmodSync(fd)` all act on the file that was opened, whatever happens to the
 * name meanwhile. There is no window to lose.
 *
 * Only `ENOENT` means "no pin yet". Anything else - a directory in the way, a
 * permission problem - is rethrown, because silently regenerating on those would
 * overwrite a secret this process could not read, which is the enrolment-destroying
 * outcome the pin exists to prevent.
 *
 * @param {string} path
 * @returns {{ secret: string; tightenedFrom?: string } | undefined}
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
      // Preserve the owner's own bits and clear everyone else's, rather than forcing
      // 0600: a developer who deliberately made it 0400 asked for read-only, and
      // "tighten" must never be a way of adding a write bit back.
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
 * Write the pin file and leave it owner-only, through ONE file descriptor.
 *
 * The `mode` argument to `open` shares `writeFileSync`'s limitation: it applies only
 * when the call CREATES the file, and is ignored on one that already exists. That is
 * not a corner case here - the regenerate path runs precisely when a pin file exists
 * but holds nothing usable - so the permission is SET afterwards rather than
 * requested, and set on the descriptor rather than on the name, so it lands on the
 * bytes just written whatever the path resolves to by then. Same reasoning as
 * {@link readAndSecurePinFile}, and it keeps one story for the whole function.
 *
 * @param {string} path
 * @param {string} secret
 * @returns {void}
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
 * Pin `QCMS_ADMIN_AUTH_SECRET`, generating one on first use.
 *
 * Left unset, the API generates a fresh secret every boot, and that costs more than
 * a lost session: better-auth stores the enrolled TOTP secret ENCRYPTED under this
 * value and decrypts with the *current* one, so a restart makes an existing
 * authenticator permanently unverifiable and burns one of ten recovery codes. The
 * admin ships no re-enrolment screen. `apps/admin/README.md` and
 * `.env.compose.example` carry the full account, checked against better-auth's own
 * source rather than inferred.
 *
 * So this command never lets it float. Precedence, and each rung is reported to the
 * developer so an unexpected value is visible rather than mysterious:
 *
 *   1. the ambient environment, when a developer has exported one;
 *   2. `.env.dev-admin`, which is where a previous run put it;
 *   3. a fresh 32-byte value, written there.
 *
 * `.env` is deliberately NOT one of the rungs. A developer who copies
 * `.env.compose.example` again gets that file's placeholder back, and a placeholder
 * silently replacing a pinned secret is the exact failure this exists to prevent.
 * Passing the pinned value in the child environment makes it win over the file for
 * Compose's interpolation.
 *
 * ## The file is made owner-only on EVERY path, not just when it is created
 *
 * `writeFileSync`'s `mode` option applies only when the call creates the file; on an
 * existing one it is silently ignored. Measured rather than assumed: a file created
 * at 0644 and rewritten with `{ mode: 0o600 }` is still 0644 afterwards. So `mode`
 * alone protects exactly the case that needs it least - the file this command just
 * made - and does nothing for the two that matter: a pin file some earlier hand
 * created world-readable, and a rewrite of one. The repository root of this very
 * machine has a `.env.dev-admin` at 0644 holding a live secret, so this is a
 * condition that exists rather than one that might.
 *
 * Both halves are therefore explicit: the write path chmods unconditionally, and the
 * read path tightens what it finds and says so. A comment claiming 0600 while the
 * call delivers 0644 is worse than no claim.
 *
 * @param {object} [io]
 * @param {NodeJS.ProcessEnv} [io.environment]
 * @param {string} [io.path] absolute path to the pin file.
 * @returns {{ secret: string; source: "environment" | "file" | "generated"; tightenedFrom?: string }}
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

/**
 * What to tell the developer about where the pinned secret came from.
 *
 * Pure and exported so the SEC-8 property is a test rather than a reviewer's promise:
 * these lines name the variable, the file and the mode, and never the value.
 *
 * @param {{ source: "environment" | "file" | "generated"; tightenedFrom?: string }} pin
 * @param {string} [file]
 * @returns {string[]}
 */
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

/**
 * This seat's four published ports, derived and never written down (R8).
 *
 * @param {number} [seat]
 * @returns {{ portal: number; admin: number; observability: number; dbViewer: number }}
 */
export function seatPorts(seat) {
  return {
    portal: stablePort("portal", seat),
    admin: stablePort("admin", seat),
    observability: stablePort("observability", seat),
    dbViewer: stablePort("dbViewer", seat),
  };
}

/**
 * What this command hands Compose on top of `.env`.
 *
 * Pure and exported so two properties are tests rather than review notes: the two
 * base URLs agree with the two published ports (better-auth trusts the admin origin
 * and no other, so a disagreement is a sign-in that redirects forever), and the bind
 * address is loopback whatever the file said.
 *
 * That last one is an override rather than a pass-through, unlike every other value
 * here. `QCMS_BIND_ADDRESS` is legitimately `0.0.0.0` for an operator with a separate
 * ingress host, and `.env` is a copy of the operator's template - but this stack
 * prints a plaintext administrator credential and runs a Grafana whose login is
 * `admin`/`admin`. There is no developer machine on which publishing that to every
 * reachable network is right, which is the same reasoning
 * `docker-compose.dev-tools.yml` uses to write the address into its own publishes
 * rather than read it from a variable.
 *
 * @param {object} options
 * @param {{ portal: number; admin: number; observability: number; dbViewer: number }} options.ports
 * @param {string} options.adminAuthSecret
 * @returns {Record<string, string>}
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
 * The closing banner: everything a developer needs next, and the three things that
 * look broken and are not.
 *
 * Pure and exported so what a developer reads is asserted (`dev-compose.test.ts`),
 * including the SEC-8 property that the only credential on screen is the local
 * administrator one this command generated - never the database password, the link
 * or session keys, or the internal token.
 *
 * @param {object} options
 * @param {{ portal: number; admin: number; observability: number; dbViewer: number }} options.ports
 * @param {string} options.project
 * @param {{ email: string; password: string } | undefined} options.credentials `undefined` when an admin already existed.
 * @param {boolean} options.inContainer
 * @returns {string[]}
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
    lines.push(
      "  Sign in to the admin with the account this run created:",
      "",
      `      email     ${credentials.email}`,
      `      password  ${credentials.password}`,
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
    "  Grafana logs in with admin / admin (the image's own default). Application",
    "  logs are under Explore -> Loki for qcms-admin, qcms-portal and qcms-api.",
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

/**
 * A bad or missing subcommand: a user error, so it prints without a stack trace.
 */
class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * This seat's stack, computed ONCE so `up` and `down` cannot disagree.
 *
 * A `down` that derived the name a second time and got it wrong would silently
 * remove nothing and leave a developer with a stack the documented command cannot
 * stop, so both subcommands read this constant and neither builds a name of its own.
 *
 * `COMPOSE_PROJECT_NAME` still outranks it, the same way it does in
 * `scripts/dev-stack.mjs`: it is Compose's own escape hatch, and a developer who set
 * it meant it. Seat 0 is `qcms-local-stack`, which collides with neither the dev
 * database (`qcms-dev`) nor the e2e stack (`qcms-dev-full-stack-e2e`), so
 * `down --volumes` here cannot reach either.
 */
const project = process.env.COMPOSE_PROJECT_NAME ?? localStackProjectName();

/**
 * The argv prefix every Compose call in this file shares.
 *
 * The `--env-file` is attached only when the file is there: passing it for a file
 * that does not exist is an error from Compose, and `down` has to keep working in
 * exactly that state (see {@link teardownPlaceholders}). Whether it is there comes
 * from the caller's one read of it ({@link envFileState}) rather than a second probe.
 * The project name and the file list never vary, which is what makes `down` address
 * what `up` created.
 *
 * @param {boolean} hasEnvFile
 * @returns {string[]}
 */
function composeArgs(hasEnvFile) {
  const args = ["compose", "--project-name", project];
  if (hasEnvFile) args.push("--env-file", ENV_FILE);
  for (const file of COMPOSE_FILES) args.push("--file", file);
  return args;
}

/**
 * @param {Record<string, string>} overrides
 * @returns {NodeJS.ProcessEnv}
 */
function composeEnvironment(overrides) {
  return { ...process.env, ...overrides };
}

/** @param {string} message */
function log(message) {
  process.stdout.write(`[dev-stack] ${message}\n`);
}

/**
 * What `.env` currently holds, read ONCE.
 *
 * One read rather than an `existsSync` and a `readFileSync`, for the reason spelled
 * out on {@link readAndSecurePinFile}: the two-step spelling is a check-then-use race
 * and reads as though the file could not change between them. Its `exists` also
 * decides whether `--env-file` is passed, so a single answer drives both and they
 * cannot disagree.
 *
 * @returns {{ exists: boolean; values: Record<string, string> }}
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

/**
 * Fail before Compose does, with a message that names the fix. `up` only.
 *
 * Deliberately not run for `down`: see {@link teardownPlaceholders}.
 */
function preflight({ exists, values }) {
  const missing = missingVariables(requiredVariables(), values, process.env);
  if (missing.length > 0) throw new UsageError(preflightMessage(missing, exists));
}

/**
 * Placeholder values so a teardown can never be blocked by configuration.
 *
 * Compose interpolates the same files on the way down as on the way up, so a `.env`
 * that has since been edited, emptied or deleted would make `docker compose down`
 * fail on a `:?` variable - leaving a developer holding a running stack that the
 * documented command cannot stop. That is the worst failure this command has, and it
 * is entirely avoidable: **nothing on the teardown path reads these values.** No
 * container is started, and the containers that held them are what is being removed.
 * What Compose actually removes comes from the project label and from the volume and
 * network *declarations*, none of which any of these values can reach.
 *
 * Only genuinely missing variables are filled, so a real `.env` still supplies its
 * own values and this is invisible in the normal case.
 *
 * @param {readonly string[]} required
 * @param {Record<string, string | undefined>} fileValues
 * @param {NodeJS.ProcessEnv} environment
 * @returns {Record<string, string>}
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
    // Generated per run unless the developer supplied one. Never a value written in
    // this repository: a committed credential is a credential in every clone.
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

export function down() {
  // No preflight. A teardown that refuses because a value went missing leaves a
  // running stack the documented command cannot stop; `teardownPlaceholders` fills
  // whatever is absent instead, and nothing on this path reads any of it.
  const envFile = envFileState();
  const environment = composeEnvironment({
    ...teardownPlaceholders(requiredVariables(), envFile.values, process.env),
    ...devStackEnvironmentOverrides({
      ports: seatPorts(),
      adminAuthSecret: "unused-during-teardown",
    }),
  });
  // The same project and the same file list the `up` used, or this removes nothing.
  // `--volumes` takes this stack's database with it, which is what makes the next
  // `dev:up` a genuinely fresh start (including a re-runnable first-admin bootstrap);
  // `--remove-orphans` takes the overlay's containers, which are orphans of the base
  // file and are otherwise left behind.
  log(`removing project ${project} (containers, network, volumes, orphans) ...`);
  runProcess(
    DOCKER,
    [...composeArgs(envFile.exists), "down", "--volumes", "--remove-orphans"],
    environment,
  );
}

/**
 * What to print for a failure.
 *
 * A `UsageError` is the reader's own mistake and a stack trace would bury the one
 * line that matters. A `CommandFailed` means Compose or Docker already printed the
 * real reason immediately above, so repeating a Node stack on top of it is noise.
 * Everything else is unexpected and keeps its stack.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describe(error) {
  if (error instanceof UsageError || error instanceof CommandFailed) return error.message;
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function main() {
  const command = process.argv[2];
  // Before anything is spawned, and for both subcommands. A silent fallback to seat
  // 0 from a worktree would pick another lane's Compose project name, and `down`
  // deletes what it finds under it (issue #296).
  try {
    assertPortSeatChosen(REPOSITORY_ROOT, `pnpm ${command === "down" ? "dev:down" : "dev:up"}`);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (command === "up") up();
  else if (command === "down") down();
  else throw new UsageError("Usage: node scripts/dev-compose.mjs <up|down>");
}

// Only when run as a command, so the pure helpers above can be imported by
// `dev-compose.test.ts` without a Compose run firing on import. Same guard as
// `compose-e2e.mjs` and `check-ports.mjs`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    // Carry Docker's own exit status through, so a caller scripting this sees what
    // Compose reported rather than a flattened 1.
    process.exitCode = error instanceof CommandFailed ? error.status : 1;
    process.stderr.write(`${describe(error)}\n`);
  }
}
