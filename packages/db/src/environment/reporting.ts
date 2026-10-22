/**
 * The per-(workspace, environment) reporting consumers (Q26, ADR-40's reporting Note,
 * ADR-41; task 067).
 *
 * # Why this is an operator command and not an API route
 *
 * A workspace is created over HTTP (`POST /admin/workspaces`), and that request runs on
 * `qcms_app_control`, which holds **no DDL anywhere and never will** (SEC-10). Creating a
 * view is DDL and creating a role is cluster-level, so the view set a new workspace needs
 * in every environment cannot be written by the request that created the workspace. It is
 * the same boundary the environment command already lives on, and the same answer: a
 * command under the **migration** credential, run by an operator, refusing an application
 * credential by testing schema ownership rather than a role name.
 *
 * The operational consequence is stated rather than hidden, in `docs/reporting-view.md`
 * and `docs/operations.md`: **after creating a workspace, run this**. It is the sibling of
 * Q59's "after creating an environment, restart the API" and it is honest for the same
 * reason - the operator is already at a shell with the migration credential.
 *
 * # Why it reconciles rather than creating
 *
 * The set of things that should exist is the cross product of two lists that both change
 * (the live environment set and the workspaces), so a command that created one pair would
 * need the operator to work out which pairs were missing. This one reads both lists and
 * makes every pair true, with `CREATE OR REPLACE VIEW` and grants that are no-ops when
 * already held, so running it twice is running it once. The environment-create command
 * calls the same emission for the environment it is building, so an environment created
 * next year arrives with every workspace's views in it.
 *
 * # It never drops anything
 *
 * An archived workspace keeps its views, and a pair whose workspace was archived is
 * reported rather than removed. Two reasons: Q66 makes an archive terminal but says
 * nothing about destroying the record of what it held, and these views are what an
 * adopter's BI tool is connected to - a command that tidied one away would break a report
 * as a side effect of an administrative act, which is the cascade Q15 refuses one object
 * over. Removing a consumer's access is a **revoke of the role**, which is an operator act
 * with its own name.
 */

import { sql } from "drizzle-orm";

import type { Executor } from "../queries/executor.js";
import { listWorkspaces } from "../queries/workspaces.js";
import {
  CONTROL_SCHEMA,
  environmentRoleName,
  reportingSchemaName,
  workspaceReportingRoleName,
} from "../schema/schemas.js";
import { workspaceReportingViewNames } from "../reporting-views.js";

import { createLoginRole } from "./role.js";
import { workspaceReportingGrantStatements, workspaceReportingStatements } from "./sql.js";

/**
 * Postgres truncates an identifier longer than `NAMEDATALEN - 1` bytes, silently. 63 with
 * the default `NAMEDATALEN` of 64.
 *
 * Restated here rather than imported from `./command.js`, which would be a cycle: that
 * module imports this one so the environment-create path emits these statements.
 */
const MAX_IDENTIFIER_BYTES = 63;

/**
 * A well-formed workspace slug: lowercase letters, digits and hyphens, starting and
 * ending with a letter or a digit.
 *
 * **Restated here rather than imported**, and the restatement is load-bearing in a way the
 * usual "one rule, one place" argument does not cover. The rule is the API's
 * (`apps/api/src/features/workspaces/rules.ts`, ADR-41) and `@roonga/qcms-db` cannot
 * import an application. What this copy is for is different: the statements below are
 * **DDL built from a database row**, and a row is not a request. `organization.slug` has no
 * CHECK on it, better-auth's own `createOrganization` is a second writer, and an operator
 * with the migration credential is a third - so a slug reaching this module has not
 * necessarily passed the route's validator. An identifier cannot be a bind parameter, so
 * the guard is the only thing between a hand-written row and a `CREATE VIEW` built from
 * it. A slug that fails it is refused and named, never quoted and hoped for.
 */
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One (workspace, environment) reporting consumer, as the command reports it. */
export interface WorkspaceReportingPair {
  readonly environment: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  /** `reporting_<env>`, the schema the pair's views live in. */
  readonly reportingSchema: string;
  /** `qcms_reporting_<env>_<slug>`, the read-only role the pair's analysts are granted. */
  readonly role: string;
  /** The two view names, in the order `reportingViewColumns` lists them. */
  readonly views: readonly string[];
  /** Whether that role exists in the cluster, so the grants above actually landed. */
  readonly roleExists: boolean;
  /** Whether the workspace is archived, in which case its views are kept, not removed. */
  readonly archived: boolean;
}

/** What the reconciliation did, and what it refused. */
export interface WorkspaceReportingReport {
  readonly pairs: readonly WorkspaceReportingPair[];
  /**
   * The pairs this could not name, one sentence each, naming the identifier that would
   * not fit.
   *
   * A refusal rather than a truncation, for the reason Q42 gives for an environment name:
   * Postgres truncates an over-long identifier **silently**, so two workspaces whose
   * slugs differ only past the limit would quietly share one role.
   */
  readonly refusals: readonly string[];
}

/**
 * Why a (workspace, environment) pair cannot be named, or `undefined` when it can.
 *
 * The environment half of the length rule is already enforced by
 * `refuseEnvironmentName`, whose limit is derived from a prefix list this task added
 * `qcms_reporting_` to. That list cannot express "and then a workspace slug", so the
 * other half is checked here, at the one place these identifiers are built - and it is
 * checked over **every** identifier the pair derives rather than only the longest, so the
 * refusal names the one an operator has to shorten.
 */
export function refuseWorkspaceReportingNames(
  environment: string,
  workspaceSlug: string,
): string | undefined {
  if (!WORKSPACE_SLUG_PATTERN.test(workspaceSlug)) {
    return (
      `the workspace slug ${JSON.stringify(workspaceSlug)} cannot name a reporting view: ` +
      `it must match ${WORKSPACE_SLUG_PATTERN.source} - lowercase letters, digits and ` +
      "hyphens, starting and ending with a letter or a digit. A view name is an " +
      "identifier and no bind parameter can carry one, so a slug this command would have " +
      "to quote and hope for is refused instead."
    );
  }
  const derived = [
    workspaceReportingRoleName(environment, workspaceSlug),
    ...workspaceReportingViewNames(workspaceSlug),
  ];
  const tooLong = derived.find((name) => Buffer.byteLength(name, "utf8") > MAX_IDENTIFIER_BYTES);
  if (tooLong === undefined) return undefined;
  return (
    `the workspace ${workspaceSlug} cannot have reporting views in ${environment}: ` +
    `the identifier ${tooLong} is ${String(Buffer.byteLength(tooLong, "utf8"))} bytes and ` +
    `Postgres silently truncates one over ${String(MAX_IDENTIFIER_BYTES)}. Rename the ` +
    "workspace's slug or the environment and run this again."
  );
}

/** `'x'` from `x`. A SQL string literal, with the doubling rule. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Whether a role exists in the cluster. */
async function roleExists(exec: Executor, role: string): Promise<boolean> {
  const result = await exec.execute<{ found: boolean }>(
    sql`select exists (select 1 from pg_roles where rolname = ${role}) as found`,
  );
  return result.rows[0]?.found ?? false;
}

/**
 * Every workspace's view set for **one** environment, as statements.
 *
 * Called by `createEnvironment` inside its own transaction, so a new environment arrives
 * with every workspace's views already in it rather than waiting for somebody to
 * remember the reconciliation. The grants are guarded on each role existing, so this is
 * correct in the ordinary case where the roles for a brand-new environment do not exist
 * yet.
 *
 * The refusal is **not** raised here: a workspace whose slug is too long for this
 * environment's identifiers must not stop the environment being created, because the
 * environment is the thing being asked for and its own name has already passed the Q42
 * rule. Such a pair is skipped, and the reconciliation below is what reports it.
 */
export async function workspaceReportingStatementsForEnvironment(
  exec: Executor,
  environment: string,
): Promise<string[]> {
  // **Every** workspace, archived ones included, which is the list the reconciliation
  // covers (PR #1093's review, finding 6). The two used to differ, so a new environment
  // lacked an archived workspace's views until somebody ran the reconciliation. An archive
  // is terminal (Q66) and says nothing about destroying the record of what the workspace
  // held, and those views are what a BI tool is connected to - so a new environment gets
  // them too, and the two paths now answer the same question.
  const workspaces = await listWorkspaces(exec);
  return workspaces
    .filter((workspace) => refuseWorkspaceReportingNames(environment, workspace.slug) === undefined)
    .flatMap((workspace) =>
      workspaceReportingStatements({
        environment,
        slug: workspace.slug,
        workspaceId: workspace.id,
      }),
    );
}

/**
 * Every workspace's reporting **grants** for one environment, and no DDL (issue #1094).
 *
 * The re-grant subcommand's source. `pg_dump --no-privileges` keeps the views and loses
 * these, so a restore needs exactly this half - and a `regrant` that also emitted the
 * `CREATE OR REPLACE VIEW` would **create** a view set for a workspace nobody had
 * reconciled, which the restore drill caught it doing. Creating the views is
 * {@link reconcileWorkspaceReporting}'s job, and `docs/reporting-view.md` says to run it
 * after creating a workspace.
 *
 * The same filter as {@link workspaceReportingStatementsForEnvironment}: a pair whose slug
 * is too long for this environment's identifiers is skipped rather than raised, because a
 * grant pass must not fail over a pair the reconciliation is what reports.
 */
export async function workspaceReportingGrantsForEnvironment(
  exec: Executor,
  environment: string,
): Promise<string[]> {
  const workspaces = await listWorkspaces(exec);
  return workspaces
    .filter((workspace) => refuseWorkspaceReportingNames(environment, workspace.slug) === undefined)
    .flatMap((workspace) =>
      workspaceReportingGrantStatements({ environment, slug: workspace.slug }),
    );
}

/**
 * Take back the `SELECT` the baseline's `ALL TABLES` grant reaches on a **restored**
 * database: task 067's per-workspace views, which the application role must not hold
 * (ADR-40, Q52; issue #1094).
 *
 * # Why this is needed only on a restore, and why it is a revoke
 *
 * `grantEnvironmentStatements` hands the application role
 * `GRANT SELECT ON ALL TABLES IN SCHEMA reporting_<env>`. That is a grant on the views
 * that exist **at that moment** and not a standing rule, and in every live path it runs
 * before any per-workspace view exists: the baseline creates `responses` and
 * `answers_flat` and grants, and `createEnvironment` does the same before it reconciles
 * this environment's workspace views. So on a migrated installation the application role
 * holds exactly the two environment-wide views, which is what the record says it holds -
 * the per-workspace pair belongs to the analysts' role, and `workspaceReportingStatements`
 * above says so in as many words.
 *
 * A **restore** inverts the order. The views come back inside the dump, so the same
 * `ALL TABLES` statement now reaches every workspace's pair too, and the re-granted
 * database would hold more than the migrated one it is supposed to equal. No migration
 * carries this revoke because no migration ever runs in that order.
 *
 * It is a **narrowing and can only ever be one**: `REVOKE SELECT` on views named by 067's
 * own `workspaceReportingViewNames`, from the one role `environmentRoleName` derives.
 *
 * # Why each revoke is guarded on the privilege actually being held
 *
 * Not tidiness. A `REVOKE` on a relation whose `relacl` is NULL **materialises** that ACL:
 * Postgres writes out the owner's own implicit entries, so `aclexplode` starts reporting
 * seven rows for a relation that is semantically unchanged. On an installation whose
 * per-workspace reporting roles do not exist - the Compose stack is one, because its
 * `db-roles` one-shot creates the four application roles and nothing else - the views
 * carry no ACL at all, and an unconditional revoke would make the restored database differ
 * from the migrated one in the grant map while differing from it in no privilege. The
 * restore drill caught exactly that. So each view is revoked only where the application
 * role really holds `SELECT` on it, which is precisely the over-reach this corrects.
 *
 * The two guards are **nested** rather than `AND`ed, because PostgreSQL does not promise
 * to short-circuit a boolean operator, and `has_table_privilege` raises on a role that
 * does not exist. `to_regclass` is the third: a workspace whose views have not been
 * reconciled into this environment yet has none to revoke on.
 *
 * The alternative is to narrow the baseline's statement to the two views it means, which
 * is the same correction 067 made for the analysts' role one paragraph up. That edits a
 * published migration, so it is a Code Owner decision rather than this issue's, and it is
 * recorded as one in PR #1099.
 */
export async function revokeWorkspaceViewsFromEnvironmentRole(
  exec: Executor,
  environment: string,
): Promise<string[]> {
  const workspaces = await listWorkspaces(exec);
  const reporting = reportingSchemaName(environment);
  const role = environmentRoleName(environment);
  return workspaces
    .filter((workspace) => refuseWorkspaceReportingNames(environment, workspace.slug) === undefined)
    .flatMap((workspace) => workspaceReportingViewNames(workspace.slug))
    .map(
      (view) => `DO $$
DECLARE qualified text := ${literal(`"${reporting}"."${view}"`)};
BEGIN
\tIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(role)}) THEN
\t\tIF to_regclass(qualified) IS NOT NULL THEN
\t\t\tIF has_table_privilege(${literal(role)}, qualified, 'SELECT') THEN
\t\t\t\tEXECUTE format('REVOKE SELECT ON %s FROM %I', qualified, ${literal(role)});
\t\t\tEND IF;
\t\tEND IF;
\tEND IF;
END
$$;`,
    );
}

/**
 * Make every (workspace, environment) pair's views and grants true, and report what they
 * are (Q26).
 *
 * One transaction, like `createEnvironment`: Postgres runs DDL transactionally, so a run
 * that fails half way leaves nothing for an operator to clean up before retrying.
 *
 * `create` names the one pair whose **role** this run should create, with the credential
 * it logs in with. Without it no role is created and the grants land for whichever roles
 * the operator has provisioned themselves, which is the shape SEC-10's recipe already
 * uses.
 */
export async function reconcileWorkspaceReporting(
  exec: Executor,
  input?: {
    readonly create?: {
      readonly environment: string;
      readonly workspaceSlug: string;
      readonly password: string;
    };
  },
): Promise<WorkspaceReportingReport> {
  const environments = await exec.execute<{ name: string }>(
    sql`select name from ${sql.identifier(CONTROL_SCHEMA)}.environments order by position`,
  );
  const names = environments.rows.map((row) => row.name);
  const workspaces = await listWorkspaces(exec);

  const refusals: string[] = [];
  const pairs: WorkspaceReportingPair[] = [];

  return exec.transaction(async (tx) => {
    if (input?.create !== undefined) {
      await createPairRole(tx, input.create, { names, slugs: workspaces.map((w) => w.slug) });
    }
    for (const environment of names) {
      for (const workspace of workspaces) {
        const refusal = refuseWorkspaceReportingNames(environment, workspace.slug);
        if (refusal === undefined) {
          pairs.push(await reconcileOnePair(tx, environment, workspace));
        } else {
          refusals.push(refusal);
        }
      }
    }
    return { pairs, refusals };
  });
}

/**
 * The one pair whose **role** this run creates, with the credential the operator gave.
 *
 * It throws rather than collecting a refusal, which is the right direction for this half:
 * an operator who named a pair expects that pair's role to exist afterwards, so a typo in
 * either half has to stop the run rather than be reported among the pairs it did reconcile.
 */
async function createPairRole(
  exec: Executor,
  wanted: {
    readonly environment: string;
    readonly workspaceSlug: string;
    readonly password: string;
  },
  live: { readonly names: readonly string[]; readonly slugs: readonly string[] },
): Promise<void> {
  if (!live.names.includes(wanted.environment)) {
    throw new Error(`environment ${wanted.environment} does not exist`);
  }
  if (!live.slugs.includes(wanted.workspaceSlug)) {
    throw new Error(`workspace ${wanted.workspaceSlug} does not exist`);
  }
  const refusal = refuseWorkspaceReportingNames(wanted.environment, wanted.workspaceSlug);
  if (refusal !== undefined) throw new Error(refusal);
  // `createLoginRole` lets **Postgres** quote both the identifier and the credential, over
  // real bind parameters, and is idempotent. Its own documentation says why a `DO` block
  // cannot do this.
  await createLoginRole(
    exec,
    workspaceReportingRoleName(wanted.environment, wanted.workspaceSlug),
    wanted.password,
  );
}

/** One pair's views and grants, and the row the report carries for it. */
async function reconcileOnePair(
  exec: Executor,
  environment: string,
  workspace: { readonly id: string; readonly slug: string; readonly archivedAt: Date | null },
): Promise<WorkspaceReportingPair> {
  for (const statement of workspaceReportingStatements({
    environment,
    slug: workspace.slug,
    workspaceId: workspace.id,
  })) {
    // check-security-hygiene: allow generated DDL over a slug and an environment name already refused
    await exec.execute(sql.raw(statement));
  }
  const role = workspaceReportingRoleName(environment, workspace.slug);
  return {
    environment,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    reportingSchema: reportingSchemaName(environment),
    role,
    views: workspaceReportingViewNames(workspace.slug),
    roleExists: await roleExists(exec, role),
    archived: workspace.archivedAt !== null,
  };
}
