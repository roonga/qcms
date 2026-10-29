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
  readonly kitchenSinkSlug: string;
  readonly authorMessagesSlug: string;
  readonly repeatFleetSlug: string;
  readonly repeatTourSlug: string;
  readonly repeatTableSlug: string;
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
  readonly testEnvironmentToken: string;
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
    // Task 081: the thinking disclosure, which only exists on screen when
    // reasoning events arrive. `summary` is what makes them arrive, so this is
    // the setting the browser suite has to run under to see the disclosure at
    // all - and the disclosure is the half of 081 that needs a real browser
    // (axe over it open and closed, and its indicator under reduced motion).
    // The `off` half is a wire-level claim and is pinned where wire-level claims
    // belong: `assistant.test.ts` drives the same `reasoning` script under both
    // settings and asserts the sentinel reaches nothing under `off`.
    QCMS_AGENT_THINKING: "summary",
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
