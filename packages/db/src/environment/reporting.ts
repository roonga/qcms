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
import { listActiveWorkspaces, listWorkspaces } from "../queries/workspaces.js";
import {
  CONTROL_SCHEMA,
  reportingSchemaName,
  workspaceReportingRoleName,
} from "../schema/schemas.js";
import { workspaceReportingViewNames } from "../reporting-views.js";

import { workspaceReportingStatements } from "./sql.js";

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

/** Whether a role exists in the cluster. */
async function roleExists(exec: Executor, role: string): Promise<boolean> {
  const result = await exec.execute<{ found: boolean }>(
    sql`select exists (select 1 from pg_roles where rolname = ${role}) as found`,
  );
  return result.rows[0]?.found ?? false;
}

/**
 * Every active workspace's view set for **one** environment, as statements.
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
  const workspaces = await listActiveWorkspaces(exec);
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
    const wanted = input?.create;
    if (wanted !== undefined) {
      if (!names.includes(wanted.environment)) {
        throw new Error(`environment ${wanted.environment} does not exist`);
      }
      if (!workspaces.some((workspace) => workspace.slug === wanted.workspaceSlug)) {
        throw new Error(`workspace ${wanted.workspaceSlug} does not exist`);
      }
      const refusal = refuseWorkspaceReportingNames(wanted.environment, wanted.workspaceSlug);
      if (refusal !== undefined) throw new Error(refusal);
      const role = workspaceReportingRoleName(wanted.environment, wanted.workspaceSlug);
      if (!(await roleExists(tx, role))) {
        // `format(%I, %L)` rather than interpolation: both halves of the name have passed
        // their own rules, and a credential must never be concatenated into SQL whatever
        // else is true of it.
        await tx.execute(sql`
          do $$ begin
            execute format('CREATE ROLE %I LOGIN PASSWORD %L', ${role}, ${wanted.password});
          end $$;
        `);
      }
    }

    for (const environment of names) {
      for (const workspace of workspaces) {
        const refusal = refuseWorkspaceReportingNames(environment, workspace.slug);
        if (refusal !== undefined) {
          refusals.push(refusal);
          continue;
        }
        for (const statement of workspaceReportingStatements({
          environment,
          slug: workspace.slug,
          workspaceId: workspace.id,
        })) {
          // check-security-hygiene: allow generated DDL over a slug and an environment name already refused above
          await tx.execute(sql.raw(statement));
        }
        const role = workspaceReportingRoleName(environment, workspace.slug);
        pairs.push({
          environment,
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          reportingSchema: reportingSchemaName(environment),
          role,
          views: workspaceReportingViewNames(workspace.slug),
          roleExists: await roleExists(tx, role),
          archived: workspace.archivedAt !== null,
        });
      }
    }

    return { pairs, refusals };
  });
}
