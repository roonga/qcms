/**
 * The pools: one per environment, plus a control pool, inside one API process
 * (ADR-40, Q2 with Q40).
 *
 * # Why the split is a privilege boundary and not a tidy-up
 *
 * A pool is a connection, a connection is a role, and a role is an environment (Q17).
 * So which pool a handler runs on decides what the database will let it do, and the
 * three decisions line up rather than merely coexisting:
 *
 *   - **the control pool** connects as `qcms_app_control` with `search_path=control`.
 *     It serves better-auth, authoring, grants, releases and closes. It holds no
 *     privilege on any data-plane table except `INSERT` on each environment's `outbox`
 *     (Q49), so "an author never reads production personal data" holds **at the
 *     database** and not only in an API check.
 *   - **an environment pool** connects as `qcms_app_<env>` with
 *     `search_path=data_<env>,control`. It serves the respondent path, delivery,
 *     retention, reporting reads and export for that environment. It holds no privilege
 *     of any kind on `user`, `session`, `account`, `verification`, `twoFactor`,
 *     `two_factor_resets`, `invitation`, `member`, `team` or `teamMember`, so a defect
 *     on the anonymous respondent path cannot rewrite a grant row or a staff session.
 *
 * ADR-20's four containers are unchanged: this is one process holding several pools,
 * not a process per environment.
 *
 * # Resolution and privilege are two mechanisms, not one
 *
 * The `search_path` is what makes an unqualified `sessions` mean *this* environment's
 * sessions, and it is a **resolution default, not a grant**. A statement that named
 * another environment's schema explicitly would still be refused, because the role has
 * no privilege there. Criterion 3 asserts both halves for exactly that reason: the
 * first alone is unsatisfiable as an isolation claim.
 */

import { schema } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import type { Config } from "./config.js";

const { Pool } = pg;

/**
 * The environment every request and every newly minted link resolves to, until tasks 065
 * and 066 land (Code Owner, 2026-09-29, Q53).
 *
 * **A constant rather than a setting**, and that is the ruling rather than a preference.
 * ADR-40 takes the request's environment from the `/<env>/` route group on the
 * respondent side (Q21, task 066) and from the administrator's switcher on the authoring
 * side (Q6, task 065). Neither exists yet, and Q19 refuses a *default* for link minting
 * for a precise reason: a script that omits the field and silently gets a production
 * link is the failure that rule exists to prevent. An operator-settable interim default
 * would be exactly that failure wearing a configuration key, so the interim answer is
 * fixed, is `prod`, and is one identifier the two later tasks replace.
 *
 * **`test` is not dead while this stands.** It exists on the layout, the baseline creates
 * it, the environment generator's tests and the least-privilege suite exercise it - by
 * naming it explicitly, which is what those suites do anyway because a test that relied
 * on the interim default would stop testing the thing it was written for the moment 066
 * changed it.
 */
export const INTERIM_REQUEST_ENVIRONMENT = "prod";

/** The schema search path a pool for `environment` connects with. */
export function environmentSearchPath(environment: string): string {
  return `data_${environment},control`;
}

/**
 * The search path the **control** pool connects with.
 *
 * `control` alone, and no data schema: the control pool is not meant to resolve an
 * unqualified data-plane name at all. The one statement it issues into a data schema
 * names it explicitly (`enqueueInEnvironment`), which is the single, named exception to
 * criterion 3's resolution half.
 */
export const CONTROL_SEARCH_PATH = "control";

/** The pools this process holds, and the rule for choosing between them. */
export interface Databases {
  /** The control plane. Authoring, identity, grants, releases, closes. */
  readonly control: Executor;
  /** Every environment in the live set, in the order the configuration names them. */
  readonly names: readonly string[];
  /**
   * The environment a request is served from until task 066's `/<env>/` route group and
   * task 065's switcher exist: {@link INTERIM_REQUEST_ENVIRONMENT}.
   *
   * On the interface rather than read from the constant at each call site, so a test can
   * substitute it and 065 and 066 have one field to make per-request.
   */
  readonly defaultEnvironment: string;
  /**
   * The executor for one environment.
   *
   * Throws on a name the process holds no pool for, rather than falling back to the
   * default: a request that somehow reached a handler naming an environment this
   * deployment does not serve is a request whose environment is unknown, and serving it
   * from `prod` is the failure Q19 refuses in the link-minting case for the same reason.
   */
  for(environment: string): Executor;
  /**
   * The environment a respondent or response-reading request is served from, with its
   * executor.
   *
   * **This is the one interim seam** (see {@link Databases.defaultEnvironment}). Task
   * 066 replaces its body with the `/<env>/` route group's value and task 065 with the
   * administrator's switcher; until then every such request resolves to the one
   * configured default. Everything downstream of it - the pool, the grants, the search
   * path, the per-environment tests - is already real, so what those tasks change is the
   * choosing and nothing else.
   */
  forRequest(): { readonly environment: string; readonly exec: Executor };
}

/**
 * Open every pool from the validated configuration.
 *
 * Returns the pools beside the {@link Databases} so the composition root can close them
 * on shutdown; nothing else may reach them.
 */
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
    defaultEnvironment: INTERIM_REQUEST_ENVIRONMENT,
    for(environment: string): Executor {
      const found = byEnvironment.get(environment);
      if (found === undefined) {
        throw new Error(`no connection pool for environment ${environment}`);
      }
      return found.executor;
    },
    forRequest(): { readonly environment: string; readonly exec: Executor } {
      return { environment: this.defaultEnvironment, exec: this.for(this.defaultEnvironment) };
    },
  };

  return {
    databases,
    pools: [controlPool, ...[...byEnvironment.values()].map((entry) => entry.pool)],
  };
}

/**
 * Refuse to boot when the configured environment set and `control.environments`
 * disagree (criterion 6a).
 *
 * Both directions, because each is a different operational mistake and both are silent
 * otherwise. A configuration naming an environment the database does not hold would
 * open a pool whose `search_path` resolves to nothing, and every respondent request
 * through it would fail on a missing relation rather than on a misconfiguration. A
 * database holding an environment the configuration has no credential for would serve
 * that environment from nowhere: its retention sweep would never run, its outbox would
 * never drain, and nothing would say so.
 *
 * Read on the **control** pool, which is the one connection the process has before any
 * environment pool is known to be usable.
 */
export async function assertEnvironmentsMatch(databases: Databases): Promise<void> {
  // A raw fragment rather than a query helper: this runs before the process is known to
  // be sound, so it deliberately depends on nothing but the connection and one table.
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
    throw new Error(`the environment set and the configuration disagree (${parts.join("; ")})`);
  }
}
