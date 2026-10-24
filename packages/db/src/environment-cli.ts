#!/usr/bin/env node
// DATABASE_URL=... qcms-db-environment create|drop|reporting|regrant [...]
//
// Node built-ins are allowed here: this is a process boundary, not handler scope (R4).
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
import { describeError } from "./environment/describe-error.js";
import { regrantEnvironments, unreappliedNote } from "./environment/regrant.js";
import { reconcileWorkspaceReporting } from "./environment/reporting.js";

type Exec = Parameters<typeof ownsControlSchema>[0];

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
    // The role is reported because a grant guarded on a missing one silently did not land.
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
  // A refusal is a pair that does not exist: a configuration fault, not a success.
  return report.refusals.length === 0 ? 0 : 1;
}

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
    // A finding rather than a failure: fixing it needs a credential owning `public`.
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

async function run(exec: Exec, parsed: ParsedArgs): Promise<number> {
  const connected = await ownsControlSchema(exec);
  if (!connected.owns) {
    // Never the connection string: it carries the password (SEC-8).
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

  // `reporting --environment` names a row that already exists and so already passed this.
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
    // `drizzle(pool)` with no schema matches `Executor` structurally but not nominally,
    // and nothing this command calls reads a declared table through it.
    return await run(drizzle(pool) as unknown as Exec, parsed);
  } catch (error) {
    process.stderr.write(`qcms-db environment failed: ${describeError(error)}\n`);
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
