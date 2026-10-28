/**
 * An operator command rather than an API route because creating a view is DDL and
 * `qcms_app_control` holds no DDL (SEC-10). So `docs/reporting-view.md` says to run this
 * after creating a workspace.
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
import { sqlLiteral as literal } from "../sql-literal.js";

import { createLoginRole } from "./role.js";
import { workspaceReportingGrantStatements, workspaceReportingStatements } from "./sql.js";

// Restated rather than imported from `./command.js`, which imports this module.
const MAX_IDENTIFIER_BYTES = 63;

/**
 * `organization.slug` has no CHECK and more than one writer, and an identifier cannot be a bind parameter,
 * so this guard alone stands between a hand-written row and the DDL built from it.
 */
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One (workspace, environment) reporting consumer, as the command reports it. */
export interface WorkspaceReportingPair {
  readonly environment: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly reportingSchema: string;
  /** The read-only role the pair's analysts are granted. */
  readonly role: string;
  readonly views: readonly string[];
  /** Whether the role exists in the cluster, so the pair's grants actually landed. */
  readonly roleExists: boolean;
  /** An archived workspace keeps its views rather than losing them. */
  readonly archived: boolean;
}

/** What the reconciliation did, and what it refused. */
export interface WorkspaceReportingReport {
  readonly pairs: readonly WorkspaceReportingPair[];
  /** One sentence per pair that could not be named, with the identifier that would not fit. */
  readonly refusals: readonly string[];
}

/**
 * Why a (workspace, environment) pair cannot be named, or `undefined` when it can. A
 * refusal rather than a truncation, because two slugs differing only past the identifier
 * limit would otherwise quietly share one role.
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

async function roleExists(exec: Executor, role: string): Promise<boolean> {
  const result = await exec.execute<{ found: boolean }>(
    sql`select exists (select 1 from pg_roles where rolname = ${role}) as found`,
  );
  return result.rows[0]?.found ?? false;
}

/**
 * Every workspace's view set for one environment, archived workspaces included. A pair
 * whose slug is too long is skipped rather than raised, so it cannot stop an environment
 * being created; {@link reconcileWorkspaceReporting} is what reports it.
 */
export async function workspaceReportingStatementsForEnvironment(
  exec: Executor,
  environment: string,
): Promise<string[]> {
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
 * The grant half alone, for the re-grant subcommand: `pg_dump --no-privileges` keeps the
 * views and loses only these, and a `regrant` must do no DDL.
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
 * Takes the per-workspace views back from the application role (ADR-40). Needed after a restore, where the
 * views return inside the dump and fall under the baseline's `ALL TABLES` grant.
 * Each revoke is guarded on the privilege being held, because `REVOKE` on a NULL `relacl` materialises it;
 * the guards nest, as `has_table_privilege` raises on a missing role.
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
 * Makes every (workspace, environment) pair's views and grants true, in one transaction.
 * `create` names the one pair whose role this run creates; without it no role is created
 * and the grants land for whichever roles the operator provisioned themselves.
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
 * The one pair whose role this run creates, with the credential the operator gave.
 *
 * It throws rather than collecting a refusal: an operator who named a pair expects that
 * pair's role to exist afterwards, so a typo has to stop the run.
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
  await createLoginRole(
    exec,
    workspaceReportingRoleName(wanted.environment, wanted.workspaceSlug),
    wanted.password,
  );
}

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
