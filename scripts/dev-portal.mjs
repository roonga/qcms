/**
 * dev-portal.mjs - stand up a real, local respondent portal serving a published
 * form, for the task-030 manual screen-reader accessibility pass.
 *
 * Right now the only place a form gets seeded and published is the Playwright
 * e2e globalSetup, which lives and dies with the test run. This script makes it
 * a repeatable thing a human can drive:
 *
 *   1. Bring up the dev Postgres (docker-compose.dev.yml, QCMS_DB_PORT=7020) and
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

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

// ---------------------------------------------------------------------------
// Tunables (all overridable via env so the script never hard-codes a machine).
// ---------------------------------------------------------------------------
const DB_PORT = process.env.QCMS_DB_PORT ?? "7020";
const DB_USER = process.env.QCMS_DB_USER ?? "qcms";
const DB_PASSWORD = process.env.QCMS_DB_PASSWORD ?? "qcms";
const DB_NAME = process.env.QCMS_DB_NAME ?? "qcms";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  `postgres://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}`;

const API_PORT = process.env.QCMS_DEV_API_PORT ?? "7010";
const PORTAL_PORT = process.env.QCMS_DEV_PORTAL_PORT ?? "7000";
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
const PORTAL_BASE_URL = `http://localhost:${PORTAL_PORT}`;

const FORM_ID = "frm_kitchen_sink";
const FORM_SLUG = process.env.QCMS_DEV_FORM_SLUG ?? "kitchen-sink";

// The kitchen-sink form pins these library questions (see
// packages/core/fixtures/forms/valid/kitchen-sink.json). Each maps to one of the
// committed question fixtures - one per question type. q_at_fault_accident is
// pinned at version 2, so it gets two versions (identical bytes), mirroring the
// e2e insurance seed.
const QUESTIONS = [
  { id: "q_full_name", slug: "full-name", fixture: "short-text.json", versions: 1 },
  { id: "q_dob", slug: "dob", fixture: "date.json", versions: 1 },
  { id: "q_at_fault_accident", slug: "at-fault-accident", fixture: "boolean.json", versions: 2 },
  { id: "q_accident_count", slug: "accident-count", fixture: "number.json", versions: 1 },
  {
    id: "q_preexisting_conditions",
    slug: "preexisting-conditions",
    fixture: "multi-choice.json",
    versions: 1,
  },
  { id: "q_medical_history", slug: "medical-history", fixture: "long-text.json", versions: 1 },
  { id: "q_coverage_level", slug: "coverage-level", fixture: "single-choice.json", versions: 1 },
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
  log(`bringing up dev Postgres (docker-compose.dev.yml, port ${DB_PORT})...`);
  const res = spawnSync("docker", ["compose", "-f", "docker-compose.dev.yml", "up", "-d"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: IS_WINDOWS,
    env: {
      ...process.env,
      QCMS_DB_PORT: DB_PORT,
      QCMS_DB_USER: DB_USER,
      QCMS_DB_PASSWORD: DB_PASSWORD,
      QCMS_DB_NAME: DB_NAME,
    },
  });
  if (res.status !== 0) fail("docker compose up failed (is Docker running?)");
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
    const definition = readJson(`packages/core/fixtures/questions/valid/${q.fixture}`);
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

  const definition = readJson("packages/core/fixtures/forms/valid/kitchen-sink.json");
  const golden = readJson("packages/a2ui-compiler/golden/v1/kitchen-sink.a2ui.json");
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
  log("Remove it with:  docker compose -f docker-compose.dev.yml down");
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
      "  Then:  docker compose -f docker-compose.dev.yml down   (removes the DB)",
      "==================================================================",
      "",
    ].join("\n") + "\n",
  );
}

main().catch((err) => {
  if (!shuttingDown) fail(err.stack ?? String(err));
});
