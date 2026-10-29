/**
 * Challenge provider config (ADR-24, SEC-9). The default loads no challenge code and
 * adds no challenge origin to the CSP, and the flag is the single source of truth: there
 * is no client-side flag evaluation.
 */

export type ChallengeProvider = "none" | "turnstile";

export function challengeProvider(): ChallengeProvider {
  return process.env.QCMS_FLAG_CHALLENGE_PROVIDER === "turnstile" ? "turnstile" : "none";
}

/** Public: safe for the client widget. */
export function turnstileSiteKey(): string | undefined {
  const key = process.env.QCMS_TURNSTILE_SITE_KEY;
  return key === undefined || key === "" ? undefined : key;
}
