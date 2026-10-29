// Separate from `reset-2fa.ts` because that file is a process entry: importing it from a
// test would run the command.

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

export type Invocation =
  | { readonly ok: true; readonly email: string; readonly confirm: boolean }
  | { readonly ok: false; readonly problem: string };

/**
 * Unknown arguments are refused rather than ignored: a silently dropped `--yes` is a
 * report the operator reads as an action.
 */
export function parseArgs(argv: readonly string[]): Invocation {
  let email: string | undefined;
  let confirm = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // The root script ends in `--` so pnpm forwards the operator's flags verbatim, so the
    // separator always arrives here and has to be skipped rather than refused.
    if (arg === "--") continue;
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
