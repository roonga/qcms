import { readFileSync } from "node:fs";

import { schema } from "@qcms/db";
import type { Executor } from "@qcms/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

/**
 * The admin's database handle (task 031), server-only.
 *
 * The admin app owns better-auth, and better-auth keeps its users, sessions,
 * accounts and TOTP secrets in the deployment's own Postgres (ARCHITECTURE §7) -
 * the same database the API uses, with the auth tables deliberately isolated from
 * the domain tables (no cross foreign keys). So the admin needs one Drizzle handle,
 * and this is it.
 *
 * R2 is intact: this handle exists for **auth** (better-auth's adapter) and for
 * nothing else. Admin screens read and write questionnaire data by proxying to the
 * API's `/admin` group (`lib/server/api.ts`); no BFF route queries a domain table.
 * The R2 import-surface test enforces that.
 *
 * The pool is memoized by connection string rather than by module, which is what
 * makes the e2e seam below safe.
 */

const { Pool } = pg;

/** One pool per connection string, so a changed URL yields a fresh pool. */
const pools = new Map<string, { readonly pool: pg.Pool; readonly handle: Executor }>();

/**
 * The Postgres connection string.
 *
 * In every real composition this is `DATABASE_URL`. `QCMS_ADMIN_E2E_FIXTURES` is a
 * deliberate **test-only seam**: the Playwright suite boots a throwaway
 * Testcontainers Postgres on a random port inside its `globalSetup`, which runs in
 * a different process from this dev server and finishes after the dev server has
 * already been asked to start. Reading the URL from the fixtures file that setup
 * writes, at request time, means the admin server never has to be handed a URL it
 * could not have known at spawn time, and a dev server reused across two runs
 * picks up the second run's database instead of holding a dead pool from the
 * first. Nothing reads the file when the env var is unset, which is the case in
 * production.
 */
export function databaseUrl(): string {
  const fixturesPath = process.env.QCMS_ADMIN_E2E_FIXTURES;
  if (fixturesPath !== undefined && fixturesPath !== "") {
    const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")) as { databaseUrl?: string };
    if (typeof fixtures.databaseUrl === "string" && fixtures.databaseUrl !== "") {
      return fixtures.databaseUrl;
    }
    throw new Error("QCMS_ADMIN_E2E_FIXTURES file carries no databaseUrl");
  }
  const value = process.env.DATABASE_URL;
  if (value === undefined || value === "") {
    throw new Error("Missing required server env var DATABASE_URL");
  }
  return value;
}

/** The Drizzle handle better-auth's adapter runs on. */
export function adminDb(): Executor {
  const url = databaseUrl();
  const existing = pools.get(url);
  if (existing !== undefined) return existing.handle;
  const pool = new Pool({ connectionString: url });
  const handle = drizzle(pool, { schema }) as unknown as Executor;
  pools.set(url, { pool, handle });
  return handle;
}

/**
 * Close every pool this module opened.
 *
 * A long-running server never calls this. Tests do, and they have to: an open pool
 * keeps the event loop alive, and a Testcontainers teardown that stops Postgres while a
 * client is still connected surfaces as an unhandled `terminating connection due to
 * administrator command` that Vitest reports as a run-level error even when every
 * assertion passed.
 */
export async function closeAdminDb(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map(({ pool }) => pool.end()));
}
