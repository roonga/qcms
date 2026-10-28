/**
 * Nothing in this package may attach drizzle's `DrizzleQueryError` as a `cause`: its message carries the
 * failed statement, which would reach an operator's terminal (SEC-8); see `refuseWithoutStatement` in `./role.ts`.
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
