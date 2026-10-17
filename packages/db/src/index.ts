/**
 * @roonga/qcms-db public surface (task 013): the Drizzle schema for the operational
 * skeleton - questions and versions, forms/drafts/versions, sessions, secure
 * links, the append-only answer ledger, submissions, erasure tombstones, the
 * transactional outbox, and the better-auth tables.
 *
 * Migrations live in `migrations/` and are the package-owned, append-only
 * history adopters apply with `drizzle-kit migrate` on upgrade. The Testcontainers
 * test harness (`withTestDb`) is intentionally not part of this runtime surface -
 * it is a test-only utility under `src/testing/` that depends on devDependencies.
 */

// Named table/enum exports (tree-shakeable, deep-import-free per the API rules).
export * from "./schema/index.js";

// Aggregate namespace for `drizzle(client, { schema })`.
export * as schema from "./schema/index.js";

// Query helpers (task 014): the loading/persisting vocabulary the API slices
// call - every helper takes a Drizzle handle or transaction as its first
// argument. Shape-preserving reads and writes only (R3, R5).
export * from "./queries/index.js";

// The `reporting` view set's DDL generator and its documented column lists (task
// 075). Deliberately not re-exported through `schema/index.ts`, which is the
// module `drizzle-kit generate` diffs: the views are hand-authored SQL, so they
// sit beside the schema rather than inside it. Task 064's baseline and its
// environment command call it with their own `reporting_<env>`/`data_<env>` pair.
export * from "./reporting-views.js";

// The grant model, exported so the least-privilege suite asserts the lists the
// generator emits rather than a second hand-kept copy of them (criterion 6b).
// The operator commands that create and drop an environment (ADR-40, Q1, Q24, Q42).
// Exported from the package surface rather than reachable only through the CLI, so the
// API's own integration tests can create an environment the way an operator does.
// The environments a fresh database is created with, exported so a harness and a
// scaffold read the same list the baseline emits rather than re-typing `test, prod`.
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

// Access-group names and the role vocabulary (ADR-41, Q37, Q38, Q42; task 069). Pure
// derivations over rows, so the API's write path, the admin's rendering and the drop
// check's refusal all read the same four rules rather than each re-deriving them.
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

// The per-(workspace, environment) reporting consumers (Q26, task 067). On the package
// surface as well as behind the CLI, for the reason the environment command is: the
// least-privilege suite builds a pair the way an operator does and then asserts what that
// role can and cannot read (criterion 7).
export {
  type WorkspaceReportingPair,
  type WorkspaceReportingReport,
  reconcileWorkspaceReporting,
  refuseWorkspaceReportingNames,
  workspaceReportingStatementsForEnvironment,
} from "./environment/reporting.js";
