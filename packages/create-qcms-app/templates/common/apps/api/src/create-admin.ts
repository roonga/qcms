/**
 * Credentials arrive in the environment, never as arguments: an argument lands in every
 * `ps` listing while the command runs. The recipe prompts with `read -rs` because an
 * inline assignment keeps the value out of argv but puts it in shell history. Nothing
 * echoes the value back on either path (SEC-8).
 *
 * A compiled entry under `src/` rather than a script, because it must run inside the API
 * container and the image carries only `dist`.
 */

import { schema } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { loadAdminAuthConfig } from "./config.js";
import { createInitialAdmin, describeRefusal } from "./features/auth/bootstrap.js";
import { createAdminAuth, warnIfBreachCheckDisabled } from "./features/auth/instance.js";

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_MISCONFIGURED = 2;

async function main(): Promise<number> {
  const email = process.env.QCMS_ADMIN_EMAIL?.trim();
  const password = process.env.QCMS_ADMIN_PASSWORD;
  if (email === undefined || email === "" || password === undefined || password === "") {
    process.stderr.write(
      "Set QCMS_ADMIN_EMAIL and QCMS_ADMIN_PASSWORD in the environment.\n" +
        "Prompt for the passphrase rather than typing it inline, so it reaches neither ps nor your shell history:\n" +
        "  read -rs -p 'passphrase: ' QCMS_ADMIN_PASSWORD; echo\n" +
        "  export QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD\n" +
        "  docker compose exec -e QCMS_ADMIN_EMAIL -e QCMS_ADMIN_PASSWORD api node dist/create-admin.js\n" +
        "  unset QCMS_ADMIN_PASSWORD\n",
    );
    return EXIT_MISCONFIGURED;
  }

  let config;
  try {
    config = loadAdminAuthConfig(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_MISCONFIGURED;
  }

  // Before anything is created: otherwise this account is the one made without the
  // SEC-1 breach check and with nothing saying so.
  warnIfBreachCheckDisabled(config.adminAuth, (message) => {
    process.stderr.write(`${message}\n`);
  });

  // No `search_path` is needed: every control-plane table is declared on the `control`
  // Drizzle schema, so the adapter emits `control."user"` rather than a bare name.
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool, { schema }) as unknown as Executor;
  const auth = createAdminAuth({
    db,
    adminAuth: config.adminAuth,
    warn: (message) => {
      process.stderr.write(`${message}\n`);
    },
  });

  const name = process.env.QCMS_ADMIN_NAME?.trim();
  const result = await createInitialAdmin(auth, db, {
    email,
    password,
    ...(name === undefined || name === "" ? {} : { name }),
  });

  if (!result.ok) {
    process.stderr.write(`${describeRefusal(result.refusal)}\n`);
    return EXIT_REFUSED;
  }

  // The order printed here is the one `apps/admin/lib/server/session.ts` enforces.
  process.stdout.write(
    `Created the first admin account for ${result.email}.\n` +
      "The password you set is temporary. Sign in at the admin app and you will be asked to\n" +
      "choose your own password first, then to set up two-factor authentication, and you\n" +
      "will be shown recovery codes once. Save them.\n" +
      `This account owns the workspace "${result.workspaceSlug}", which is where forms and\n` +
      "questions are created until another workspace exists.\n",
  );
  return EXIT_OK;
}

// A connection pool keeps the event loop alive, so exit explicitly rather than
// waiting for a drain that never comes.
process.exit(await main());
