/**
 * `pnpm qcms:create-admin` - the first-run bootstrap command (task 031, SEC-1).
 *
 * Run from the repo root against a migrated database:
 *
 * ```
 * QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD='a long passphrase' pnpm qcms:create-admin
 * ```
 *
 * Credentials arrive in the **environment**, never as arguments: an argument lands in
 * the operator's shell history and in every `ps` listing on the box while the command
 * runs. The value is not echoed back either, on success or on failure (SEC-8); the
 * output names the account's email and nothing else.
 *
 * This is a `.ts` file executed directly by Node (type stripping, Node >= 23.6), which
 * is why every relative import in `lib/server` carries an explicit `.ts` extension:
 * Node resolves the specifier literally and does not rewrite `.js` back to `.ts`. That
 * keeps one copy of the better-auth configuration - the same module the running app
 * uses - rather than a second one written for a build step.
 *
 * All the logic is in `lib/server/bootstrap.ts` and tested there against a real
 * database (`bootstrap.integration.test.ts`); this file is argument handling and exit
 * codes.
 */

import { createInitialAdmin, describeRefusal } from "../lib/server/bootstrap.ts";
import { adminDb } from "../lib/server/db.ts";

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
        "Example: QCMS_ADMIN_EMAIL=you@example.test QCMS_ADMIN_PASSWORD='a long passphrase' pnpm qcms:create-admin\n",
    );
    return EXIT_MISCONFIGURED;
  }

  const name = process.env.QCMS_ADMIN_NAME?.trim();
  const result = await createInitialAdmin(adminDb(), {
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
