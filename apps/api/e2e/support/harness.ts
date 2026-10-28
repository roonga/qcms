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

/** The fixed wall-clock the suite pins for deterministic tokens and timestamps. */
export const NOW = new Date("2026-07-20T00:00:00.000Z");

/** `environments` is the non-prod respondent surfaces a shape mounts (ADR-09, Q21). */
export const MOUNT = {
  all: { public: true, internal: true, admin: true, environments: ["test"] },
  publicOnly: { public: true, internal: false, admin: false, environments: ["test"] },
  adminOnly: { public: false, internal: true, admin: true, environments: [] },
  prodOnly: { public: true, internal: true, admin: true, environments: [] },
} as const satisfies Record<string, MountFlags>;

/**
 * `validEnv()` regenerates its synthetic secrets on every call, so a topology whose
 * process shapes must share tokens builds the env once and reuses the returned object.
 * Private webhook targets are enabled so the in-test loopback receiver is reachable.
 */
export function buildEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return validEnv({ QCMS_WEBHOOK_ALLOW_PRIVATE: "true", ...overrides });
}

export interface ComposedApi {
  readonly app: ReturnType<typeof createApp>;
  readonly deps: Deps;
  readonly internalToken: string;
}

/**
 * `databases` is the override a composition serving more than one environment needs: `db`
 * alone becomes one handle behind every pool, connected with one environment's
 * `search_path`, so a session written for another lands in the wrong schema and the
 * per-schema `CHECK` refuses it (Q46).
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
 * Seeds a real `session` row, which the admin-auth middleware resolves the header
 * against, anchored to {@link NOW} so it is live under the suite's pinned clock. Not a
 * browser sign-in: the password, TOTP and recovery-code loop is `apps/admin/e2e`'s.
 */
export async function adminLogin(db: TestDb["db"], at: Date = NOW): Promise<string> {
  const { token } = await seedAdminSession(db, { at });
  return token;
}

/**
 * One real pool per environment, each registered with {@link TestDb.register} so teardown
 * drains it. Real pools, because the suites assert which schema a row landed in.
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
