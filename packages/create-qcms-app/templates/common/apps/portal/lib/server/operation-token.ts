/**
 * The one-time roster-operation token a step render mints (ADR-43).
 *
 * The no-JS Add and Remove answers its POST with a 200 re-render, which a reload or a
 * Back can resubmit, and replaying an Add would add a second instance. A token already
 * spent is a no-op that returns the roster as it stands.
 *
 * Not a credential: it is scoped to the session it was minted in, worthless to anyone
 * who cannot already post there, and refusing a replay is its only job.
 *
 * Random rather than a counter, because a respondent who opens the step in two tabs and
 * presses Add in each has made two operations, and a counter would make the second a
 * replay of the first.
 */
export function newOperationToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `op_${hex}`;
}
