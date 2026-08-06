/**
 * dev-portal.mjs - stand up a real, local respondent portal serving a published
 * form, for the task-030 manual screen-reader accessibility pass.
 *
 * Right now the only place a form gets seeded and published is the Playwright
 * e2e globalSetup, which lives and dies with the test run. This script makes it
 * a repeatable thing a human can drive:
 *
 *   1. Bring up the dev Postgres (docker-compose.dev.yml, on this seat's 7S20) and
 *      migrate it to head (the same package-owned migration set adopters run).
 *   2. Seed AND PUBLISH the kitchen-sink form (frm_kitchen_sink) through the
 *      exact same publish pipeline the e2e seed uses - the published @qcms/db
 *      helpers (createQuestion / createQuestionVersion / createForm /
 *      insertFormVersion), storing the committed golden compiled A2UI verbatim
 *      (ADR-18). Idempotent: a re-run notices the form and skips.
 *   3. Start the API (node apps/api/dist/serve.js) and the portal (next dev),
 *      wired together over http with a shared, freshly-generated SEC-4 internal
 *      token, and wait until both are healthy.
 *   4. Print the exact respondent URL to open, and how to stop everything.
 *
 * Secrets are generated in memory per run and passed to the child processes via
 * the environment - never written to any file. The dev database password is the
 * docker-compose dev default (not a real credential), overridable via env.
 *
 * Usage:  pnpm dev:portal
 * Stop:   Ctrl+C (stops the API + portal). The Postgres container is left up;
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
// The admin is not started here, but the API is configured with its origin (task 056:
// better-auth lives in the API and scopes cookies to the admin's public origin). Derived
// from the seat rather than written down, and overridable for a developer running the
// admin on another port - R8 is a rule about derivation (`docs/PORTS.md`).
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

function log(msg) {
  process.stdout.write(`[dev-portal] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[dev-portal] ERROR: ${msg}\n`);
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
// 3. Start the API and the portal, wired together.
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

async function startApi(internalToken) {
  log(`starting API on ${API_BASE_URL} ...`);
  startChild("api", "node", ["apps/api/dist/serve.js"], {
    DATABASE_URL,
    QCMS_MOUNT: "all",
    PORT: API_PORT,
    QCMS_PORTAL_BASE_URL: PORTAL_BASE_URL,
    QCMS_INTERNAL_TOKEN: internalToken,
    QCMS_LINK_KEYS: randomSecret(),
    QCMS_SESSION_KEYS: randomSecret(),
    QCMS_APP_KEY: randomSecret(),
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
    // admin survives restarts; leave it unset and expect to re-bootstrap.
    //
    // It deliberately does NOT have to match the value passed to
    // `pnpm qcms:create-admin`: that command creates an account (salted password hash,
    // secret-independent) and enrols no factor, and it revokes the one session it mints,
    // so nothing it writes is ever decrypted by this process.
    QCMS_ADMIN_AUTH_SECRET: process.env.QCMS_ADMIN_AUTH_SECRET ?? randomSecret(),
    // The admin dev server's documented origin: this seat's stable admin port
    // (`docs/PORTS.md`), which is what `pnpm --filter qcms-admin dev --port <7S40>`
    // listens on. better-auth scopes its cookies to it and trusts no other origin, so a
    // developer running the admin somewhere else has to set it here too. This script
    // does not start the admin itself; it only has to agree with it.
    QCMS_ADMIN_BASE_URL: ADMIN_BASE_URL,
  });
  await waitFor("API health", async () => {
    const res = await fetch(`${API_BASE_URL}/health`);
    return res.ok;
  });
  log("API is healthy.");
}

async function startPortal(internalToken) {
  log(`starting portal (next dev) on ${PORTAL_BASE_URL} ...`);
  startChild("portal", "pnpm", ["--filter", "qcms-portal", "dev", "--port", PORTAL_PORT], {
    QCMS_API_BASE_URL: API_BASE_URL,
    QCMS_INTERNAL_TOKEN: internalToken,
    // The Start BFF route builds its 303 redirect against the public portal
    // origin (apps/portal/lib/server/config.ts), and that read is required: with
    // it unset the respondent's first click 500s instead of opening a session.
    // The API child above is handed the same value for its own link building.
    QCMS_PORTAL_BASE_URL: PORTAL_BASE_URL,
    NODE_ENV: "development",
  });
  // next dev compiles routes on first hit, so the entry page is the real
  // readiness signal. It returns 200 for the anonymous invitation.
  await waitFor(
    "portal to serve the entry page",
    async () => {
      const res = await fetch(`${PORTAL_BASE_URL}/f/${FORM_SLUG}`);
      return res.ok;
    },
    { timeoutMs: 120_000 },
  );
  log("portal is serving.");
}

// ---------------------------------------------------------------------------
// Shutdown.
// ---------------------------------------------------------------------------
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write("\n");
  log(`received ${signal}; stopping API + portal...`);
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

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  ensureBuilt();
  composeUp();
  const toolkit = await loadDbToolkit();
  await migrateAndSeed(toolkit);

  const internalToken = randomSecret();
  await startApi(internalToken);
  await startPortal(internalToken);

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

main().catch((err) => {
  if (!shuttingDown) fail(err.stack ?? String(err));
});
