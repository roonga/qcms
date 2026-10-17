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
import { reconcileWorkspaceReporting } from "./environment/reporting.js";

const USAGE = `Usage:
  qcms-db-environment create <name> [--password <password>]
  qcms-db-environment drop <name>
  qcms-db-environment reporting [--workspace <slug> --environment <name> --password <pw>]

  DATABASE_URL must name the migration credential (the role that owns \`control\`).
  A name is lowercase letters and digits, starting with a letter, at most
  ${String(maxEnvironmentNameLength())} bytes, and not a reserved word.

  \`reporting\` reconciles one reporting view set and one read-only role per
  (workspace, environment) pair (Q26, docs/reporting-view.md). Run it after
  creating a workspace. With all three flags it also creates that one pair's
  role with that credential; without them it creates no role and the grants
  land for the roles an operator has provisioned themselves.`;

/** One line, cause included, in the shape `qcms-db migrate` already uses. */
function describeError(error: unknown): string {
  const collapse = (text: string): string => text.replaceAll(/\s+/g, " ").trim();
  if (!(error instanceof Error)) return collapse(String(error));
  const cause = error.cause;
  const because = cause instanceof Error ? ` (${collapse(cause.message)})` : "";
  return `${collapse(error.message)}${because}`;
}

interface ParsedArgs {
  readonly action: "create" | "drop" | "reporting";
  /** The environment name for `create` and `drop`; empty for `reporting`. */
  readonly name: string;
  readonly password?: string;
  /** `reporting --workspace`: the one pair whose role this run creates. */
  readonly workspace?: string;
  /** `reporting --environment`: the other half of that pair. */
  readonly environment?: string;
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
  const [action, ...tail] = argv;
  if (action !== "create" && action !== "drop" && action !== "reporting") return refuse(USAGE);

  // `reporting` takes **no positional name**: the one pair whose role it may create is
  // named by two flags, because an environment name and a workspace slug obey two
  // different rules and a positional pair would read as one thing.
  const name = action === "reporting" ? "" : (tail[0] ?? "");
  if (action !== "reporting" && (name === "" || name.startsWith("-"))) return refuse(USAGE);
  const rest = action === "reporting" ? tail : tail.slice(1);

  let password: string | undefined;
  let workspace: string | undefined;
  let environment: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag !== "--password" && flag !== "--workspace" && flag !== "--environment") {
      return refuse(`unknown argument ${String(flag)}\n${USAGE}`);
    }
    const value = rest[i + 1];
    if (value === undefined) return refuse(`${flag} needs a value`);
    if (flag === "--password") password = value;
    if (flag === "--workspace") workspace = value;
    if (flag === "--environment") environment = value;
    i += 1;
  }

  if (action === "drop" && password !== undefined) return refuse("drop takes no --password");
  if (action !== "reporting" && (workspace !== undefined || environment !== undefined)) {
    return refuse(`${action} takes no --workspace or --environment\n${USAGE}`);
  }
  // All three or none. A password with no pair names no role to create, and a pair with
  // no password would create a role nobody can log in as, which looks like success and is
  // not - so it is refused rather than half done.
  if (action === "reporting") {
    const given = [password, workspace, environment].filter((value) => value !== undefined).length;
    if (given !== 0 && given !== 3) {
      return refuse(
        "reporting takes --workspace, --environment and --password together or none of " +
          "them: creating a role needs the pair it belongs to and a credential it logs " +
          `in with\n${USAGE}`,
      );
    }
  }

  return {
    ok: true,
    args: {
      action,
      name,
      ...(password === undefined ? {} : { password }),
      ...(workspace === undefined ? {} : { workspace }),
      ...(environment === undefined ? {} : { environment }),
    },
  };
}

async function main(): Promise<number> {
  const result = parseArgs(process.argv.slice(2));
  if (!result.ok) {
    process.stderr.write(`${result.refusal}\n`);
    return 2;
  }
  const parsed = result.args;

  // `reporting` names no environment of its own: it reconciles the whole live set, and
  // the `--environment` of its one-pair form names a row that already exists and has
  // therefore already passed this rule.
  if (parsed.action !== "reporting") {
    const refusal = refuseEnvironmentName(parsed.name);
    if (refusal !== undefined) {
      process.stderr.write(`qcms-db environment failed: ${refusal}\n`);
      return 1;
    }
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

    if (parsed.action === "reporting") {
      const report = await reconcileWorkspaceReporting(exec, {
        ...(parsed.password === undefined ||
        parsed.workspace === undefined ||
        parsed.environment === undefined
          ? {}
          : {
              create: {
                environment: parsed.environment,
                workspaceSlug: parsed.workspace,
                password: parsed.password,
              },
            }),
      });
      for (const pair of report.pairs) {
        // The views always exist after this run; the role is the operator's, so the line
        // says which it is and whether it is there, because a grant guarded on a missing
        // role is a grant that silently did not land.
        process.stdout.write(
          `${pair.reportingSchema}: ${pair.views.join(", ")} ` +
            `-> ${pair.role}${pair.roleExists ? "" : " (role not created yet)"}` +
            `${pair.archived ? " (workspace archived; views kept)" : ""}\n`,
        );
      }
      for (const refused of report.refusals) {
        process.stderr.write(`skipped: ${refused}\n`);
      }
      process.stdout.write(
        `\nreconciled ${String(report.pairs.length)} (workspace, environment) reporting ` +
          "pair(s). Grant a pair's role to an analyst's login and point their tool at " +
          "that schema; `docs/reporting-view.md` is the contract they read.\n",
      );
      // A refusal is a pair that does not exist, which is a configuration fault an
      // operator has to act on, so it is not a success.
      return report.refusals.length === 0 ? 0 : 1;
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
