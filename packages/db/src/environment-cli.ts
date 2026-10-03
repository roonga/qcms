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
  maxEnvironmentNameLength,
  ownsControlSchema,
  refuseEnvironmentName,
} from "./environment/command.js";
import { environmentDatabaseUrlVariableName } from "./environment/naming.js";

const USAGE = `Usage:
  qcms-db-environment create <name> [--password <password>]
  qcms-db-environment drop <name>

  DATABASE_URL must name the migration credential (the role that owns \`control\`).
  A name is lowercase letters and digits, starting with a letter, at most
  ${String(maxEnvironmentNameLength())} bytes, and not a reserved word.`;

/** One line, cause included, in the shape `qcms-db migrate` already uses. */
function describeError(error: unknown): string {
  const collapse = (text: string): string => text.replaceAll(/\s+/g, " ").trim();
  if (!(error instanceof Error)) return collapse(String(error));
  const cause = error.cause;
  const because = cause instanceof Error ? ` (${collapse(cause.message)})` : "";
  return `${collapse(error.message)}${because}`;
}

interface ParsedArgs {
  readonly action: "create" | "drop";
  readonly name: string;
  readonly password?: string;
}

/**
 * Either the parsed arguments or the refusal to print, never both and never a throw.
 *
 * One shape rather than "a `ParsedArgs` or a string", so a caller cannot mistake a
 * usage message for a name: the two are the same type in the wrong design and this
 * command's whole first act is to tell them apart.
 */
type ArgResult =
  | { readonly ok: true; readonly args: ParsedArgs }
  | {
      readonly ok: false;
      readonly refusal: string;
    };

function refuse(refusal: string): ArgResult {
  return { ok: false, refusal };
}

function parseArgs(argv: readonly string[]): ArgResult {
  const [action, name, ...rest] = argv;
  if (action !== "create" && action !== "drop") return refuse(USAGE);
  if (name === undefined || name.startsWith("-")) return refuse(USAGE);
  let password: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--password") {
      password = rest[i + 1];
      if (password === undefined) return refuse("--password needs a value");
      i += 1;
    } else {
      return refuse(`unknown argument ${String(rest[i])}\n${USAGE}`);
    }
  }
  if (action === "drop" && password !== undefined) return refuse("drop takes no --password");
  const args: ParsedArgs = password === undefined ? { action, name } : { action, name, password };
  return { ok: true, args };
}

async function main(): Promise<number> {
  const result = parseArgs(process.argv.slice(2));
  if (!result.ok) {
    process.stderr.write(`${result.refusal}\n`);
    return 2;
  }
  const parsed = result.args;

  const refusal = refuseEnvironmentName(parsed.name);
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
    const exec = drizzle(pool) as unknown as Parameters<typeof ownsControlSchema>[0];
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

    if (parsed.action === "create") {
      const created = await createEnvironment(exec, {
        name: parsed.name,
        ...(parsed.password === undefined ? {} : { password: parsed.password }),
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

    const refused = await dropEnvironment(exec, parsed.name);
    if (refused !== undefined) {
      process.stderr.write(`qcms-db environment failed: ${refused.reason}\n`);
      return 1;
    }
    process.stdout.write(
      `dropped environment ${parsed.name}\n` +
        `Remove ${environmentDatabaseUrlVariableName(parsed.name)} and take ${parsed.name} ` +
        "out of QCMS_ENVIRONMENTS, then restart the API.\n",
    );
    return 0;
  } catch (error) {
    process.stderr.write(`qcms-db environment failed: ${describeError(error)}\n`);
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
