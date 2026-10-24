import { pgSchema } from "drizzle-orm/pg-core";

/**
 * Control and data plane table names must stay disjoint: `data_<env>` comes first on the
 * search path, so a name in both resolves to the environment's copy with no error.
 */
export const controlSchema = pgSchema("control");

/** The name of the single control-plane schema. */
export const CONTROL_SCHEMA = "control";

/** The data-plane schema for one environment. */
export function dataSchemaName(environment: string): string {
  return `data_${environment}`;
}

/** The reporting view schema for one environment. */
export function reportingSchemaName(environment: string): string {
  return `reporting_${environment}`;
}

/** The application role for one environment. */
export function environmentRoleName(environment: string): string {
  return `qcms_app_${environment}`;
}

/** The control-plane application role, one whatever the environment set is. */
export const CONTROL_ROLE = "qcms_app_control";

/**
 * The migrate-only revokes name this prefix rather than a role, so a role created later
 * gets the same control with no migration.
 */
export const APPLICATION_ROLE_PREFIX = "qcms_app";

/**
 * The environment comes before the workspace slug because only the environment half is
 * bounded by {@link ENVIRONMENT_NAME_PREFIXES}; the slug is bounded at
 * `reconcileWorkspaceReporting`.
 */
export const WORKSPACE_REPORTING_ROLE_PREFIX = "qcms_reporting_";

/** The identifier length limit is derived from this list, so a new prefix belongs here. */
export const ENVIRONMENT_NAME_PREFIXES = [
  "data_",
  "reporting_",
  `${APPLICATION_ROLE_PREFIX}_`,
  WORKSPACE_REPORTING_ROLE_PREFIX,
];

/** The read-only role one workspace's analysts are granted in one environment. */
export function workspaceReportingRoleName(environment: string, workspaceSlug: string): string {
  return `${WORKSPACE_REPORTING_ROLE_PREFIX}${environment}_${workspaceSlug}`;
}

/** One workspace's filtered view inside `reporting_<env>`. */
export function workspaceReportingViewName(workspaceSlug: string, view: string): string {
  return `${workspaceSlug}_${view}`;
}
