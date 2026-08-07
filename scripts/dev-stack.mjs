/**
 * dev-stack.mjs - stand up a real, local QCMS stack a human can open in a browser.
 *
 * Started life as `dev-portal.mjs` for the task-030 manual screen-reader pass, when
 * the only place a form got seeded and published was the Playwright e2e globalSetup,
 * which lives and dies with the test run. Issue #281 gave it a second front end: the
 * admin was the one app in the repo a human could not open by following the docs.
 * The two entry points (`scripts/dev-portal.mjs`, `scripts/dev-admin.mjs`) are thin
 * and this module holds everything, so the setup cannot drift into two versions.
 *
 * Whichever front end you ask for, the sequence is the same:
 *
 *   1. Bring up the dev Postgres (docker-compose.dev.yml, on this seat's 7S20) and
 *      migrate it to head (the same package-owned migration set adopters run).
 *   2. Seed AND PUBLISH the kitchen-sink form (frm_kitchen_sink) through the
 *      exact same publish pipeline the e2e seed uses - the published @qcms/db
 *      helpers (createQuestion / createQuestionVersion / createForm /
 *      insertFormVersion), storing the committed golden compiled A2UI verbatim
 *      (ADR-18). Idempotent: a re-run notices the form and skips.
 *   3. Start the API (node apps/api/dist/serve.js) and the requested front end
 *      (next dev), wired together over http with a shared, freshly-generated SEC-4
 *      internal token, and wait until both are serving.
 *   4. Print the exact URL to open, and how to stop everything.
 *
 * ## Why the API is always started here, and never assumed
 *
 * The SEC-4 internal token is generated in memory per run and written nowhere. That
 * is the property worth keeping, and it is exactly what makes "start the admin against
 * the API that is already up" unworkable: the only way to learn the running API's
 * token is to read it out of that process's environment by hand. So each entry point
 * starts its own API and hands the same in-memory value to both children
 * ({@link apiChildEnv} and {@link frontendChildEnv} take one `internalToken`). The
 * cost is that two entry points cannot run at one seat - they would both bind `7S10` -
 * which is the honest trade and is what `docs/PORTS.md` says. Run the second one at
 * another seat (`QCMS_PORT_SEAT=1 pnpm dev:admin`).
 *
 * Secrets are generated in memory per run and passed to the child processes via
 * the environment - never written to any file, and never echoed to the terminal
 * (SEC-8). The dev database password is the docker-compose dev default (not a real
 * credential), overridable via env.
 *
 * Usage:  pnpm dev:portal  |  pnpm dev:admin
 * Stop:   Ctrl+C (stops the API + front end). The Postgres container is left up;
 *         remove it with:  docker compose -f docker-compose.dev.yml down
 */

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publishedPortHost } from "./docker-host.mjs";
import { composeProjectName, stablePort } from "./ports.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

// ---------------------------------------------------------------------------
// Tunables (all overridable via env so the script never hard-codes a machine).
//
// The three ports come from this machine's SEAT (`QCMS_PORT_SEAT`, default 0) via
// `scripts/ports.mjs`, never from a literal here: seat S runs the human-facing stack
// on 7S00 / 7S10 / 7S20, and seat 0 is exactly today's 7000 / 7010 / 7020. The rule,
// the table and the reasoning are in `docs/PORTS.md`. The individual
// `QCMS_DEV_*_PORT` / `QCMS_DB_PORT` overrides still win where they are set, so an
// unusual machine can still move one service without moving the whole seat.
// ---------------------------------------------------------------------------
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT_NAME ?? composeProjectName();
const DB_PORT = process.env.QCMS_DB_PORT ?? String(stablePort("postgres"));
const DB_USER = process.env.QCMS_DB_USER ?? "qcms";
const DB_PASSWORD = process.env.QCMS_DB_PASSWORD ?? "qcms";
const DB_NAME = process.env.QCMS_DB_NAME ?? "qcms";
// Where this process reaches the dev Postgres.
//
// On a host checkout that is plain localhost. Inside the dev container it is
// not: `docker compose` there talks to the mounted host socket
// (docker-outside-of-docker, ADR-29), so the database starts as a SIBLING
// published on the host's loopback, and this container's own localhost has
// nothing on that port. The address that works is the default-route gateway.
//
// That resolution used to live here, and living HERE is why issue #316 existed:
// the full-stack Compose harness hit the identical problem 200 lines away and
// hardcoded localhost instead. It now lives in `scripts/docker-host.mjs`, which
// both call, so the two cannot drift apart again. `QCMS_DB_HOST` still wins for
// this script specifically, ahead of the shared resolution's own override.
function detectDbHost() {
  if (process.env.QCMS_DB_HOST) return process.env.QCMS_DB_HOST;
  return publishedPortHost();
}
const DB_HOST = detectDbHost();
const DATABASE_URL =
  process.env.DATABASE_URL ??
  `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

const API_PORT = process.env.QCMS_DEV_API_PORT ?? String(stablePort("api"));
const PORTAL_PORT = process.env.QCMS_DEV_PORTAL_PORT ?? String(stablePort("portal"));
// This seat's admin dev server (`7S40`). `pnpm dev:admin` listens on it, and the API is
// configured with its origin either way (task 056: better-auth lives in the API and
// scopes cookies to the admin's public origin), so `pnpm dev:portal` agrees with an
// admin started separately. Derived from the seat rather than written down, and
// overridable for a developer running the admin somewhere else - R8 is a rule about
// derivation (`docs/PORTS.md`).
const ADMIN_PORT = process.env.QCMS_DEV_ADMIN_PORT ?? String(stablePort("admin"));
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
const PORTAL_BASE_URL = `http://localhost:${PORTAL_PORT}`;
const ADMIN_BASE_URL = `http://localhost:${ADMIN_PORT}`;

const FORM_ID = "frm_kitchen_sink";
const FORM_SLUG = process.env.QCMS_DEV_FORM_SLUG ?? "kitchen-sink";

// The kitchen-sink form pins these library questions (see the ONE vehicle-domain
// definition at apps/api/e2e/support/fixtures/kitchen-sink-form.json - the same
// fixture the portal e2e seeds). Five map to the shared neutral kernel fixtures;
// the two unique to this form (optional cover, extra detail) live in the e2e
// support directory (043 neutral-domain rule). q_at_fault_accident is pinned at
// version 2, so it gets two versions (identical bytes), mirroring the e2e seed.
const QUESTIONS = [
  {
    id: "q_full_name",
    slug: "full-name",
    path: "packages/core/fixtures/questions/valid/short-text.json",
    versions: 1,
  },
  {
    id: "q_dob",
    slug: "dob",
    path: "packages/core/fixtures/questions/valid/date.json",
    versions: 1,
  },
  {
    id: "q_at_fault_accident",
    slug: "at-fault-accident",
    path: "packages/core/fixtures/questions/valid/boolean.json",
    versions: 2,
  },
  {
    id: "q_accident_count",
    slug: "accident-count",
    path: "packages/core/fixtures/questions/valid/number.json",
    versions: 1,
  },
  {
    id: "q_optional_cover",
    slug: "optional-cover",
    path: "apps/api/e2e/support/fixtures/q-optional-cover.json",
    versions: 1,
  },
  {
    id: "q_extra_detail",
    slug: "extra-detail",
    path: "apps/api/e2e/support/fixtures/q-extra-detail.json",
    versions: 1,
  },
  {
    id: "q_coverage_level",
    slug: "coverage-level",
    path: "packages/core/fixtures/questions/valid/single-choice.json",
    versions: 1,
  },
];

const IS_WINDOWS = process.platform === "win32";
const children = [];
let shuttingDown = false;

/**
 * How this run names itself in its own output: `dev-portal` or `dev-admin`, set by
 * {@link runDevStack}. Parameterised rather than fixed so the two entry points read
 * as themselves in a terminal, and so `pnpm dev:portal`'s output is byte-identical to
 * what it printed before this module existed.
 */
let label = "dev-stack";

function log(msg) {
  process.stdout.write(`[${label}] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[${label}] ERROR: ${msg}\n`);
  process.exit(1);
}

function readJson(relPath) {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), "utf8"));
}

function randomSecret() {
  // 32 random bytes -> 43-char base64url; >= config MIN_SECRET_LENGTH (32) and
  // free of whitespace/commas (the key-list parser splits on those). Synthetic,
  // generated per run, never persisted.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

async function waitFor(label, probe, { timeoutMs = 90_000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (shuttingDown) throw new Error("shutting down");
    try {
      if (await probe()) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out waiting for ${label}${lastErr ? `: ${lastErr.message}` : ""}`);
}

// ---------------------------------------------------------------------------
// 0. Ensure the workspace is built (the API runs from dist; the portal's dev
//    server and this seeder consume @qcms/* build output).
// ---------------------------------------------------------------------------
function ensureBuilt() {
  const needed = [
    "apps/api/dist/serve.js",
    "packages/db/dist/index.js",
    "packages/core/dist/index.js",
    "packages/ui/dist/index.js",
  ];
  if (needed.every((p) => existsSync(join(REPO_ROOT, p)))) return;
  log("build output missing; running pnpm build (one time)...");
  const res = spawnSync("pnpm", ["build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: IS_WINDOWS,
  });
  if (res.status !== 0) fail("pnpm build failed");
}

// ---------------------------------------------------------------------------
// 1. Dev Postgres up + migrated.
// ---------------------------------------------------------------------------
function composeUp() {
  log(
    `bringing up dev Postgres (docker-compose.dev.yml, project ${COMPOSE_PROJECT}, port ${DB_PORT})...`,
  );
  const res = spawnSync("docker", ["compose", "-f", "docker-compose.dev.yml", "up", "-d"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: IS_WINDOWS,
    env: {
      ...process.env,
      // Two Compose stacks sharing a project name ARE one stack, and moving only
      // the port does not share it - it TAKES it: same project plus a changed port
      // mapping makes `up -d` recreate the running container on the new port against
      // the same volume, so seat 0 loses its database mid-session and keeps dialling
      // a port nothing serves. Nothing errors on either side. The
      // project name is what makes a seat's database its own; `COMPOSE_PROJECT_NAME`
      // outranks the `name:` in the compose file, and named volumes are namespaced
      // by project. Seat 0 resolves to the unchanged `qcms-dev`.
      COMPOSE_PROJECT_NAME: COMPOSE_PROJECT,
      QCMS_DB_PORT: DB_PORT,
      QCMS_DB_USER: DB_USER,
      QCMS_DB_PASSWORD: DB_PASSWORD,
      QCMS_DB_NAME: DB_NAME,
    },
  });
  // Compose has already printed the real reason; do not guess at it.
  if (res.status !== 0) fail(`docker compose up failed (exit ${res.status}); see the error above`);
}

async function loadDbToolkit() {
  const require = createRequire(pathToFileURL(join(REPO_ROOT, "packages/db/package.json")));
  const db = await import(pathToFileURL(join(REPO_ROOT, "packages/db/dist/index.js")).href);
  const core = await import(pathToFileURL(join(REPO_ROOT, "packages/core/dist/index.js")).href);
  const { drizzle } = await import(
    pathToFileURL(require.resolve("drizzle-orm/node-postgres")).href
  );
  const { migrate } = await import(
    pathToFileURL(require.resolve("drizzle-orm/node-postgres/migrator")).href
  );
  const pg = (await import(pathToFileURL(require.resolve("pg")).href)).default;
  return { db, core, drizzle, migrate, pg };
}

async function migrateAndSeed(toolkit) {
  const { db, core, drizzle, migrate, pg } = toolkit;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  await waitFor("Postgres to accept connections", async () => {
    const client = await pool.connect();
    client.release();
    return true;
  });

  const handle = drizzle(pool, { schema: db.schema });

  log("migrating database to head...");
  await migrate(handle, { migrationsFolder: join(REPO_ROOT, "packages/db/migrations") });

  await seedKitchenSink({ handle, db, core });

  await pool.end();
}

// The publish pipeline, reused verbatim from the e2e insurance seed
// (apps/api/e2e/support/seed.ts): create each library question + its published
// version(s), create the form identity, then freeze one published form version
// storing the committed golden compiled A2UI (ADR-18: served verbatim, never
// recompiled).
async function seedKitchenSink({ handle, db, core }) {
  const existing = await db.getForm(handle, core.FormId.parse(FORM_ID));
  if (existing !== undefined) {
    log(`form ${FORM_ID} already seeded (slug "${existing.slug}"); skipping seed.`);
    return;
  }

  log("seeding + publishing the kitchen-sink form...");

  for (const q of QUESTIONS) {
    const questionId = core.QuestionId.parse(q.id);
    const definition = readJson(q.path);
    await ignoreDuplicate(() => db.createQuestion(handle, { questionId, slug: q.slug }));
    for (let v = 1; v <= q.versions; v += 1) {
      const created = await db.createQuestionVersion(handle, { questionId, definition });
      // Publish the version (the fixtures are "published" library questions).
      await db.publishQuestionVersion(handle, { questionId, version: created.version });
    }
  }

  await db.createForm(handle, {
    formId: core.FormId.parse(FORM_ID),
    slug: FORM_SLUG,
    defaultLocale: "en",
  });

  const definition = readJson("apps/api/e2e/support/fixtures/kitchen-sink-form.json");
  const golden = readJson("apps/api/e2e/support/fixtures/kitchen-sink.a2ui.json");
  await db.insertFormVersion(handle, {
    formId: core.FormId.parse(FORM_ID),
    definition,
    compiled: golden,
    compilerVersion: golden.compilerVersion,
    a2uiSpecVersion: golden.a2uiSpecVersion,
    semanticsVersion: "1",
  });

  log(`published ${FORM_ID} as slug "${FORM_SLUG}" (7 question types, 2 rules).`);
}

async function ignoreDuplicate(fn) {
  try {
    await fn();
  } catch (err) {
    // 23505 = unique_violation: the row already exists from a prior partial run.
    if (err && err.code === "23505") return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 3. Start the API and one front end, wired together.
// ---------------------------------------------------------------------------
function startChild(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    shell: IS_WINDOWS,
  });
  children.push({ name, child });
  const prefix = (line) => process.stdout.write(`[${name}] ${line}`);
  child.stdout.on("data", (d) => prefix(d.toString()));
  child.stderr.on("data", (d) => prefix(d.toString()));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      fail(`${name} exited unexpectedly (code ${code})`);
    }
  });
  return child;
}

/**
 * The API child's environment.
 *
 * Pure, and exported, so the property this whole module exists for is testable without
 * booting anything: the token handed to the API and the token handed to the front end
 * are one value (`dev-stack.test.ts`). Every secret arrives as an argument rather than
 * being generated here, for the same reason.
 *
 * @param {object} options
 * @param {string} options.databaseUrl
 * @param {string} options.apiPort
 * @param {string} options.portalBaseUrl
 * @param {string} options.adminBaseUrl
 * @param {string} options.internalToken the shared SEC-4 token, in memory only.
 * @param {string} options.linkKeys
 * @param {string} options.sessionKeys
 * @param {string} options.appKey
 * @param {string} options.adminAuthSecret
 * @returns {Record<string, string>}
 */
export function apiChildEnv({
  databaseUrl,
  apiPort,
  portalBaseUrl,
  adminBaseUrl,
  internalToken,
  linkKeys,
  sessionKeys,
  appKey,
  adminAuthSecret,
}) {
  return {
    DATABASE_URL: databaseUrl,
    QCMS_MOUNT: "all",
    PORT: apiPort,
    QCMS_PORTAL_BASE_URL: portalBaseUrl,
    QCMS_INTERNAL_TOKEN: internalToken,
    QCMS_LINK_KEYS: linkKeys,
    QCMS_SESSION_KEYS: sessionKeys,
    QCMS_APP_KEY: appKey,
    // `QCMS_MOUNT: "all"` includes the admin surface, and since task 056 that surface
    // carries better-auth - so this process needs the two values the instance is
    // configured from, or `loadConfig` refuses to boot and the child dies at startup.
    //
    // PIN THIS if you are working on the admin. Unlike the three keys above, a fresh
    // value here does more than invalidate cookies: it makes an existing TOTP
    // enrolment permanently unverifiable. `two-factor/enable` stores the TOTP secret
    // ENCRYPTED under this value (better-auth 1.6.25,
    // `dist/plugins/two-factor/index.mjs:105`, `symmetricEncrypt({ key:
    // ctx.context.secretConfig, ... })`) and every verify decrypts with the *current*
    // one (`dist/plugins/two-factor/totp/index.mjs:188`, and `:122` for the URI
    // reveal), so after a restart with a new secret the authenticator's codes are
    // rejected forever. Recovery codes still work - they are stored as plain JSON
    // unless `storeBackupCodes: "encrypted"` is set, which `features/auth/instance.ts`
    // does not (`dist/plugins/two-factor/backup-codes/index.mjs:45`) - but there are
    // only ten of them (`:15`, `amount ?? 10`), the admin has no re-enrolment screen,
    // and each restart burns one. Ten restarts kill the account in that database.
    //
    // So: honoured from the environment when set, exactly like DATABASE_URL and the
    // ports above, and random only for a zero-config first run. Pin it and an enrolled
    // admin survives restarts; leave it unset and expect to re-bootstrap. `pnpm
    // dev:admin` says so on startup when it is unset, because that is the run where it
    // costs something.
    //
    // It deliberately does NOT have to match the value passed to
    // `pnpm qcms:create-admin`: that command creates an account (salted password hash,
    // secret-independent) and enrols no factor, and it revokes the one session it mints,
    // so nothing it writes is ever decrypted by this process.
    QCMS_ADMIN_AUTH_SECRET: adminAuthSecret,
    // The admin dev server's origin: this seat's stable admin port (`docs/PORTS.md`),
    // which is what `pnpm dev:admin` listens on. better-auth scopes its cookies to it
    // and trusts no other origin, so the admin child below is handed the same value and
    // the two agree by construction. `pnpm dev:portal` sets it too, so an admin started
    // separately against that API still matches.
    QCMS_ADMIN_BASE_URL: adminBaseUrl,
  };
}

async function startApi(internalToken) {
  log(`starting API on ${API_BASE_URL} ...`);
  startChild(
    "api",
    "node",
    ["apps/api/dist/serve.js"],
    apiChildEnv({
      databaseUrl: DATABASE_URL,
      apiPort: API_PORT,
      portalBaseUrl: PORTAL_BASE_URL,
      adminBaseUrl: ADMIN_BASE_URL,
      internalToken,
      linkKeys: randomSecret(),
      sessionKeys: randomSecret(),
      appKey: randomSecret(),
      adminAuthSecret: process.env.QCMS_ADMIN_AUTH_SECRET ?? randomSecret(),
    }),
  );
  await waitFor("API health", async () => {
    const res = await fetch(`${API_BASE_URL}/health`);
    return res.ok;
  });
  log("API is healthy.");
}

/**
 * The environment for one front-end child.
 *
 * Pure and exported for the same reason as {@link apiChildEnv}. Two properties are
 * asserted in `dev-stack.test.ts` rather than left to review:
 *
 *   - the `QCMS_INTERNAL_TOKEN` matches the API's, which is the whole point of a
 *     combined launcher (issue #281);
 *   - the **admin** env carries no `DATABASE_URL`. Task 056 took the database handle
 *     out of the admin (ADR-35), and `apps/admin/lib/server/r2-import-surface.test.ts`
 *     guards the import side of that. Handing one back here would re-entrench it
 *     through the environment instead, which no import test can see.
 *
 * @param {"portal" | "admin"} frontend
 * @param {object} options
 * @param {string} options.apiBaseUrl
 * @param {string} options.internalToken
 * @param {string} options.portalBaseUrl
 * @param {string} options.adminBaseUrl
 * @returns {Record<string, string>}
 */
export function frontendChildEnv(
  frontend,
  { apiBaseUrl, internalToken, portalBaseUrl, adminBaseUrl },
) {
  const shared = {
    QCMS_API_BASE_URL: apiBaseUrl,
    QCMS_INTERNAL_TOKEN: internalToken,
    NODE_ENV: "development",
  };
  if (frontend === "admin") {
    return {
      ...shared,
      // The admin's own public origin. It reads it for the SEC-9 origin check on every
      // state-changing POST, and the API reads the same value as better-auth's
      // `baseURL`, so both sides of the proxied hop agree on which origin the cookies
      // belong to. That is the entire configuration of the admin since task 056: an
      // API address, the SEC-4 token, and this. No database URL, no auth secret.
      QCMS_ADMIN_BASE_URL: adminBaseUrl,
    };
  }
  return {
    ...shared,
    // The Start BFF route builds its 303 redirect against the public portal
    // origin (apps/portal/lib/server/config.ts), and that read is required: with
    // it unset the respondent's first click 500s instead of opening a session.
    // The API child above is handed the same value for its own link building.
    QCMS_PORTAL_BASE_URL: portalBaseUrl,
  };
}

/**
 * What each front end is called, where it listens, and how to tell it is really
 * serving.
 *
 * The readiness probe is a **page a human would open**, never a health endpoint, and
 * that is deliberate on both entries. `next dev` compiles routes on first hit, so a
 * cheap endpoint can answer while the page a person wants is still a compile away; and
 * for the admin specifically, a 200 from `/healthz` would prove nothing about the thing
 * issue #281 is about. `/sign-in` is the admin's own first screen and needs no session.
 *
 * @type {Record<"portal" | "admin", { pkg: string; port: string; baseUrl: string; readyPath: string; readyLabel: string }>}
 */
const FRONTENDS = {
  portal: {
    pkg: "qcms-portal",
    port: PORTAL_PORT,
    baseUrl: PORTAL_BASE_URL,
    readyPath: `/f/${FORM_SLUG}`,
    readyLabel: "portal to serve the entry page",
  },
  admin: {
    pkg: "qcms-admin",
    port: ADMIN_PORT,
    baseUrl: ADMIN_BASE_URL,
    readyPath: "/sign-in",
    readyLabel: "admin to serve the sign-in page",
  },
};

async function startFrontend(frontend, internalToken) {
  const spec = FRONTENDS[frontend];
  log(`starting ${frontend} (next dev) on ${spec.baseUrl} ...`);
  startChild(
    frontend,
    "pnpm",
    ["--filter", spec.pkg, "dev", "--port", spec.port],
    frontendChildEnv(frontend, {
      apiBaseUrl: API_BASE_URL,
      internalToken,
      portalBaseUrl: PORTAL_BASE_URL,
      adminBaseUrl: ADMIN_BASE_URL,
    }),
  );
  await waitFor(
    spec.readyLabel,
    async () => {
      const res = await fetch(`${spec.baseUrl}${spec.readyPath}`);
      return res.ok;
    },
    { timeoutMs: 120_000 },
  );
  log(`${frontend} is serving.`);
}

// ---------------------------------------------------------------------------
// Shutdown.
// ---------------------------------------------------------------------------
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write("\n");
  log(`received ${signal}; stopping ${children.map((c) => c.name).join(" + ")}...`);
  for (const { child } of children) {
    if (child.pid === undefined) continue;
    try {
      if (IS_WINDOWS) {
        // next dev and the shell wrapper spawn a tree of grandchildren that a
        // plain child.kill() leaves orphaned; taskkill /T kills the whole tree.
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // already gone
    }
  }
  log("stopped. The Postgres container is still running.");
  log(
    `Remove it with:  COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT} docker compose -f docker-compose.dev.yml down`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The closing banner.
// ---------------------------------------------------------------------------

/**
 * The `pnpm qcms:create-admin` line to print, or `undefined` when the dev database
 * password is not the docker-compose default.
 *
 * A developer who set `QCMS_DB_PASSWORD` set it to something of their own, and
 * printing a connection string containing it would echo a credential to the terminal
 * (SEC-8). In that case the caller prints the shape and lets them fill it in.
 *
 * The auth secret in the printed command is generated inline and is deliberately NOT
 * the running API's: `create-admin` validates the value and never uses it (salted
 * password hash, no factor enrolled, the one session it mints is revoked), so the two
 * do not have to match. See `apps/admin/README.md`.
 *
 * @returns {string | undefined}
 */
function databaseUrlLine() {
  if (DB_PASSWORD !== "qcms") return undefined;
  return `DATABASE_URL=${DATABASE_URL} \\`;
}

function printPortalBanner() {
  const url = `${PORTAL_BASE_URL}/f/${FORM_SLUG}`;
  process.stdout.write(
    [
      "",
      "==================================================================",
      "  Portal is up. Open the kitchen-sink form as a respondent:",
      "",
      `      ${url}`,
      "",
      "  Click Start to walk the flow (every question type + 2 branch rules).",
      "  Use this for the task-030 manual screen-reader accessibility pass.",
      "",
      "  Stop:  press Ctrl+C  (stops the API + portal)",
      `  Then:  COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT} docker compose -f docker-compose.dev.yml down   (removes the DB)`,
      "==================================================================",
      "",
    ].join("\n") + "\n",
  );
}

function printAdminBanner() {
  const databaseLine = databaseUrlLine() ?? "DATABASE_URL=<your dev database URL> \\";
  process.stdout.write(
    [
      "",
      "==================================================================",
      "  Admin is up. Open the authoring app:",
      "",
      `      ${ADMIN_BASE_URL}`,
      "",
      "  Sign in with an admin account. There is no self-registration path",
      "  (SEC-1), so if this database has no admin yet, create one from",
      "  another terminal:",
      "",
      `      ${databaseLine}`,
      `        QCMS_ADMIN_BASE_URL=${ADMIN_BASE_URL} \\`,
      '        QCMS_ADMIN_AUTH_SECRET="$(node -e \'const{randomBytes}=require("node:crypto");console.log(randomBytes(32).toString("base64url"))\')" \\',
      "        QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD='a long passphrase' \\",
      "        pnpm qcms:create-admin",
      "",
      "  TOTP enrolment is required by default (SEC-1). To skip it while",
      "  developing, start this with QCMS_ADMIN_2FA=optional (the API and the",
      "  admin both read it, so one setting moves both).",
      "",
      "  Stop:  press Ctrl+C  (stops the API + admin)",
      `  Then:  COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT} docker compose -f docker-compose.dev.yml down   (removes the DB)`,
      "==================================================================",
      "",
    ].join("\n") + "\n",
  );
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

/**
 * Bring up the dev database, the API, and one front end, and print how to open it.
 *
 * Never returns while the stack is healthy: the child processes keep the event loop
 * alive until Ctrl+C.
 *
 * @param {object} options
 * @param {"portal" | "admin"} options.frontend which front end to start.
 * @param {string} options.name how this run names itself in its own output.
 * @returns {Promise<void>}
 */
export async function runDevStack({ frontend, name }) {
  label = name;
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    // Said before anything is built, so it is still on screen when the stack is up: an
    // unpinned secret is only expensive once an account has enrolled a factor.
    if (frontend === "admin" && (process.env.QCMS_ADMIN_AUTH_SECRET ?? "") === "") {
      log(
        "QCMS_ADMIN_AUTH_SECRET is not set, so the API gets a fresh one this run. " +
          "An existing TOTP enrolment will not verify against it (see apps/admin/README.md); " +
          "export a stable value before starting to keep one alive across restarts.",
      );
    }

    ensureBuilt();
    composeUp();
    const toolkit = await loadDbToolkit();
    await migrateAndSeed(toolkit);

    // One value, both children. It exists only in this process's memory and in the two
    // environments it hands out, which is why the API cannot be started separately and
    // then joined: nothing outside this process can learn the token (issue #281).
    const internalToken = randomSecret();
    await startApi(internalToken);
    await startFrontend(frontend, internalToken);

    if (frontend === "admin") printAdminBanner();
    else printPortalBanner();
  } catch (err) {
    if (!shuttingDown) fail(err.stack ?? String(err));
  }
}
