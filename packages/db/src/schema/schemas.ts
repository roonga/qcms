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
 * The prefix of the per-(workspace, environment) reporting consumer role (Q26, task
 * 067): `qcms_reporting_<env>_<workspace slug>`.
 *
 * **It is the family name of `docs/reporting-view.md`'s `qcms_reporting` recipe with the
 * two dimensions appended**, which is what makes an operator reading `pg_roles` able to
 * tell a reporting consumer from an application role at a glance: every one of them
 * starts `qcms_reporting_` and every application role starts `qcms_app_`.
 *
 * The environment comes **before** the workspace because the environment is the half the
 * Q42 length rule is derived from: a name is interpolated into this prefix, so this
 * prefix joins {@link ENVIRONMENT_NAME_PREFIXES} below. The workspace slug that follows
 * is bounded by its own check at the one place these roles are created
 * (`reconcileWorkspaceReporting`), because a prefix list cannot express "and then a slug".
 */
export const WORKSPACE_REPORTING_ROLE_PREFIX = "qcms_reporting_";

/**
 * Every prefix an environment's name is interpolated into, which is what the Q42
 * length limit is **derived** from rather than written as a constant.
 *
 * A literal limit goes stale the first time somebody adds a longer prefix, and it
 * goes stale silently, because a too-generous limit fails only at the truncation it
 * was meant to prevent.
 *
 * **Task 067 added the fourth** (Q26, ADR-40's name paragraph). The reporting consumer
 * role is per (workspace, environment), so its name is interpolated with an environment
 * name, and `qcms_reporting_` is longer than `reporting_` - so the derived limit **drops
 * from 53 to 48 bytes**, which is the whole of what the ruling asked this task to do
 * here. Nothing else changes: `maxEnvironmentNameLength` reads this list.
 */
export const ENVIRONMENT_NAME_PREFIXES = [
  "data_",
  "reporting_",
  `${APPLICATION_ROLE_PREFIX}_`,
  WORKSPACE_REPORTING_ROLE_PREFIX,
];

/**
 * `qcms_reporting_prod_home` from `prod` and `home`. The read-only role one workspace's
 * analysts are granted in one environment (Q26, task 067).
 *
 * The **slug** rather than the workspace id, so an operator granting the role to a person
 * reads a name they recognise; the **views** the role is granted are filtered on the
 * workspace **id**, which is the stable half, so a grant and a filter cannot disagree
 * about which workspace they mean.
 */
export function workspaceReportingRoleName(environment: string, workspaceSlug: string): string {
  return `${WORKSPACE_REPORTING_ROLE_PREFIX}${environment}_${workspaceSlug}`;
}

/**
 * `home_responses` from `home` and `responses`. One workspace's view inside
 * `reporting_<env>` (Q26).
 *
 * The unprefixed `responses` and `answers_flat` stay beside them: those are the
 * application's own (Q52, task 064), granted to `qcms_app_<env>` and to no consumer, and
 * each workspace's pair is a filtered projection of them, so the erasure and
 * submitted-only row rules live in exactly one place.
 */
export function workspaceReportingViewName(workspaceSlug: string, view: string): string {
  return `${workspaceSlug}_${view}`;
}
