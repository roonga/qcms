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
 * `prod`: the unprefixed address shape (Q21), and the environment an **admin** request
 * that named none is served from.
 *
 * **A constant rather than a setting**, and that is the ruling rather than a preference.
 * ADR-40 takes a request's environment from exactly two sources, and since task 066 both
 * exist: the `/<env>/` route group on the respondent side (Q21), and the
 * administrator's switcher on the authoring side (Q6, task 065). Prod is the one
 * environment with no prefix, so a prefixed `prod` is not an address and `QCMS_MOUNT`
 * refuses the token.
 *
 * **It is no longer a fallback on the respondent path**, which is what Q53 said it was
 * until this task: every respondent group is mounted with its own environment
 * (`fixedEnvironment` in `middleware/request-environment.ts`), so a respondent request
 * cannot reach a handler without one. What remains is an **admin** client that sends no
 * `x-qcms-environment` header, which the shipped admin never does - it sets the header in
 * the one place it assembles them - and a defaulted `prod` is the conservative answer for
 * a hand-written caller: the authoring surface reads production, which is what the
 * operator is looking at if they have selected nothing.
 *
 * **It is not a default for minting**, and never becomes one (Q19). The mint's
 * `environment` is required on the API and a caller that omits it is refused, because a
 * script that omits the field and silently gets a production link is the failure that
 * rule exists to prevent.
 */
export const PROD_ENVIRONMENT = "prod";

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

/**
 * One environment's executor with the name of the environment it belongs to.
 *
 * The pair rather than the executor alone, because almost everything a handler does with
 * a pool also needs the name: the environment goes into the `sessions` row the per-schema
 * CHECK pins (Q46), into the release read, into the closed-state read and into the
 * challenge-provider read. A handler that held only the executor would have to ask
 * twice and could ask differently.
 */
export interface RequestDatabase {
  readonly environment: string;
  readonly exec: Executor;
}

/** The pools this process holds, and the rule for choosing between them. */
export interface Databases {
  /** The control plane. Authoring, identity, grants, releases, closes. */
  readonly control: Executor;
  /** Every environment in the live set, in the order the configuration names them. */
  readonly names: readonly string[];
  /**
   * The environment a request is served from when nothing named one:
   * {@link PROD_ENVIRONMENT}.
   *
   * On the interface rather than read from the constant at each call site, so a test can
   * substitute it. Since task 066 the respondent path never reaches it - each respondent
   * group is mounted with its own environment - so what falls back here is an admin
   * client that sent no switcher header.
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
   * `environment` is what the request itself named, and since task 066 there are two
   * sources and no third (ADR-40, Q2): the **mount group** on a respondent request, and
   * the **Q6 switcher's header** on an admin request. Both are installed as middleware
   * that sets `requestEnvironment` (`middleware/request-environment.ts`), and the admin
   * one validates the name against the live set and refuses an unknown one, so a name
   * that reaches here is one this process holds a pool for.
   *
   * **A respondent request still cannot name its own environment.** There is no header
   * for it to set: its environment comes from which group served it, which is what keeps
   * "test is reachable through secure links only" (ADR-40, SEC-14) a routing fact rather
   * than a handler's good manners. `undefined` falls back to
   * {@link Databases.defaultEnvironment}, which only an admin client that named nothing
   * can now reach.
   */
  forRequest(environment?: string): RequestDatabase;
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
 * The configured environment set and `control.environments` disagree (criterion 6a).
 *
 * **A type rather than a message, because the caller has to tell this apart from the
 * database being unreachable**, and the two want opposite handling. A disagreement is a
 * configuration fault that will not fix itself and that nothing downstream reports: it
 * refuses the boot. A failed read is very often a database that is not up yet - which is
 * the ordinary case on a Compose start, `depends_on` or not - and killing the process for
 * it would turn a few seconds of waiting into a crash loop. `/ready` is what covers that
 * one, and it covers it already.
 *
 * Without the distinction the boot refusal could only be all or nothing, and both choices
 * are wrong: fatal on any error is a crash loop, fatal on none leaves the two lists free
 * to disagree silently, which is exactly what criterion 6a forbids.
 */
export class EnvironmentSetMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentSetMismatchError";
  }
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
 *
 * Throws {@link EnvironmentSetMismatchError} on a disagreement and whatever the driver
 * threw on a failed read; see that type for why the caller needs them apart.
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
    throw new EnvironmentSetMismatchError(
      `the environment set and the configuration disagree (${parts.join("; ")})`,
    );
  }
}
