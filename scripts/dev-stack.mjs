/**
 * Each entry point starts its own API: the SEC-4 internal token is generated in
 * memory per run and written nowhere, so no other process can learn it, and two
 * entry points therefore cannot share a seat (`docs/PORTS.md`).
 */

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { publishedPortHost } from "./docker-host.mjs";
import { composeProjectName, stablePort } from "./ports.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT_NAME ?? composeProjectName();
const DB_PORT = process.env.QCMS_DB_PORT ?? String(stablePort("postgres"));
const DB_USER = process.env.QCMS_DB_USER ?? "qcms";
const DB_PASSWORD = process.env.QCMS_DB_PASSWORD ?? "qcms";
const DB_NAME = process.env.QCMS_DB_NAME ?? "qcms";
// Inside the dev container the database is a published sibling, so the address that
// works is the host gateway rather than localhost (ADR-29).
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
const ADMIN_PORT = process.env.QCMS_DEV_ADMIN_PORT ?? String(stablePort("admin"));
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
const PORTAL_BASE_URL = `http://localhost:${PORTAL_PORT}`;
const ADMIN_BASE_URL = `http://localhost:${ADMIN_PORT}`;

const FORM_ID = "frm_kitchen_sink";
const FORM_SLUG = process.env.QCMS_DEV_FORM_SLUG ?? "kitchen-sink";

const KITCHEN_SINK_DEFINITION = "apps/api/e2e/support/fixtures/vehicle-kitchen-sink-form.json";
const KITCHEN_SINK_GOLDEN = "apps/api/e2e/support/fixtures/vehicle-kitchen-sink.a2ui.json";

const QUESTION_SOURCES = {
  q_full_name: {
    slug: "full-name",
    path: "packages/core/fixtures/questions/valid/short-text.json",
  },
  q_dob: { slug: "dob", path: "packages/core/fixtures/questions/valid/date.json" },
  q_at_fault_accident: {
    slug: "at-fault-accident",
    path: "packages/core/fixtures/questions/valid/boolean.json",
  },
  q_accident_count: {
    slug: "accident-count",
    path: "packages/core/fixtures/questions/valid/number.json",
  },
  q_optional_cover: {
    slug: "optional-cover",
    path: "apps/api/e2e/support/fixtures/q-optional-cover.json",
  },
  q_extra_detail: {
    slug: "extra-detail",
    path: "apps/api/e2e/support/fixtures/q-extra-detail.json",
  },
  q_coverage_level: {
    slug: "coverage-level",
    path: "packages/core/fixtures/questions/valid/single-choice.json",
  },
  q_annual_km: { slug: "annual-km", path: "apps/api/e2e/support/fixtures/q-annual-km.json" },
  q_body_type: { slug: "body-type", path: "apps/api/e2e/support/fixtures/q-body-type.json" },
  q_overnight_parking: {
    slug: "overnight-parking",
    path: "apps/api/e2e/support/fixtures/q-overnight-parking.json",
  },
};

export function kitchenSinkQuestions(
  definition = readJson(KITCHEN_SINK_DEFINITION),
  sources = QUESTION_SOURCES,
) {
  const pinned = new Map();
  for (const step of definition.steps ?? []) {
    for (const item of step.items ?? []) {
      const previous = pinned.get(item.questionId) ?? 0;
      pinned.set(item.questionId, Math.max(previous, item.version ?? 1));
    }
  }

  const unsourced = [...pinned.keys()].filter((id) => sources[id] === undefined);
  if (unsourced.length > 0) {
    throw new Error(
      `${KITCHEN_SINK_DEFINITION} pins ${unsourced.join(", ")}, which QUESTION_SOURCES in ` +
        `scripts/dev-stack.mjs does not name. Add the definition path and slug there, or the ` +
        `dev stack seeds a form version whose pinned questions do not exist and every step 500s.`,
    );
  }
  const unpinned = Object.keys(sources).filter((id) => !pinned.has(id));
  if (unpinned.length > 0) {
    throw new Error(
      `QUESTION_SOURCES in scripts/dev-stack.mjs names ${unpinned.join(", ")}, which ` +
        `${KITCHEN_SINK_DEFINITION} no longer pins. Remove the entry.`,
    );
  }

  return [...pinned].map(([id, versions]) => ({
    id,
    slug: sources[id].slug,
    path: sources[id].path,
    versions,
  }));
}

const QUESTIONS = kitchenSinkQuestions();

export const FIXTURE_READ_PATHS = [
  KITCHEN_SINK_DEFINITION,
  KITCHEN_SINK_GOLDEN,
  ...QUESTIONS.map((question) => question.path),
];

const IS_WINDOWS = process.platform === "win32";
const children = [];
let shuttingDown = false;

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
  // Meets config MIN_SECRET_LENGTH, and base64url carries no whitespace or comma for
  // the key-list parser to split on.
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
      // A shared project name makes two seats one stack: `up -d` would move seat 0's
      // container onto this port against the same volume and silently take its database.
      COMPOSE_PROJECT_NAME: COMPOSE_PROJECT,
      QCMS_DB_PORT: DB_PORT,
      QCMS_DB_USER: DB_USER,
      QCMS_DB_PASSWORD: DB_PASSWORD,
      QCMS_DB_NAME: DB_NAME,
    },
  });
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

async function seedKitchenSink({ handle, db, core }) {
  const existing = await db.getForm(handle, core.FormId.parse(FORM_ID));
  if (existing !== undefined) {
    log(`form ${FORM_ID} already seeded (slug "${existing.slug}"); skipping seed.`);
    return;
  }

  log("seeding + publishing the kitchen-sink form...");

  const workspaceId = await db.ensureSeedWorkspace(handle);

  for (const q of QUESTIONS) {
    const questionId = core.QuestionId.parse(q.id);
    const definition = readJson(q.path);
    await ignoreDuplicate(() =>
      db.createQuestion(handle, { questionId, slug: q.slug, workspaceId }),
    );
    for (let v = 1; v <= q.versions; v += 1) {
      const created = await db.createQuestionVersion(handle, { questionId, definition });
      await db.publishQuestionVersion(handle, { questionId, version: created.version });
    }
  }

  await db.createForm(handle, {
    formId: core.FormId.parse(FORM_ID),
    slug: FORM_SLUG,
    workspaceId,
    defaultLocale: "en",
  });

  const definition = readJson(KITCHEN_SINK_DEFINITION);
  const golden = readJson(KITCHEN_SINK_GOLDEN);
  await db.insertFormVersion(handle, {
    formId: core.FormId.parse(FORM_ID),
    definition,
    compiled: golden,
    compilerVersion: golden.compilerVersion,
    a2uiSpecVersion: golden.a2uiSpecVersion,
    semanticsVersion: "1",
  });

  log(
    `published ${FORM_ID} as slug "${FORM_SLUG}" ` +
      `(${QUESTIONS.length} pinned questions, ${definition.rules?.length ?? 0} rules).`,
  );
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

/**
 * @param {string} name
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @returns {import("node:child_process").ChildProcess}
 */
export function startChild(name, command, args, env) {
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
 * @param {object} options
 * @param {string} options.databaseUrl
 * @param {string} options.apiPort
 * @param {string} options.portalBaseUrl
 * @param {string} options.adminBaseUrl
 * @param {string} options.internalToken
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
    // One superuser credential in dev, so every pool shares the connection string and
    // only the search path differs (ADR-40, Q2).
    QCMS_ENVIRONMENTS: "test,prod",
    QCMS_DATABASE_URL_TEST: databaseUrl,
    QCMS_DATABASE_URL_PROD: databaseUrl,
    PORT: apiPort,
    QCMS_PORTAL_BASE_URL: portalBaseUrl,
    QCMS_INTERNAL_TOKEN: internalToken,
    QCMS_LINK_KEYS: linkKeys,
    QCMS_SESSION_KEYS: sessionKeys,
    QCMS_APP_KEY: appKey,
    // Pin this when working on the admin: a fresh value leaves an existing TOTP
    // enrolment and its backup codes permanently undecryptable.
    QCMS_ADMIN_AUTH_SECRET: adminAuthSecret,
    QCMS_ADMIN_BASE_URL: adminBaseUrl,
    // Off for the local sign-in loop only. SEC-1's throttle stays on everywhere else.
    QCMS_ADMIN_SIGNIN_THROTTLE: "false",
  };
}

async function startApi(env) {
  log(`starting API on ${API_BASE_URL} ...`);
  startChild("api", "node", ["apps/api/dist/serve.js"], env);
  await waitFor("API health", async () => {
    const res = await fetch(`${API_BASE_URL}/health`);
    return res.ok;
  });
  log("API is healthy.");
}

/**
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
      QCMS_ADMIN_BASE_URL: adminBaseUrl,
      QCMS_PORTAL_BASE_URL: portalBaseUrl,
    };
  }
  return {
    ...shared,
    QCMS_PORTAL_BASE_URL: portalBaseUrl,
    QCMS_PORTAL_ENVIRONMENTS: "test",
  };
}

/**
 * @param {object} options
 * @param {"portal" | "admin"} options.frontend
 * @param {string} options.internalToken
 * @returns {{ api: Record<string, string>, frontend: Record<string, string> }}
 */
export function stackChildEnvs({ frontend, internalToken }) {
  return {
    api: apiChildEnv({
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
    frontend: frontendChildEnv(frontend, {
      apiBaseUrl: API_BASE_URL,
      internalToken,
      portalBaseUrl: PORTAL_BASE_URL,
      adminBaseUrl: ADMIN_BASE_URL,
    }),
  };
}

/**
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

async function startFrontend(frontend, env) {
  const spec = FRONTENDS[frontend];
  log(`starting ${frontend} (next dev) on ${spec.baseUrl} ...`);
  startChild(frontend, "pnpm", ["--filter", spec.pkg, "dev", "--port", spec.port], env);
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

/** Probed rather than resolved through `PATH` (`sonarjs/no-os-command-from-path`). */
const PS_BINARY = ["/bin/ps", "/usr/bin/ps"].find((candidate) => existsSync(candidate));

/**
 * @param {number} rootPid
 * @returns {number[]}
 */
export function descendantsOf(rootPid) {
  if (PS_BINARY === undefined) return [];
  const listed = spawnSync(PS_BINARY, ["-e", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (listed.status !== 0 || typeof listed.stdout !== "string") return [];
  const childrenOf = new Map();
  for (const line of listed.stdout.split("\n")) {
    const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;
    const siblings = childrenOf.get(parentPid);
    if (siblings === undefined) childrenOf.set(parentPid, [pid]);
    else siblings.push(pid);
  }
  const found = [];
  const pending = [rootPid];
  while (pending.length > 0) {
    const parent = pending.pop();
    for (const pid of childrenOf.get(parent) ?? []) {
      found.push(pid);
      pending.push(pid);
    }
  }
  return found;
}

/**
 * Unlike `child.kill()`, `process.kill()` does not know a pid is spent, so an exited
 * child is skipped outright: the kernel may have recycled its number onto anything.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @returns {number[]}
 */
export function reapChildTree(child) {
  if (child.pid === undefined) return [];
  // Exited: the pid may belong to someone else by now. Signal nothing.
  if (child.exitCode !== null || child.signalCode !== null) return [];

  if (IS_WINDOWS) {
    // /T because a plain kill leaves the grandchild tree orphaned.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return [child.pid];
  }

  // pnpm does not forward a signal to the `next dev` it runs, so killing only the direct
  // child leaves a server holding this seat's port. Children before parents.
  const tree = [...descendantsOf(child.pid).reverse(), child.pid];
  for (const pid of tree) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone, which is the normal case for most of the tree.
    }
  }
  return tree;
}

let reaped = false;

/**
 * The only place that reaps. Wired to `process.on("exit")` because every ending passes
 * through it synchronously; the `reaped` latch makes a second call a no-op.
 */
function reapAllChildren() {
  if (reaped) return;
  reaped = true;
  for (const { child } of children) reapChildTree(child);
}

/**
 * Must run before any child can exist: a child spawned earlier is reaped by nothing.
 *
 * @returns {void}
 */
export function installShutdownHandlers() {
  process.on("exit", reapAllChildren);
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write("\n");
  log(`received ${signal}; stopping ${children.map((c) => c.name).join(" + ")}...`);
  reapAllChildren();
  log("stopped. The Postgres container is still running.");
  log(
    `Remove it with:  COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT} docker compose -f docker-compose.dev.yml down`,
  );
  process.exit(0);
}

/**
 * `undefined` whenever the environment supplied `QCMS_DB_PASSWORD` or `DATABASE_URL`,
 * because printing a connection string prints the password inside it (SEC-8). The
 * `!== undefined` tests mirror the `??` that builds `DATABASE_URL`.
 *
 * @returns {string | undefined}
 */
function databaseUrlLine() {
  if (process.env.DATABASE_URL !== undefined || DB_PASSWORD !== "qcms") return undefined;
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

/** @returns {string[]} */
export function adminBannerLines() {
  const databaseLine = databaseUrlLine() ?? "DATABASE_URL=<your dev database URL> \\";
  return [
    "",
    "==================================================================",
    "  Admin is up. Open the authoring app:",
    "",
    `      ${ADMIN_BASE_URL}`,
    "",
    "  Sign in with an admin account. There is no self-registration path",
    "  (SEC-1), so if this database has no admin yet, create one from",
    "  another terminal. Prompt for the passphrase rather than typing it",
    "  inline: an inline assignment keeps it out of `ps` but writes it to",
    "  your shell history (issue #460).",
    "",
    "      read -rs -p 'passphrase: ' QCMS_ADMIN_PASSWORD; echo",
    "      export QCMS_ADMIN_PASSWORD",
    "",
    `      ${databaseLine}`,
    `        QCMS_ADMIN_BASE_URL=${ADMIN_BASE_URL} \\`,
    '        QCMS_ADMIN_AUTH_SECRET="$(node -e \'const{randomBytes}=require("node:crypto");console.log(randomBytes(32).toString("base64url"))\')" \\',
    "        QCMS_ADMIN_EMAIL=you@example.test \\",
    "        pnpm qcms:create-admin",
    "",
    "      unset QCMS_ADMIN_PASSWORD",
    "",
    "  TOTP enrolment is required by default (SEC-1). To skip it while",
    "  developing, start this with QCMS_ADMIN_2FA=optional (the API and the",
    "  admin both read it, so one setting moves both).",
    "",
    "  Stop:  press Ctrl+C  (stops the API + admin)",
    `  Then:  COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT} docker compose -f docker-compose.dev.yml down   (removes the DB)`,
    "==================================================================",
    "",
  ];
}

function printAdminBanner() {
  process.stdout.write(adminBannerLines().join("\n") + "\n");
}

/**
 * @param {object} options
 * @param {"portal" | "admin"} options.frontend
 * @param {string} options.name
 * @returns {Promise<void>}
 */
export async function runDevStack({ frontend, name }) {
  label = name;
  installShutdownHandlers();

  try {
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

    const envs = stackChildEnvs({
      frontend,
      internalToken: process.env.QCMS_INTERNAL_TOKEN ?? randomSecret(),
    });
    await startApi(envs.api);
    await startFrontend(frontend, envs.frontend);

    if (frontend === "admin") printAdminBanner();
    else printPortalBanner();
  } catch (err) {
    if (!shuttingDown) fail(err.stack ?? String(err));
  }
}
