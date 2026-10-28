/**
 * Boots the real API on a socket for the portal Playwright suite (task 029).
 *
 * The portal is a strict BFF: its route handlers call an internal API over HTTP
 * (never in-process). To exercise the whole respondent loop end to end the suite
 * therefore needs a *real* API listening on a port, backed by a real database. We
 * reuse the 027 e2e toolkit verbatim: `startTestDb()` (Testcontainers Postgres,
 * migrated to head), `buildEnv()` + `composeApi()` to build the app exactly as
 * `serve.ts` does, and the insurance seed/mint helpers. The composed app is then
 * served with `@hono/node-server`.
 *
 * `@hono/node-server` is a vetted dependency of `qcms-api` (apps/api); the portal
 * does not re-declare it. We resolve it from the api package where it already
 * lives, so this harness adds no new dependency to the portal.
 *
 * The browser harness runs this module inside its traced API child process, so its
 * singleton is process-local and shutdown can flush telemetry after closing it.
 */

import { createRequire } from "node:module";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  adminLogin,
  buildEnv,
  composeApi,
  environmentDatabases,
  mintInsuranceLink,
  releaseSeededVersionTo,
  seedAuthorMessagesForm,
  seedInsuranceForm,
  seedKitchenSinkForm,
  seedRepeatFleetForm,
  seedRepeatTourForm,
  seedRepeatTableForm,
  seedUnpublishedPinForm,
  startTestDb,
  MOUNT,
  NOW,
  type TestDb,
} from "../../../api/e2e/support/index.js";
import { createJsonLogger } from "../../../api/src/logger.js";

import { ADMIN_BASE_URL, FIXED_AUTH_SECRET } from "../../../admin/e2e/support/harness-config.js";

import {
  API_PORT,
  FIXED_APP_KEY,
  FIXED_INTERNAL_TOKEN,
  FIXTURES_PATH,
  SERVER_LOG_DIR,
  SERVER_LOG_FILES,
} from "./harness-config.js";

/** The wire-stable SEC-4 internal-token header (matches the portal + API). */
const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";
/**
 * The header carrying the admin's better-auth session token (031). This harness
 * makes exactly one admin call - revoking a link so a spec can assert the revoked
 * outcome - and the middleware now resolves this header against a real `session`
 * row, so the token comes from `adminLogin()` rather than being a marker string.
 */
const ADMIN_SESSION_HEADER = "x-qcms-admin-session";

/** The minimal shape of `@hono/node-server`'s returned server we depend on. */
interface ClosableServer {
  close(callback?: (err?: Error) => void): void;
}
type Serve = (options: {
  fetch: (request: Request) => Response | Promise<Response>;
  port: number;
  hostname?: string;
}) => ClosableServer;

const apiRequire = createRequire(new URL("../../../api/package.json", import.meta.url));
const { serve } = apiRequire("@hono/node-server") as { serve: Serve };

/** The fixtures the specs read: the form slug and one link token per outcome. */
export interface PortalFixtures {
  readonly slug: string;
  /** The kitchen-sink form slug (all seven question types, task 045). */
  readonly kitchenSinkSlug: string;
  /**
   * The `author-messages` form slug (task 048): four required questions carrying
   * ADR-32 validation messages and ADR-36 boolean label overrides.
   */
  readonly authorMessagesSlug: string;
  /**
   * The `repeat-fleet` form slug (task 073): one step with a plain required question
   * and one repeating group (`open`, `min: 1`, `max: 3`) whose members include a
   * required shortText, an optional date, a longText and a multiChoice.
   *
   * It exists because a repeating group is unreachable in a browser without a fixture
   * that compiles one, and the four no-JS dead ends of issues #920, #974, #18 and #988
   * each stayed invisible to every gate for exactly as long as no fixture carried
   * their shape.
   */
  readonly repeatFleetSlug: string;
  /**
   * The `repeat-tour` form slug (task 076): one step, one `perInstanceStep` group,
   * `open` with `min: 3, max: 4`, so the step is three views on the first serve.
   */
  readonly repeatTourSlug: string;
  /**
   * The `repeat-table` form slug (task 077): the same group shape presented as a
   * **table**, with columns of exactly the five allowed cell types (Q12).
   *
   * A form of its own rather than a second presentation of `repeat-fleet`, because
   * that form pins a `longText` and a `multiChoice` and a table-presented group is
   * refused at publish for carrying either.
   */
  readonly repeatTableSlug: string;
  /**
   * The e2e Postgres connection URI, so a spec can open its OWN client and verify
   * persisted answers independently of the API's response echo (task 045, exit
   * criterion 4). A test-only container credential, never a real secret.
   */
  readonly databaseUrl: string;
  readonly validToken: string;
  readonly expiredToken: string;
  readonly consumedToken: string;
  readonly revokedToken: string;
  readonly invalidToken: string;
  /**
   * A perfectly good link into a form that has since been closed (ADR-39, issue
   * #724): the whole-form closed state overrides every link, so this is the
   * closed explanation rather than a link failure.
   */
  readonly closedFormToken: string;
  /**
   * A valid link belonging to the **`test`** environment, whose address is therefore
   * `/test/l/{token}` (ADR-40, Q21, task 066).
   *
   * Criterion 2 asks for the prefix asserted on **both** surfaces, and the portal's half
   * is only assertable through a browser that followed the address: the API's half is
   * asserted in its own integration suite. The insurance form is released to `test` as
   * well as to the harness's own environment so this link has something to serve.
   */
  readonly testEnvironmentToken: string;
  /**
   * A form whose draft pins two question versions that were never published, so an
   * admin dry run reports exactly two issues against its `stp_history` step (issue
   * #625, given a fixture of its own by issue #275).
   *
   * `apps/admin/e2e/validation-idle.pw.ts` is its only reader, and the id travels
   * through this file rather than being written down there so the two cannot drift.
   * Nothing else may seed answers, links or versions against it: what the spec
   * asserts is a COUNT, and a second writer would change it.
   */
  readonly unpublishedPinFormId: string;
}

interface RunningApi {
  readonly testDb: TestDb;
  readonly server: ClosableServer;
}

let running: RunningApi | undefined;

/**
 * Boot the database, compose + serve the API, seed the insurance form, mint one
 * link token per outcome, and write the fixtures file the specs consume. Idempotent
 * per process: a second call is a no-op.
 */
export async function startApiServer(): Promise<void> {
  if (running !== undefined) return;

  mkdirSync(SERVER_LOG_DIR, { recursive: true });
  writeFileSync(SERVER_LOG_FILES.api, "", "utf8");
  writeFileSync(SERVER_LOG_FILES.postgres, "", "utf8");

  const testDb = await startTestDb();

  const pgLogs = await testDb.container.logs();
  pgLogs.on("data", (chunk: Buffer | string) => {
    appendFileSync(SERVER_LOG_FILES.postgres, chunk.toString());
  });
  pgLogs.on("error", () => undefined);

  const apiLogger = createJsonLogger({
    write: (line) => appendFileSync(SERVER_LOG_FILES.api, `${line}\n`),
    base: { service: "qcms-api" },
    sendToOpenTelemetry: true,
  });

  const env = buildEnv({
    QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
    QCMS_APP_KEY: FIXED_APP_KEY,
    DATABASE_URL: testDb.connectionUri,
    QCMS_ENVIRONMENTS: "test,prod",
    QCMS_DATABASE_URL_TEST: testDb.connectionUri,
    QCMS_DATABASE_URL_PROD: testDb.connectionUri,
    QCMS_MOUNT: "all",
    QCMS_ADMIN_AUTH_SECRET: FIXED_AUTH_SECRET,
    QCMS_ADMIN_BASE_URL: ADMIN_BASE_URL,
    QCMS_RL_ANSWERS_SESSION_MAX: "1000000",
    QCMS_RL_ANSWERS_IP_MAX: "1000000",
    QCMS_RL_SESSION_CREATE_MAX: "1000000",
    QCMS_RL_SUBMIT_SESSION_MAX: "1000000",
    QCMS_RL_ROSTER_SESSION_MAX: "1000000",
    QCMS_RL_ROSTER_IP_MAX: "1000000",
    QCMS_FLAG_AGENT_AUTHORING: "fake",
    QCMS_RL_AGENT_ASSIST_MAX: "1000000",
  });
  const databases = environmentDatabases(testDb);
  const composed = composeApi(testDb.db, env, MOUNT.all, { logger: apiLogger, databases });
  const app = composed.app;
  const config = composed.deps.config;

  const { slug, formId } = await seedInsuranceForm(testDb.db);
  const { slug: kitchenSinkSlug } = await seedKitchenSinkForm(testDb.db, {
    sharedQuestionsSeeded: true,
  });
  const { slug: authorMessagesSlug } = await seedAuthorMessagesForm(testDb.db);
  const { slug: repeatFleetSlug } = await seedRepeatFleetForm(testDb.db);
  const { slug: repeatTourSlug } = await seedRepeatTourForm(testDb.db);
  const { slug: repeatTableSlug } = await seedRepeatTableForm(testDb.db);

  const nowMs = NOW.getTime();
  const oneHour = 60 * 60 * 1000;

  const validToken = await mintInsuranceLink(testDb.db, config, formId, {
    linkId: "lnk_valid",
    expiresAt: new Date(nowMs + oneHour),
  });
  const expiredToken = await mintInsuranceLink(testDb.db, config, formId, {
    linkId: "lnk_expired",
    expiresAt: new Date(nowMs - 60_000),
  });

  const consumedToken = await mintInsuranceLink(testDb.db, config, formId, {
    linkId: "lnk_consumed",
    expiresAt: new Date(nowMs + oneHour),
    oneTime: true,
  });
  const consumeRes = await app.request("/sessions/link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INTERNAL_TOKEN_HEADER]: composed.internalToken,
    },
    body: JSON.stringify({ token: consumedToken }),
  });
  if (consumeRes.status !== 201) {
    throw new Error(`expected 201 consuming one-time link, got ${consumeRes.status}`);
  }

  const revokedToken = await mintInsuranceLink(testDb.db, config, formId, {
    linkId: "lnk_revoked",
    expiresAt: new Date(nowMs + oneHour),
  });
  const adminSessionToken = await adminLogin(testDb.db);
  const revokeRes = await app.request(`/admin/forms/${formId}/links/lnk_revoked/revoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INTERNAL_TOKEN_HEADER]: composed.internalToken,
      [ADMIN_SESSION_HEADER]: adminSessionToken,
    },
  });
  if (revokeRes.status !== 200) {
    throw new Error(`expected 200 revoking link, got ${revokeRes.status}`);
  }

  const { formId: closedFormId } = await seedInsuranceForm(testDb.db, {
    formId: "frm_closed_link",
    slug: "closed-link",
    sharedQuestionsSeeded: true,
    closed: true,
  });
  const closedFormToken = await mintInsuranceLink(testDb.db, config, closedFormId, {
    linkId: "lnk_closed_form",
    expiresAt: new Date(nowMs + oneHour),
  });

  await releaseSeededVersionTo(testDb.db, formId, 1, "test");
  const testEnvironmentToken = await mintInsuranceLink(testDb.db, config, formId, {
    linkId: "lnk_test_env",
    expiresAt: new Date(nowMs + oneHour),
    environment: "test",
  });

  const { formId: unpublishedPinFormId } = await seedUnpublishedPinForm(testDb.db);

  const fixtures: PortalFixtures = {
    slug,
    kitchenSinkSlug,
    authorMessagesSlug,
    repeatFleetSlug,
    repeatTourSlug,
    repeatTableSlug,
    databaseUrl: testDb.connectionUri,
    validToken,
    expiredToken,
    consumedToken,
    revokedToken,
    invalidToken: "not-a-real-link-token",
    closedFormToken,
    testEnvironmentToken,
    unpublishedPinFormId,
  };
  mkdirSync(dirname(FIXTURES_PATH), { recursive: true });
  writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2), "utf8");

  const server = serve({ fetch: app.fetch, port: API_PORT, hostname: "127.0.0.1" });
  running = { testDb, server };
}

/** Stop the API server and tear down the database container. */
export async function stopApiServer(): Promise<void> {
  const current = running;
  running = undefined;
  if (current === undefined) return;
  await new Promise<void>((resolve, reject) => {
    current.server.close((err) => (err ? reject(err) : resolve()));
  });
  await current.testDb.teardown();
}
