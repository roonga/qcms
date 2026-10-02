/**
 * The one-time roster-operation token a step render mints (task 073, ADR-43).
 *
 * ## What it is for
 *
 * The no-JS Add and Remove answers its POST with a **200 re-render** rather than a
 * redirect, because the values that have to survive the press are the whole step and
 * the whole step at nine instances does not fit a 4 KB cookie. A POST whose response is
 * a page can be replayed: a reload asks the browser to resubmit, and a Back can do the
 * same. Replaying an Add would add a second instance. So each rendered page mints one
 * token, every `__qop` button on it carries it, the API records it with the roster row
 * it writes, and a token already spent is a no-op that returns the roster as it stands.
 *
 * ## What it is not
 *
 * **Not a credential.** It is scoped to the session it was minted in, it is worthless
 * to anyone who cannot already post to that session, and refusing a replay is its only
 * job. It carries no respondent content, so nothing about SEC-13 changes.
 *
 * It is generated with `crypto.getRandomValues` rather than a counter because two
 * renders of the same step must mint different tokens: a respondent who opens the step
 * in two tabs and presses Add in each has made two operations, and a counter would make
 * the second a replay of the first.
 */
export function newOperationToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `op_${hex}`;
}
