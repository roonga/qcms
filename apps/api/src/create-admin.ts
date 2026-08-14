/**
 * `pnpm qcms:create-admin` - the first-run bootstrap command (task 031, SEC-1; moved
 * from the admin app to the API by task 056).
 *
 * Run against a migrated database, prompting for the passphrase rather than typing it:
 *
 * ```
 * read -rs -p 'passphrase: ' QCMS_ADMIN_PASSWORD; echo
 * export QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD
 * pnpm qcms:create-admin
 * unset QCMS_ADMIN_PASSWORD
 * ```
 *
 * Credentials arrive in the **environment**, never as arguments: an argument lands in
 * every `ps` listing on the box while the command runs. That guarantee covers the whole
 * path and not just this process, which it did not always (issue #440): the Compose
 * harnesses that run this entry inside the API container name the two variables on the
 * docker CLI's command line and attach no values (`--env QCMS_ADMIN_PASSWORD`, docker's
 * pass-through form), leaving the values in the CLI's own environment, so the password
 * is absent from every argv on the host as well. That is `buildAdminExec` in
 * `scripts/compose-admin.mjs`, pinned by `scripts/compose-admin.test.ts` rather than
 * left to a comment.
 *
 * **`ps` and shell history are two exposures, and an environment assignment only closes
 * one** (issue #460). An inline `QCMS_ADMIN_PASSWORD=... pnpm qcms:create-admin` keeps
 * the value out of every argv and puts it straight into your shell's history file, which is why
 * the recipe above prompts with `read -rs` instead: a value that never appears on a
 * command line reaches neither. A leading space suppresses the history entry only when
 * `HISTCONTROL` includes `ignorespace` (bash) or `HIST_IGNORE_SPACE` is set (zsh), and
 * neither is universally the default, so it is a fallback for a command already typed
 * rather than the recipe to hand someone.
 *
 * The value is not echoed back either, on success or on failure (SEC-8); the output
 * names the account's email and nothing else.
 *
 * ## Why it is a compiled entry under `src/` rather than a script under `scripts/`
 *
 * It has to run **inside the API container**, which is what `docker compose exec api`
 * and `scripts/compose-e2e.mjs` do to bootstrap a fresh stack. That image is built by
 * `pnpm deploy --prod`, which copies only what `package.json`'s `files` lists -
 * `dist`. A `scripts/*.ts` entry executed by Node's type stripping (the shape
 * `scripts/seed-fixtures.ts` uses) would not be in the image at all, and could not
 * import `./config.js` from source in any case: Node resolves that specifier literally
 * and does not rewrite `.js` back to `.ts`. Compiling it means one copy of the
 * better-auth configuration, the same module the server mounts.
 *
 * It reads only the admin-auth slice of the configuration (`loadAdminAuthConfig`), not
 * the whole of it: making an operator supply link keys, session keys and an app
 * encryption key in order to create the first account would be a config wall around a
 * single insert, and none of those values is read on this path.
 *
 * Node built-ins are allowed here (process boundary, not handler scope; R4). All the
 * logic is in `features/auth/bootstrap.ts` and tested there against a real database
 * (`bootstrap.integration.test.ts`); this file is argument handling and exit codes.
 */

import { schema } from "@qcms/db";
import type { Executor } from "@qcms/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { loadAdminAuthConfig } from "./config.js";
import { createInitialAdmin, describeRefusal } from "./features/auth/bootstrap.js";
import { createAdminAuth, warnIfBreachCheckDisabled } from "./features/auth/instance.js";

/** Exit codes: 0 created, 1 refused (operator can act), 2 misconfigured. */
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
        "  pnpm qcms:create-admin\n" +
        "  unset QCMS_ADMIN_PASSWORD\n",
    );
    return EXIT_MISCONFIGURED;
  }

  let config;
  try {
    config = loadAdminAuthConfig(process.env);
  } catch (error) {
    // ConfigError messages name env vars and reasons only, never values (SEC-8).
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_MISCONFIGURED;
  }

  // The same line the server writes at boot, before anything is created: the account
  // this command is about to make would otherwise be the one account created without
  // the SEC-1 breach check and with nothing in the operator's scrollback saying so.
  warnIfBreachCheckDisabled(config.adminAuth, (message) => {
    process.stderr.write(`${message}\n`);
  });

  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool, { schema }) as unknown as Executor;
  const auth = createAdminAuth({ db, adminAuth: config.adminAuth });

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

  process.stdout.write(
    `Created the first admin account for ${result.email}.\n` +
      "Sign in at the admin app; you will be asked to set up two-factor authentication\n" +
      "before anything else, and shown recovery codes once. Save them.\n",
  );
  return EXIT_OK;
}

// A connection pool keeps the event loop alive, so exit explicitly rather than
// waiting for a drain that never comes.
process.exit(await main());
