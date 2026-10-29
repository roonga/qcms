import { clearMustChangePassword, schema } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { loadAdminAuthConfig } from "../../src/config.js";
import { createAdminAuth, type AdminAuth } from "../../src/features/auth/instance.js";
import { seedGrants } from "../../src/test-support.js";

const instances = new Map<string, { readonly auth: AdminAuth; readonly db: Executor }>();

/**
 * `authSecret` must match the secret the harness gives the composed API, or the cookies
 * one side mints are not the cookies the other verifies.
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
    // Off for this harness only: SEC-1's breach check is a live HTTPS call on every
    // password set. The control is covered against a stubbed corpus in
    // `apps/api/src/features/auth/breached-password.integration.test.ts`.
    QCMS_ADMIN_PASSWORD_BREACH_CHECK: "false",
  });
  // No `search_path`, unlike `openDbHandle` below: better-auth's tables are control-plane
  // tables declared on the `control` Drizzle schema, so the adapter qualifies them and
  // only the data plane is reached by unqualified name (ADR-40).
  const pool = new pg.Pool({ connectionString: databaseUrl });
  pool.on("error", () => undefined);
  const db = drizzle(pool, { schema }) as unknown as Executor;
  const built = { auth: createAdminAuth({ db, adminAuth: config.adminAuth }), db };
  instances.set(databaseUrl, built);
  return built;
}

export interface TestAdminInput {
  readonly databaseUrl: string;
  readonly authSecret: string;
  readonly adminBaseUrl: string;
  readonly email: string;
  readonly password: string;
  /**
   * Defaults to `E2E Admin`, whose initials the generated addresses also contain, so a
   * spec measuring the topbar monogram's accessible name has to name its own.
   */
  readonly name?: string;

  /**
   * Defaults to **false**: `signUpEmail` sets the flag on every account it creates, and
   * this helper stands in for an administrator who already has a password of their own.
   */
  readonly mustChangePassword?: boolean;

  /**
   * Defaults to every team role, plus `forms.owner` on the member row. An admin session
   * is necessary and not sufficient (ADR-41), so an account created by `signUpEmail`
   * alone reaches the membership screens and nothing else.
   *
   * Writes no audit row, so a count-based assertion does not start a row behind.
   */
  readonly grants?: readonly string[];

  /** Defaults to true. */
  readonly owner?: boolean;
}

/**
 * `signUpEmail` directly: the zero-admins guard belongs to `pnpm qcms:create-admin`.
 * There is no pool-closing helper: a Playwright worker shares this memoized instance
 * across files, so closing it would break the next file's `beforeAll`.
 */
export async function createTestAdmin(input: TestAdminInput): Promise<void> {
  const { auth, db } = authFor(input.databaseUrl, input.authSecret, input.adminBaseUrl);
  const created = await auth.api.signUpEmail({
    body: { email: input.email, password: input.password, name: input.name ?? "E2E Admin" },
    asResponse: true,
  });
  const body = (await created.json()) as { user?: { id?: unknown } };
  const userId = body.user?.id;

  // Before the credential state: an account sent to the password-change screen still
  // needs grants for the screens it reaches afterwards.
  if (typeof userId === "string") {
    await seedGrants(db, {
      userId,
      ...(input.grants === undefined ? {} : { grants: input.grants }),
      ...(input.owner === undefined ? {} : { owner: input.owner }),
    });
  }

  if (input.mustChangePassword === true) return;
  // The same write the API's password-change hook makes, through the same helper, so this
  // harness cannot arrive at a state the product cannot.
  if (typeof userId === "string") await clearMustChangePassword(db, userId);
}

const HARNESS_SEARCH_PATH = "-c search_path=data_prod,control";

export interface RawRows<R> {
  readonly rows: readonly R[];
}

/**
 * A raw read returns `timestamptz` as a string, not a `Date`, so callers that compare
 * instants must normalize.
 *
 * The search path is not optional (ADR-40): every data-plane table is declared
 * unqualified, so a pool that sets none fails with `relation "outbox" does not exist`.
 */
export function openDbHandle(connectionString: string): {
  readonly db: Executor;
  readonly query: <R>(text: string, values?: readonly unknown[]) => Promise<RawRows<R>>;
  readonly close: () => Promise<void>;
} {
  const pool = new pg.Pool({ connectionString, options: HARNESS_SEARCH_PATH });
  pool.on("error", () => undefined);
  return {
    db: drizzle(pool, { schema }),
    query: async <R>(text: string, values?: readonly unknown[]) =>
      pool.query<R & Record<string, unknown>>(text, values === undefined ? undefined : [...values]),
    close: () => pool.end(),
  };
}
