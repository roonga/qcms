/**
 * `pnpm qcms:reset-2fa` - the break-glass that clears one administrator's second
 * factor and recovery codes (issue #432, Code Owner decision 2026-09-07).
 *
 * ```
 * # Report only. Writes nothing.
 * DATABASE_URL=postgres://qcms_migrate:...@host:5432/qcms \
 *   pnpm qcms:reset-2fa --email locked.out@example.test
 *
 * # Apply.
 * DATABASE_URL=postgres://qcms_migrate:...@host:5432/qcms \
 *   pnpm qcms:reset-2fa --email locked.out@example.test --yes
 * ```
 *
 * The address is an **argument** where `create-admin`'s password is an environment
 * variable, and the difference is deliberate rather than inconsistent. That command
 * keeps a credential out of every `ps` listing on the box; an email address is not a
 * credential, is printed in this command's own output, and is already stored beside
 * the account. Putting it in the environment would buy nothing and cost the operator
 * the ability to see, in their shell history, which account they reset.
 *
 * `--yes` is required to change anything. Without it the command resolves the
 * account, reports exactly what it would clear, and exits 0 having written nothing:
 * this is the one operation in the system that removes an authentication factor, and
 * the shape where a typo in an address is a report rather than a lockout is worth the
 * extra word.
 *
 * ## Why it is a compiled entry under `src/`, like `create-admin`
 *
 * Same reason, and it is load-bearing rather than symmetry for its own sake: it has
 * to run **inside the API container**, which is where an operator recovering a real
 * deployment can reach the database at all (the composed topology's Postgres is
 * deliberately unpublished). That image is built by `pnpm deploy --prod`, which
 * copies only what `package.json`'s `files` lists - `dist` - so a `scripts/*.ts`
 * entry would not be in the image.
 *
 * ## Its whole configuration surface is `DATABASE_URL`
 *
 * Narrower than `create-admin`'s, which also reads the admin-auth block. That is the
 * point: the case this recovers from includes a **lost or changed**
 * `QCMS_ADMIN_AUTH_SECRET`, so requiring that variable before an operator may clear a
 * factor would gate the recovery on the thing that broke. Nothing here builds a
 * better-auth instance, because with that key gone the library can neither verify the
 * stored factor nor disable it; deleting the row is plain SQL and stays that way.
 *
 * Node built-ins are allowed here (process boundary, not handler scope; R4). All the
 * logic is in `features/auth/reset-two-factor.ts` and tested there against a real
 * database (`reset-two-factor.integration.test.ts`); this file is argument handling,
 * one log event, and exit codes.
 */

import { schema } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { loadResetTwoFactorConfig } from "./config.js";
import { parseArgs, USAGE } from "./reset-2fa-args.js";
import {
  describeResetOutcome,
  describeResetRefusal,
  resetAdminTwoFactor,
} from "./features/auth/reset-two-factor.js";
import { createJsonLogger } from "./logger.js";

/** Exit codes: 0 done (or reported), 1 refused (operator can act), 2 misconfigured. */
const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_MISCONFIGURED = 2;

async function main(): Promise<number> {
  const invocation = parseArgs(process.argv.slice(2));
  if (!invocation.ok) {
    process.stderr.write(`${invocation.problem}\n\n${USAGE}`);
    return EXIT_MISCONFIGURED;
  }

  let config;
  try {
    config = loadResetTwoFactorConfig(process.env);
  } catch (error) {
    // ConfigError messages name env vars and reasons only, never values (SEC-8).
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_MISCONFIGURED;
  }

  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  try {
    const db = drizzle(pool, { schema }) as unknown as Executor;
    const outcome = await resetAdminTwoFactor(db, {
      email: invocation.email,
      confirm: invocation.confirm,
    });

    if (!outcome.ok) {
      process.stderr.write(`${describeResetRefusal(outcome.refusal)}\n`);
      return EXIT_REFUSED;
    }

    if (outcome.applied) {
      // One SEC-13 allowlisted event, and deliberately **no attributes**. The
      // interesting facts here are an email address and a user id, and a direct
      // identifier is named in that decision as never belonging in any exported
      // signal; the audit row is where the identity lives, in the operator's own
      // database under their own retention. What leaves the process is that a
      // break-glass ran, which is the thing worth alerting on.
      const logger = createJsonLogger({
        write: (line) => process.stdout.write(`${line}\n`),
        base: { service: "qcms-api" },
        sendToOpenTelemetry: true,
      });
      logger.warn("admin two-factor reset");
    }

    process.stdout.write(describeResetOutcome(outcome));
    return EXIT_OK;
  } finally {
    await pool.end();
  }
}

process.exit(await main());
