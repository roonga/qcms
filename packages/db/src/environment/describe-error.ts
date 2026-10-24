/**
 * This unwraps a `cause` into the line it prints, and drizzle's `DrizzleQueryError`
 * carries the failed statement in its own message. So nothing in this package may attach
 * that wrapper as a `cause`, or the statement reaches an operator's terminal (SEC-8); see
 * `refuseWithoutStatement` in `./role.ts`.
 */

function collapse(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return collapse(String(error));
  const cause = error.cause;
  const because = cause instanceof Error ? ` (${collapse(cause.message)})` : "";
  return `${collapse(error.message)}${because}`;
}
