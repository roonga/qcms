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
 * globalSetup and globalTeardown run in the same Playwright runner process, so
 * the booted handles live in this module's singleton and teardown reads them back.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildEnv,
  composeApi,
  mintInsuranceLink,
  seedInsuranceForm,
  startTestDb,
  MOUNT,
  NOW,
  type TestDb,
} from "../../../api/e2e/support/index.js";

import { API_PORT, FIXED_INTERNAL_TOKEN, FIXTURES_PATH } from "./harness-config.js";

/** The wire-stable SEC-4 internal-token header (matches the portal + API). */
const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";
/** The admin-session marker header (launch stub, task 021); any value passes. */
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
  readonly validToken: string;
  readonly expiredToken: string;
  readonly consumedToken: string;
  readonly revokedToken: string;
  readonly invalidToken: string;
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

  const testDb = await startTestDb();
  const env = buildEnv({
    QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
    DATABASE_URL: testDb.connectionUri,
    QCMS_MOUNT: "all",
  });
  const composed = composeApi(testDb.db, env, MOUNT.all);
  const app = composed.app;
  const config = composed.deps.config;

  const { slug, formId } = await seedInsuranceForm(testDb.db);

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

  // A valid link, then revoked over the admin surface (POST /admin/links/:id/revoke).
  const revokedToken = await mintInsuranceLink(testDb.db, config, formId, {
    linkId: "lnk_revoked",
    expiresAt: new Date(nowMs + oneHour),
  });
  const revokeRes = await app.request("/admin/links/lnk_revoked/revoke", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INTERNAL_TOKEN_HEADER]: composed.internalToken,
      [ADMIN_SESSION_HEADER]: "e2e-admin",
    },
  });
  if (revokeRes.status !== 200) {
    throw new Error(`expected 200 revoking link, got ${revokeRes.status}`);
  }

  const fixtures: PortalFixtures = {
    slug,
    validToken,
    expiredToken,
    consumedToken,
    revokedToken,
    invalidToken: "not-a-real-link-token",
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
