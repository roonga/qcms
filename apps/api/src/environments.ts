/**
 * A pool is a connection, a connection is a role, and a role is an environment, so which
 * pool a handler runs on is a privilege boundary the database enforces. `search_path` is
 * a resolution default and not a grant: a statement naming another environment's schema
 * is refused on privilege.
 */

import { schema } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import type { Config } from "./config.js";

const { Pool } = pg;

// The unprefixed address shape, and the environment an admin request that named none is
// served from. Never a default for link minting (Q19): the mint requires an explicit one.
export const PROD_ENVIRONMENT = "prod";

export function environmentSearchPath(environment: string): string {
  return `data_${environment},control`;
}

// No data schema: the control pool must not resolve an unqualified data-plane name.
export const CONTROL_SEARCH_PATH = "control";

export interface RequestDatabase {
  readonly environment: string;
  readonly exec: Executor;
}

export interface Databases {
  readonly control: Executor;
  /** In the order the configuration names them. */
  readonly names: readonly string[];
  /** On the interface rather than read from the constant, so a test can substitute it. */
  readonly defaultEnvironment: string;
  /**
   * Throws rather than falling back on an unheld name: a request whose environment is
   * unknown must not be served from prod.
   */
  for(environment: string): Executor;
  /**
   * A respondent request cannot name its own environment; it comes from which group
   * served it, which is what keeps SEC-14 a routing fact. Only an admin client that
   * named nothing reaches the default.
   */
  forRequest(environment?: string): RequestDatabase;
}

// Returns the pools so the composition root can close them on shutdown; nothing else
// may reach them.
export function openDatabases(config: Config): {
  readonly databases: Databases;
  readonly pools: readonly pg.Pool[];
} {
  const controlPool = new Pool({
    connectionString: config.databaseUrl,
    options: `-c search_path=${CONTROL_SEARCH_PATH}`,
  });
  const byEnvironment = new Map<string, { pool: pg.Pool; executor: Executor }>();
  for (const environment of config.environments) {
    const pool = new Pool({
      connectionString: environment.databaseUrl,
      options: `-c search_path=${environmentSearchPath(environment.name)}`,
    });
    byEnvironment.set(environment.name, { pool, executor: drizzle(pool, { schema }) });
  }

  const databases: Databases = {
    control: drizzle(controlPool, { schema }),
    names: config.environments.map((environment) => environment.name),
    defaultEnvironment: PROD_ENVIRONMENT,
    for(environment: string): Executor {
      const found = byEnvironment.get(environment);
      if (found === undefined) {
        throw new Error(`no connection pool for environment ${environment}`);
      }
      return found.executor;
    },
    forRequest(environment?: string): RequestDatabase {
      const chosen = environment ?? this.defaultEnvironment;
      return { environment: chosen, exec: this.for(chosen) };
    },
  };

  return {
    databases,
    pools: [controlPool, ...[...byEnvironment.values()].map((entry) => entry.pool)],
  };
}

/**
 * A distinct type so the caller can tell a configuration disagreement, which refuses the
 * boot, from an unreachable database, which must not turn a slow start into a crash loop.
 */
export class EnvironmentSetMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentSetMismatchError";
  }
}

/**
 * Checked in both directions: each omission is otherwise silent, leaving either a pool
 * whose `search_path` resolves to nothing or an environment nothing sweeps or drains.
 */
export async function assertEnvironmentsMatch(databases: Databases): Promise<void> {
  // A raw fragment rather than a query helper: this runs before the process is known to
  // be sound, so it depends on nothing but the connection and one table.
  const rows = await databases.control.execute<{ name: string }>(
    sql`select name from control.environments order by position`,
  );
  const inDatabase = rows.rows.map((row) => row.name);
  const configured = new Set(databases.names);
  const missingCredential = inDatabase.filter((name) => !configured.has(name));
  const missingRow = databases.names.filter((name) => !inDatabase.includes(name));

  if (missingCredential.length > 0 || missingRow.length > 0) {
    const parts: string[] = [];
    if (missingRow.length > 0) {
      parts.push(`configured but absent from control.environments: ${missingRow.join(", ")}`);
    }
    if (missingCredential.length > 0) {
      parts.push(
        `present in control.environments but not configured: ${missingCredential.join(", ")}`,
      );
    }
    throw new EnvironmentSetMismatchError(
      `the environment set and the configuration disagree (${parts.join("; ")})`,
    );
  }
}
