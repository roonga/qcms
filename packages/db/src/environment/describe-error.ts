/**
 * The one line `qcms-db-environment` prints when something refuses it, as a pure function
 * (SEC-8).
 *
 * # Why this is its own module
 *
 * The same reason `cli-args.ts` is: the entry file ends with
 * `process.exitCode = await main()`, so importing it runs the command, and a rule nobody
 * can test is a rule that drifts. This rule has drifted twice. It **unwraps a `cause`**
 * into the line it prints, and drizzle's `DrizzleQueryError` carries the failed statement
 * in its own message (`Failed query: <sql>\nparams: <params>`), so any path in this package
 * that attaches that wrapper as a `cause` puts the statement on an operator's terminal.
 * PR #1093's review found it on the `CREATE ROLE` path, where the statement carried a
 * password; PR #1099's review found it again on the re-grant path, where the full
 * `DO $$ ... GRANT ...` reached stderr immediately after the sentence promising it would
 * not.
 *
 * The fix in both cases is at the throw site - `refuseWithoutStatement` in `./role.ts`
 * attaches no cause and repeats the **driver's** own complaint - and this module is what
 * makes the consequence assertable: `regrant.integration.test.ts` takes a real refusal from
 * a real database and runs it through this function, which is what the terminal gets.
 *
 * The unwrapping itself stays, deliberately. It is what makes `qcms-db migrate`'s and this
 * command's failures one readable line, and removing it would hide a cause somebody
 * attaches for a good reason. What must hold is that nothing in this package attaches a
 * wrapper whose message is a statement.
 */

/** Collapse whitespace, so a multi-line driver message is one terminal line. */
function collapse(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/** One line, cause included, in the shape `qcms-db migrate` already uses. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return collapse(String(error));
  const cause = error.cause;
  const because = cause instanceof Error ? ` (${collapse(cause.message)})` : "";
  return `${collapse(error.message)}${because}`;
}
