/**
 * Composition helpers for the e2e suite (task 027).
 *
 * The scenarios drive the product as a *consumer*: they compose the app exactly
 * as `serve.ts` does (`createApp(deps, flags, { groups: appGroups })`) and then
 * speak only HTTP (`app.request(...)`) and the seed toolkit. Nothing here
 * reaches into a slice's internals.
 *
 * **One env, one database, many compositions.** `validEnv()` regenerates its
 * synthetic secrets on every call, so a topology that spans two process shapes
 * sharing tokens (scenario 4: a public-only respondent process and a separate
 * internal/admin authoring process over one database) must build the env **once**
 * and hand the same object to every composition. `buildEnv()` is that single
 * call; `composeApi(db, env, flags)` turns (db, env, shape) into a running app.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { schema } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import {
  DEFAULT_TEST_ENVIRONMENT,
  searchPathOptions,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";

import { createApp } from "../../src/app.js";
import type { Deps } from "../../src/deps.js";
import type { Databases } from "../../src/environments.js";
import type { MountFlags } from "../../src/config.js";
import type { Logger } from "../../src/logger.js";
import { appGroups } from "../../src/registrars.js";
import {
  fixedClock,
  internalTokenFor,
  makeDeps,
  seedAdminSession,
  validEnv,
} from "../../src/test-support.js";

const { Pool } = pg;

/** The fixed wall-clock the suite pins for deterministic tokens/timestamps. */
export const NOW = new Date("2026-07-20T00:00:00.000Z");

/**
 * Process-shape presets (ADR-09).
 *
 * `environments` is the **non-prod** respondent surfaces a shape mounts (Q21, task 066).
 * `all` carries `test`, which is what `QCMS_MOUNT=all` expands to against the shipped
 * two-environment configuration, so a scenario that reaches `/test/...` is reaching an
 * address a real solo deployment serves. `prodOnly` is the same shape with the test
 * surface left out, which is the configuration criterion 3 asserts against: not a
 * refusal, an absence.
 */
export const MOUNT = {
  all: { public: true, internal: true, admin: true, environments: ["test"] },
  publicOnly: { public: true, internal: false, admin: false, environments: ["test"] },
  adminOnly: { public: false, internal: true, admin: true, environments: [] },
  /** Every surface, with no non-prod respondent surface mounted at all. */
  prodOnly: { public: true, internal: true, admin: true, environments: [] },
} as const satisfies Record<string, MountFlags>;

/**
 * Build the shared environment **once**. Enables private webhook targets so the
 * in-test loopback receiver is reachable (SEC-6 on-prem override); every other
 * secret is synthetic. Reuse the returned object across compositions that must
 * share tokens - never call this twice for one topology.
 */
export function buildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return validEnv({ QCMS_WEBHOOK_ALLOW_PRIVATE: "true", ...overrides });
}

/** A composed API app plus the pieces scenarios need to talk to it. */
export interface ComposedApi {
  readonly app: ReturnType<typeof createApp>;
  readonly deps: Deps;
  /** The accepted internal service token for this composition's config. */
  readonly internalToken: string;
}

/**
 * Compose an app for a given database, environment, and process shape. The clock
 * is pinned to {@link NOW}. Every composition built from the same `env` shares
 * signing keys, the internal token, and the app-encryption key. An optional
 * `logger` override lets a harness capture the API's structured log stream (the
 * portal e2e's server-side log gate writes it to a file, task 045); when omitted
 * the default null logger is used, so existing scenarios are unaffected.
 *
 * **`databases` is the override a composition serving more than one environment needs**
 * (task 066). `db` alone becomes one handle behind every pool (`singleDatabase`), which is
 * right for a scenario that stays in one environment and wrong the moment one does not:
 * the handle connects with one environment's `search_path`, so a session written for
 * another lands in the wrong schema and the per-schema `CHECK` refuses it (Q46, the
 * thirteenth guard). A caller that reaches two environments opens a pool per environment
 * and passes them here.
 */
export function composeApi(
  db: TestDb["db"],
  env: Record<string, string | undefined>,
  flags: MountFlags,
  opts: { logger?: Logger; databases?: Databases } = {},
): ComposedApi {
  const deps = makeDeps({
    db,
    env,
    clock: fixedClock(NOW),
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    ...(opts.databases !== undefined ? { databases: opts.databases } : {}),
  });
  const app = createApp(deps, flags, { groups: appGroups });
  return { app, deps, internalToken: internalTokenFor(deps.config) };
}

/**
 * The real-auth login helper the 027 suite gained in task 031.
 *
 * Before 031 an admin request carried a made-up marker header that the launch
 * stub accepted unconditionally. The stub is gone: the admin-auth middleware now
 * resolves the header against a real `session` row. This is the one call a
 * scenario makes to become an authenticated admin - seed a 2FA-enrolled admin
 * account and a live session, and hand the returned token to
 * {@link AdminClient}. Anchored to {@link NOW} so it is live under the same
 * pinned clock every composition here uses.
 *
 * It is not a browser sign-in and does not pretend to be: the full
 * password + TOTP + recovery-code loop through better-auth is the admin
 * Playwright suite's subject (`apps/admin/e2e`). What this covers is the API's
 * side of the contract - a real session row, verified by the real middleware.
 */
export async function adminLogin(db: TestDb["db"], at: Date = NOW): Promise<string> {
  const { token } = await seedAdminSession(db, { at });
  return token;
}

/**
 * One real pool per environment, for a composition that serves more than one (task 066).
 *
 * `singleDatabase` puts one handle behind every pool, which is right for a scenario that
 * stays in one environment and wrong the moment one does not: that handle connects with
 * one environment's `search_path`, so a session written for another lands in the wrong
 * schema and the per-schema `CHECK` refuses it (Q46, the thirteenth guard). That refusal
 * is the guard working, so the harness has to be honest rather than the guard relaxed.
 *
 * The harness's own handle serves `prod` - which is the environment it connects as - and
 * every other environment gets a pool of its own on its own search path, registered with
 * {@link TestDb.register} so teardown drains it before the container stops (issue #888).
 * The **control** pool is the harness's handle too: every control-plane table is declared
 * schema-qualified, so any of these connections resolves it.
 *
 * It opens real pools rather than faking `forRequest`, because what the suites above it
 * assert is which schema a row landed in, and a fake would answer that question for them.
 */
export function environmentDatabases(
  testDb: TestDb,
  environments: readonly string[] = ["test", "prod"],
): Databases {
  const control = testDb.db as unknown as Executor;
  const byEnvironment = new Map<string, Executor>([[DEFAULT_TEST_ENVIRONMENT, control]]);
  for (const environment of environments) {
    if (byEnvironment.has(environment)) continue;
    const pool = testDb.register(
      new Pool({ connectionString: testDb.connectionUri, options: searchPathOptions(environment) }),
      `${environment} environment pool`,
    );
    byEnvironment.set(environment, drizzle(pool, { schema }));
  }
  return {
    control,
    names: [...environments],
    defaultEnvironment: DEFAULT_TEST_ENVIRONMENT,
    for: (environment: string) => {
      const found = byEnvironment.get(environment);
      if (found === undefined) throw new Error(`no pool for environment ${environment}`);
      return found;
    },
    forRequest: (environment?: string) => {
      const chosen = environment ?? DEFAULT_TEST_ENVIRONMENT;
      return { environment: chosen, exec: byEnvironment.get(chosen)! };
    },
  };
}

export { startTestDb, type TestDb };
