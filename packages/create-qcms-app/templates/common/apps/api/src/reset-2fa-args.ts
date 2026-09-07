/**
 * Argument handling for `pnpm qcms:reset-2fa` (issue #432).
 *
 * A module of its own rather than part of `reset-2fa.ts`, for one mechanical
 * reason: that file is a process entry and ends in `process.exit(await main())`,
 * so importing it from a test would run the command. The contract worth pinning
 * without a database is exactly the one that lives here - that a bare invocation
 * is a dry run, and that a flag the operator mistyped is a refusal rather than a
 * silent default.
 */

export const USAGE = [
  "Usage: docker compose run --rm migrate node dist/reset-2fa.js --email <address> [--yes]",
  "",
  "Clears one administrator's second factor and recovery codes, so that account can",
  "sign in with its password and enrol again. Without --yes it only reports what it",
  "would do.",
  "",
  "DATABASE_URL must name the migration role (qcms_migrate in the shipped recipe).",
  "The command refuses the application credential (SEC-10).",
  "",
].join("\n");

/** What the argument vector asked for, or the reason it could not be read. */
export type Invocation =
  | { readonly ok: true; readonly email: string; readonly confirm: boolean }
  | { readonly ok: false; readonly problem: string };

/**
 * Parse `--email <address>` and `--yes`.
 *
 * Hand-rolled rather than reached for a parser: two flags, and a dependency that
 * saves under a hundred lines is a liability (CONTRIBUTING). Unknown arguments are a
 * refusal rather than an ignore, because the one way this command can be worse than
 * useless is doing something other than what the operator wrote - a mistyped `--yes`
 * silently ignored is a report the operator reads as an action, and a mistyped
 * `--email` silently ignored is a missing address.
 *
 * The parsing is pinned by `reset-2fa-args.test.ts`, which needs no database.
 */
export function parseArgs(argv: readonly string[]): Invocation {
  let email: string | undefined;
  let confirm = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yes") {
      confirm = true;
      continue;
    }
    if (arg === "--email") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, problem: "--email needs an address." };
      }
      email = value.trim();
      index += 1;
      continue;
    }
    if (arg !== undefined && arg.startsWith("--email=")) {
      email = arg.slice("--email=".length).trim();
      continue;
    }
    return { ok: false, problem: `Unrecognised argument: ${String(arg)}` };
  }
  if (email === undefined || email === "") {
    return { ok: false, problem: "--email is required." };
  }
  return { ok: true, email, confirm };
}
