import { pgSchema } from "drizzle-orm/pg-core";

/**
 * The named Postgres schemas of ADR-40 (Q20, Q23).
 *
 * Every QCMS object lives in a schema QCMS named. `public` is left **empty**, off
 * every search path, with `CREATE` on it granted to nobody.
 *
 * - **`control`**: one copy, the control plane. Forms, versions, questions, links,
 *   releases, the live environment set, admin identity and the workspace tables.
 *   Declared here as a Drizzle schema so every control-plane table is emitted and
 *   queried **schema-qualified**, which is what makes the plane unambiguous whatever
 *   a connection's `search_path` happens to be.
 * - **`data_<env>`**: one per environment, the data plane. Sessions, the answer
 *   ledger, submissions, tombstones, the outbox, webhooks and deliveries. These are
 *   declared as **unqualified** `pgTable`s on purpose: the environment is chosen by
 *   the connection's `search_path` (`data_<env>, control`), so one schema module
 *   serves every environment and no query helper can name an environment it was not
 *   given a pool for. Criterion 3's resolution half is exactly that property.
 * - **`reporting_<env>`**: one view set per environment (Q10). Views only, read
 *   schema-qualified by `queries/reporting.ts` because that schema is on no search
 *   path.
 *
 * The two planes' table-name sets must stay **disjoint**, because `data_<env>` comes
 * first on the search path and a name in both would resolve to the environment's copy
 * with no error anywhere. `scripts/check-schema-disjoint.mjs` asserts the intersection
 * is empty and runs in `check:all`.
 */
export const controlSchema = pgSchema("control");

/** The name of the single control-plane schema. */
export const CONTROL_SCHEMA = "control";

/** `data_test` from `test`. The data-plane schema for one environment (Q23). */
export function dataSchemaName(environment: string): string {
  return `data_${environment}`;
}

/** `reporting_test` from `test`. The reporting view schema for one environment (Q10). */
export function reportingSchemaName(environment: string): string {
  return `reporting_${environment}`;
}

/** `qcms_app_test` from `test`. The application role for one environment (Q17, Q40). */
export function environmentRoleName(environment: string): string {
  return `qcms_app_${environment}`;
}

/**
 * The control-plane application role (Q40). One, whatever the environment set is:
 * better-auth, authoring, grants, releases, closes and audit reads all run on it.
 */
export const CONTROL_ROLE = "qcms_app_control";

/**
 * The prefix every `qcms_app%` role shares, and the shape the migrate-only revokes
 * are written against (Q40, finding B). The revoke names a **prefix**, not a role:
 * an installation that creates `qcms_app_staging` next week gets the same control
 * without anybody editing a migration.
 */
export const APPLICATION_ROLE_PREFIX = "qcms_app";

/**
 * Every prefix an environment's name is interpolated into, which is what the Q42
 * length limit is **derived** from rather than written as a constant.
 *
 * A literal limit goes stale the first time somebody adds a longer prefix, and it
 * goes stale silently, because a too-generous limit fails only at the truncation it
 * was meant to prevent. Task 067 adds the reporting consumer role's prefix here when
 * it names one (Q26); if that prefix is longer than `reporting_`, the limit drops and
 * nothing else has to change.
 */
export const ENVIRONMENT_NAME_PREFIXES = ["data_", "reporting_", `${APPLICATION_ROLE_PREFIX}_`];
