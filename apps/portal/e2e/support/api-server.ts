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
  mintInsuranceLink,
  seedAuthorMessagesForm,
  seedInsuranceForm,
  seedKitchenSinkForm,
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

  // Fresh server-log capture for this run window (exit criterion 5): the composed
  // API's structured log and the Postgres container's server log stream into
  // files the log gate scans for error/warn lines. The portal dev-server's log is
  // captured by the webServer wrapper (playwright.config.ts).
  // The API + Postgres logs are truncated here; the portal dev-server log is
  // owned and truncated by its wrapper (portal-server.mjs) to avoid a start-order
  // race with this globalSetup.
  mkdirSync(SERVER_LOG_DIR, { recursive: true });
  writeFileSync(SERVER_LOG_FILES.api, "", "utf8");
  writeFileSync(SERVER_LOG_FILES.postgres, "", "utf8");

  const testDb = await startTestDb();

  // Stream the Postgres container's server log into the capture file.
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
    // Fixed rather than generated: the admin operations spec composes its own Deps to
    // run a delivery pass, and both sides have to decrypt the same webhook secret
    // (task 035). See FIXED_APP_KEY.
    QCMS_APP_KEY: FIXED_APP_KEY,
    DATABASE_URL: testDb.connectionUri,
    QCMS_MOUNT: "all",
    // better-auth lives here since task 056, so the composed API carries the admin's
    // identity provider. Both values are the ADMIN's, not this API's: the browser only
    // ever sees the admin origin, so that is the origin better-auth scopes cookies to
    // and trusts. `FIXED_AUTH_SECRET` is shared with the runner-side account helper
    // (`apps/api/e2e/support/admin-accounts.ts`), which is what makes a cookie minted
    // there verify here.
    QCMS_ADMIN_AUTH_SECRET: FIXED_AUTH_SECRET,
    QCMS_ADMIN_BASE_URL: ADMIN_BASE_URL,
    // The composed API runs on a FIXED clock, so rate-limit windows never advance
    // and every session-create / answer / submit across the whole suite counts
    // against one frozen window. This behavioral suite is not a rate-limit test
    // (that lives in the 026 API tests), and the multi-step kitchen-sink flow
    // alone posts more than the default per-session burst (10), so raise every
    // respondent limit far above what the suite can reach.
    QCMS_RL_ANSWERS_SESSION_MAX: "1000000",
    QCMS_RL_ANSWERS_IP_MAX: "1000000",
    QCMS_RL_SESSION_CREATE_MAX: "1000000",
    QCMS_RL_SUBMIT_SESSION_MAX: "1000000",
  });
  const composed = composeApi(testDb.db, env, MOUNT.all, { logger: apiLogger });
  const app = composed.app;
  const config = composed.deps.config;

  const { slug, formId } = await seedInsuranceForm(testDb.db);
  // The insurance seed already created q_at_fault_accident@2 + q_accident_count,
  // which the kitchen-sink form also pins; do not re-create them.
  const { slug: kitchenSinkSlug } = await seedKitchenSinkForm(testDb.db, {
    sharedQuestionsSeeded: true,
  });
  // Task 048: author-supplied validation messages (ADR-32) and boolean label
  // overrides (ADR-36). Its own four questions, so nothing is shared.
  const { slug: authorMessagesSlug } = await seedAuthorMessagesForm(testDb.db);

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

  // A one-time link, then consumed by starting a session once against it.
  const consumedToken = await mintInsuranceLink(testDb.db, config, formId, {
    linkId: "lnk_consumed",
    expiresAt: new Date(nowMs + oneHour),
    oneTime: true,
  });
  const consumeRes = await app.request("/sessions", {
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

  // A valid link, then revoked over the admin surface
  // (POST /admin/forms/:id/links/:linkId/revoke).
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

  // A valid, unspent link into a CLOSED form: the questionnaire stopped
  // accepting responses after the invitation went out (ADR-39, issue #724). A
  // second form so the open one every other spec drives stays open; its library
  // questions are already seeded by the insurance seed above.
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

  // The admin builder's "nothing has checked this draft yet" spec needs a draft with
  // a known non-zero issue count, and it used to borrow one from the insurance form,
  // which carried two only because the seed forgot to publish its question versions
  // (issue #275). This is that fixture made deliberate: a form of its own whose draft
  // pins two unpublished versions, so the count the spec asserts is a property of the
  // seed rather than of a bug. It brings two library questions of its own, so the shared
  // library every other spec reads is exactly as it was.
  const { formId: unpublishedPinFormId } = await seedUnpublishedPinForm(testDb.db);

  const fixtures: PortalFixtures = {
    slug,
    kitchenSinkSlug,
    authorMessagesSlug,
    databaseUrl: testDb.connectionUri,
    validToken,
    expiredToken,
    consumedToken,
    revokedToken,
    invalidToken: "not-a-real-link-token",
    closedFormToken,
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
