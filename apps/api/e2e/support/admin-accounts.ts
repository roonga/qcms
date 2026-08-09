import { schema } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { loadAdminAuthConfig } from "../../src/config.js";
import { createAdminAuth, type AdminAuth } from "../../src/features/auth/instance.js";

/**
 * Browser-suite account setup, on the API side of the seam (task 056).
 *
 * The admin Playwright suite needs an account with a password better-auth can verify,
 * and it needs one before the browser opens. It used to create it by importing the
 * admin app's own better-auth instance; the admin has no instance and no database handle
 * any more, so the helper lives here, in the workspace that owns both.
 *
 * That also removes a dependency the admin app should not have had: this module's `pg`,
 * `drizzle-orm` and `@roonga/qcms-db` imports resolve from `apps/api`, which is the process that
 * legitimately owns them, so the admin's harness reaches a database without the admin
 * package declaring a database client. It is the same pattern
 * `apps/portal/e2e/support/db.ts` uses for its independent verification reads.
 *
 * ## Why it bypasses the CLI's zero-admins guard
 *
 * {@link createTestAdmin} calls `signUpEmail` directly rather than going through
 * `createInitialAdmin`. That is not a hole being papered over: the guard is a property
 * of `pnpm qcms:create-admin` (nothing else may create the *first* account) and it is
 * tested where it lives, against a genuinely empty database, in
 * `src/features/auth/bootstrap.integration.test.ts`. What the browser suite is for is
 * the screens, and forcing it through a once-per-database command would let it test
 * exactly one account, once.
 *
 * Nothing else about the flow is shortcut. Enrollment, the TOTP secret, the recovery
 * codes and every verification happen in the browser, through the real screens.
 */

/** One pool and one instance per connection string, so repeated calls are cheap. */
const instances = new Map<string, { readonly auth: AdminAuth; readonly db: Executor }>();

/**
 * An auth instance over `databaseUrl`, configured exactly as the served API is.
 *
 * `authSecret` must match the secret the harness gives the composed API, or the cookies
 * one side mints are not the cookies the other verifies. The Playwright harness passes
 * the same `FIXED_AUTH_SECRET` to both.
 */
function authFor(
  databaseUrl: string,
  authSecret: string,
  adminBaseUrl: string,
): { readonly auth: AdminAuth; readonly db: Executor } {
  const existing = instances.get(databaseUrl);
  if (existing !== undefined) return existing;
  const config = loadAdminAuthConfig({
    DATABASE_URL: databaseUrl,
    QCMS_ADMIN_AUTH_SECRET: authSecret,
    QCMS_ADMIN_BASE_URL: adminBaseUrl,
  });
  const pool = new pg.Pool({ connectionString: databaseUrl });
  pool.on("error", () => undefined);
  const db = drizzle(pool, { schema }) as unknown as Executor;
  const built = { auth: createAdminAuth({ db, adminAuth: config.adminAuth }), db };
  instances.set(databaseUrl, built);
  return built;
}

/** What {@link createTestAdmin} needs to reach the run's database and agree on cookies. */
export interface TestAdminInput {
  readonly databaseUrl: string;
  readonly authSecret: string;
  readonly adminBaseUrl: string;
  readonly email: string;
  readonly password: string;
}

/**
 * Create an admin account with no TOTP factor yet: enrollment is the browser's job.
 *
 * There is deliberately **no** pool-closing helper, and the reason is a trap worth
 * recording: closing the pool in a spec file's `afterAll` breaks the *next* spec file.
 * Playwright runs the files of a project in one worker process, so this module's state -
 * including the instance memoized against its pool - outlives any single file, and a file
 * that closed the pool left the following file with a live auth instance over a dead one,
 * failing its `beforeAll` with a raw `Failed query: select ... from "user"`. Nothing has
 * to be closed: Playwright exits its workers before `globalTeardown`, so the pool is gone
 * by the time the container stops.
 */
export async function createTestAdmin(input: TestAdminInput): Promise<void> {
  const { auth } = authFor(input.databaseUrl, input.authSecret, input.adminBaseUrl);
  await auth.api.signUpEmail({
    body: { email: input.email, password: input.password, name: "E2E Admin" },
    asResponse: true,
  });
}

/** A raw SQL read's rows, as `pg` returns them. */
export interface RawRows<R> {
  readonly rows: readonly R[];
}

/**
 * A Drizzle handle over an arbitrary connection string, a raw-SQL escape hatch, and a
 * closer.
 *
 * For harness code that has to read or drive the run's database directly (the admin
 * operations spec composes its own `Deps` to run webhook delivery passes, then verifies
 * queued rows with two joins the query builders do not express). Lives here for the same
 * reason as the account helper: the database client belongs to the workspace that owns
 * the database, and a harness in another app should not have to declare one.
 *
 * A raw read returns `timestamptz` as a **string**, not a `Date` - the query builder's
 * `mode: "date"` is what converts. Callers that compare instants must normalize.
 */
export function openDbHandle(connectionString: string): {
  readonly db: Executor;
  readonly query: <R>(text: string, values?: readonly unknown[]) => Promise<RawRows<R>>;
  readonly close: () => Promise<void>;
} {
  const pool = new pg.Pool({ connectionString });
  pool.on("error", () => undefined);
  return {
    db: drizzle(pool, { schema }),
    query: async <R>(text: string, values?: readonly unknown[]) =>
      pool.query<R & Record<string, unknown>>(text, values === undefined ? undefined : [...values]),
    close: () => pool.end(),
  };
}
