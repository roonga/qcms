/**
 * `@roonga/qcms-db`'s public surface. The Testcontainers harness (`withTestDb`) is
 * deliberately absent: it is a test-only utility that depends on devDependencies.
 */

export * from "./schema/index.js";

// Aggregate namespace for `drizzle(client, { schema })`.
export * as schema from "./schema/index.js";

export * from "./queries/index.js";

// Not re-exported through `schema/index.ts`, which is the module `drizzle-kit generate`
// diffs: the views are hand-authored SQL.
export * from "./reporting-views.js";

// Exported so a harness and a scaffold read the same list the baseline emits.
export { SHIPPED_ENVIRONMENTS } from "./environment/baseline.js";

export {
  type CreatedEnvironment,
  type DropRefusal,
  type EnvironmentSettings,
  RESERVED_ENVIRONMENT_NAMES,
  UNDROPPABLE_ENVIRONMENT,
  createEnvironment,
  dropEnvironment,
  maxEnvironmentNameLength,
  ownsControlSchema,
  refuseEnvironmentName,
} from "./environment/command.js";

export * from "./access-groups.js";

export {
  CONTROL_FORBIDDEN_TABLES,
  CONTROL_READ_TABLES,
  CONTROL_READ_TABLES_GUARDED_ON_EXISTENCE,
  DATA_PLANE_ENUM_TYPES,
  grantAccessAuditStatements,
  environmentObjectNames,
  workspaceReportingStatements,
  type EnvironmentObjectNames,
} from "./environment/sql.js";

// On the package surface as well as behind the CLI, so the least-privilege suite builds a
// pair the way an operator does and then asserts what that role can and cannot read.
export {
  type WorkspaceReportingPair,
  type WorkspaceReportingReport,
  reconcileWorkspaceReporting,
  refuseWorkspaceReportingNames,
  workspaceReportingStatementsForEnvironment,
} from "./environment/reporting.js";

// Exported so the restore drill and the least-privilege suites call the same code the
// migrations do. `listEnvironmentNames` is deliberately NOT re-exported: the star export
// above already carries `queries/grants.ts`'s, and a second would shadow it.
export {
  GRANT_SOURCES,
  UNREAPPLIABLE_SOURCES,
  type GrantPass,
  type GrantSource,
  controlRoleGrantStatements,
  lockPublicStatements,
  migrationBackedStatements,
  regrantPasses,
} from "./environment/grants.js";

export { type RegrantReport, regrantEnvironments, unreappliedNote } from "./environment/regrant.js";
