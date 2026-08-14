/**
 * Challenge provider config (ADR-24, SEC-9). The portal renders a pre-session
 * challenge ONLY when `QCMS_FLAG_CHALLENGE_PROVIDER=turnstile`; the default
 * `none` loads no challenge code and adds no challenge origin to the CSP. The
 * flag is the single source of truth (no client-side flag evaluation, ADR-24).
 */

export type ChallengeProvider = "none" | "turnstile";

/** Resolve the active challenge provider from the typed env flag. */
export function challengeProvider(): ChallengeProvider {
  return process.env.QCMS_FLAG_CHALLENGE_PROVIDER === "turnstile" ? "turnstile" : "none";
}

/** The Turnstile site key (public; safe for the client widget). */
export function turnstileSiteKey(): string | undefined {
  const key = process.env.QCMS_TURNSTILE_SITE_KEY;
  return key === undefined || key === "" ? undefined : key;
}
