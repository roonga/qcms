#!/usr/bin/env node
/**
 * `qcms-db-environment` - create or drop an environment (ADR-40, Q1, Q24, Q42).
 *
 * ```
 * # Create `dev`, with its own role and credential.
 * DATABASE_URL=postgres://qcms_migrate:...@host:5432/qcms \
 *   qcms-db-environment create dev --password "$DEV_APP_PASSWORD"
 *
 * # Create it without a role, for an operator who provisions roles their own way.
 * DATABASE_URL=... qcms-db-environment create dev
 *
 * # Drop it. Refuses while it holds a session or an open form.
 * DATABASE_URL=... qcms-db-environment drop dev
 *
 * # Re-apply every grant and revoke, for every environment in the live set. The step a
 * # RESTORE needs, because `pg_dump --no-privileges` carries no grant (issue #1094).
 * DATABASE_URL=... qcms-db-environment regrant
 * ```
 *
 * ## Why a command and not an endpoint
 *
 * Creating an environment is DDL, and no application role holds DDL (SEC-10). So this
 * runs under the **migration** credential, from a shell, and **refuses the application
 * credential** by testing schema ownership rather than a role name - the shape
 * `qcms:reset-2fa` already uses, and for the same reason: a deployment that renamed its
 * roles would pass a name test connected as exactly the credential the guard is for.
 *
 * ## After creating one, restart the API
 *
 * The **credential** for a new environment is a per-environment entry in the typed
 * configuration (ADR-24) and arrives through the process environment, so a running
 * process knows nothing about an environment created under it. ADR-24 parses
 * configuration at boot and fails fast, so a reload path would be a new capability in
 * that decision rather than an implementation detail of this one. Restart is also the
 * honest operational story: the operator has just run a command with the migration
 * credential and is already in a change window. This command says so on success.
 *
 * Node built-ins are allowed here: this is a process boundary, not handler scope (R4).
 */
import process from "node:process";

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import {
  createEnvironment,
  dropEnvironment,
  ownsControlSchema,
  refuseEnvironmentName,
} from "./environment/command.js";
import { environmentDatabaseUrlVariableName } from "./environment/naming.js";
import { parseArgs, type ParsedArgs } from "./environment/cli-args.js";
import { regrantEnvironments, unreappliedNote } from "./environment/regrant.js";
import { reconcileWorkspaceReporting } from "./environment/reporting.js";

/**
 * One line, cause included, in the shape `qcms-db migrate` already uses.
 *
 * **A `cause` is unwrapped here, which is exactly why nothing in this package may attach
 * drizzle's wrapper as one** (SEC-8). `DrizzleQueryError`'s message is `Failed query:
 * <sql>\nparams: <params>`, so a `cause` carrying it would put the statement and its bind
 * parameters on an operator's terminal through the helper meant to summarise the failure.
 * `refuseWithoutStatement` in `environment/role.ts` is the wrapper every statement-running
 * path uses for that reason: it repeats the **driver's** own complaint and attaches no
 * cause. PR #1093's review found the leak on the `CREATE ROLE` path and PR #1099's review
 * found it again on the re-grant path, which is why both now go through one wrapper.
 */
function describeError(error: unknown): string {
  const collapse = (text: string): string => text.replaceAll(/\s+/g, " ").trim();
  if (!(error instanceof Error)) return collapse(String(error));
  const cause = error.cause;
  const because = cause instanceof Error ? ` (${collapse(cause.message)})` : "";
  return `${collapse(error.message)}${because}`;
}

/** The executor shape the command's helpers take. */
type Exec = Parameters<typeof ownsControlSchema>[0];

/** `create`: the environment, its objects, its role and its settings. */
async function runCreate(exec: Exec, parsed: ParsedArgs): Promise<number> {
  const created = await createEnvironment(exec, {
    name: parsed.name,
    ...(parsed.password === undefined ? {} : { password: parsed.password }),
    settings: {
      ...(parsed.challengeProvider === undefined
        ? {}
        : { challengeProvider: parsed.challengeProvider }),
      ...(parsed.deliverySnippetTtlMs === undefined
        ? {}
        : { deliverySnippetTtlMs: parsed.deliverySnippetTtlMs }),
      ...(parsed.outboxPayloadTtlMs === undefined
        ? {}
        : { outboxPayloadTtlMs: parsed.outboxPayloadTtlMs }),
    },
  });
  process.stdout.write(
    `created environment ${created.name}\n` +
      `  schema:    ${created.schema}\n` +
      `  reporting: ${created.reportingSchema}\n` +
      `  role:      ${created.role}\n` +
      `  position:  ${String(created.position)}\n` +
      `\nSet ${environmentDatabaseUrlVariableName(created.name)} and add ` +
      `${created.name} to QCMS_ENVIRONMENTS, then RESTART the API: a running ` +
      "process validated its environment set at boot and will not pick this one up " +
      "on its own (ADR-24).\n",
  );
  return 0;
}

/** `reporting`: one view set and one read-only role per (workspace, environment) pair. */
async function runReporting(exec: Exec, parsed: ParsedArgs): Promise<number> {
  const pair =
    parsed.password === undefined ||
    parsed.workspace === undefined ||
    parsed.environment === undefined
      ? undefined
      : {
          environment: parsed.environment,
          workspaceSlug: parsed.workspace,
          password: parsed.password,
        };
  const report = await reconcileWorkspaceReporting(
    exec,
    pair === undefined ? {} : { create: pair },
  );
  for (const row of report.pairs) {
    // The views always exist after this run; the role is the operator's, so the line says
    // which it is and whether it is there, because a grant guarded on a missing role is a
    // grant that silently did not land.
    process.stdout.write(
      `${row.reportingSchema}: ${row.views.join(", ")} ` +
        `-> ${row.role}${row.roleExists ? "" : " (role not created yet)"}` +
        `${row.archived ? " (workspace archived; views kept)" : ""}\n`,
    );
  }
  for (const refused of report.refusals) process.stderr.write(`skipped: ${refused}\n`);
  process.stdout.write(
    `\nreconciled ${String(report.pairs.length)} (workspace, environment) reporting ` +
      "pair(s). Grant a pair's role to an analyst's login and point their tool at " +
      "that schema; `docs/reporting-view.md` is the contract they read.\n",
  );
  // A refusal is a pair that does not exist, which is a configuration fault an operator
  // has to act on, so it is not a success.
  return report.refusals.length === 0 ? 0 : 1;
}

/**
 * `regrant`: re-apply every grant and revoke in the model, for every environment.
 *
 * The step a restore needs. See `environment/regrant.ts` for why the dump cannot carry
 * them and why re-running `migrate` does not help (issue #1094).
 */
async function runRegrant(exec: Exec): Promise<number> {
  const report = await regrantEnvironments(exec);
  const lines = report.passes.map((pass) => {
    const where = pass.environment === undefined ? "" : ` [${pass.environment}]`;
    return `  ${String(pass.statements).padStart(3)} statement(s)  ${pass.source}${where}`;
  });
  process.stdout.write(
    `re-applied the grant model to ${String(report.environments.length)} environment(s): ` +
      `${report.environments.join(", ")}\n` +
      `${lines.join("\n")}\n` +
      `  ${String(report.statements)} statement(s) in total, in one transaction\n` +
      unreappliedNote(),
  );
  if (report.publicCreateGrantedToPublic) {
    // A finding rather than a failure: the re-grant did what it can, and this needs a
    // credential that owns `public`, which the migration role is not.
    process.stderr.write(
      "WARNING: PUBLIC still holds CREATE on schema `public`. Run " +
        "`REVOKE CREATE ON SCHEMA public FROM PUBLIC` as a superuser or the database " +
        "owner (ADR-40, Q20).\n",
    );
  }
  process.stdout.write(
    "The grants are now what a migrated database holds. No restart is needed: a grant " +
      "takes effect on the next statement, including on a pool that is already " +
      "connected.\n",
  );
  return 0;
}

/** `drop`: narrowly, and reporting the refusal rather than a bare no. */
async function runDrop(exec: Exec, name: string): Promise<number> {
  const refused = await dropEnvironment(exec, name);
  if (refused !== undefined) {
    process.stderr.write(`qcms-db environment failed: ${refused.reason}\n`);
    return 1;
  }
  process.stdout.write(
    `dropped environment ${name}\n` +
      `Remove ${environmentDatabaseUrlVariableName(name)} and take ${name} ` +
      "out of QCMS_ENVIRONMENTS, then restart the API.\n",
  );
  return 0;
}

/** The SEC-10 guard and the chosen subcommand, on one connection. */
async function run(exec: Exec, parsed: ParsedArgs): Promise<number> {
  const connected = await ownsControlSchema(exec);
  if (!connected.owns) {
    // Never the connection string: it carries the password and this line goes to a
    // terminal an operator may paste into an issue (SEC-8).
    process.stderr.write(
      `qcms-db environment failed: ${connected.role} does not own the control schema. ` +
        "This command runs DDL and must use the migration credential, never an " +
        "application one (SEC-10).\n",
    );
    return 1;
  }
  if (parsed.action === "create") return runCreate(exec, parsed);
  if (parsed.action === "reporting") return runReporting(exec, parsed);
  if (parsed.action === "regrant") return runRegrant(exec);
  return runDrop(exec, parsed.name);
}

async function main(): Promise<number> {
  const result = parseArgs(process.argv.slice(2));
  if (!result.ok) {
    process.stderr.write(`${result.refusal}\n`);
    return 2;
  }
  const parsed = result.args;

  // `reporting` and `regrant` name no environment of their own: each acts on the whole
  // live set, and the `--environment` of `reporting`'s one-pair form names a row that
  // already exists and has therefore already passed this rule.
  const named = parsed.action !== "reporting" && parsed.action !== "regrant";
  const refusal = named ? refuseEnvironmentName(parsed.name) : undefined;
  if (refusal !== undefined) {
    process.stderr.write(`qcms-db environment failed: ${refusal}\n`);
    return 1;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    process.stderr.write("qcms-db environment failed: DATABASE_URL is required\n");
    return 1;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    // `drizzle(pool)` with no schema is a handle this package's `Executor` alias describes
    // structurally but does not match nominally: the alias is the schema-bound type the
    // query helpers take, and nothing this command calls reads a declared table through
    // it. The same cast `migrate.ts` makes, for the same reason.
    return await run(drizzle(pool) as unknown as Exec, parsed);
  } catch (error) {
    process.stderr.write(`qcms-db environment failed: ${describeError(error)}\n`);
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
