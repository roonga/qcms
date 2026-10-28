/**
 * A compiled entry under `src/` because it has to run inside the API container, and that
 * image ships only `dist`.
 *
 * Its whole configuration surface is `DATABASE_URL`: the case it recovers from includes a
 * lost `QCMS_ADMIN_AUTH_SECRET`, so requiring that variable would gate the recovery on the
 * thing that broke. Nothing here builds a better-auth instance for the same reason.
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
      // No attributes: the email and user id are direct identifiers, which never belong
      // in an exported signal (SEC-13). The audit row holds the identity.
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
