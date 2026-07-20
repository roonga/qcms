/**
 * Challenge adapter seam (task 026).
 *
 * A per-form `challengeRequired` setting (domain config on the `forms` row, NOT
 * a deployment flag — ADR-24) can gate `POST /sessions` behind a human-verification
 * challenge (e.g. Cloudflare Turnstile). The *provider* is a deployment flag
 * (`QCMS_FLAG_CHALLENGE_PROVIDER`, ADR-24): `none` (the default) ships a null
 * verifier that accepts everything, so a `challengeRequired` form no-ops until
 * an operator wires a real provider.
 *
 * This module is the seam and the null implementation only. The Turnstile
 * verifier itself is shell code delivered with the portal (029) — here it is a
 * placeholder that fails closed, so an operator who sets the flag to `turnstile`
 * without 029 present blocks challenged forms rather than silently letting bots
 * through. Fetch-pure (R4): a real verifier calls the provider over `fetch`, no
 * `node:*`.
 */

import type { Config } from "../../config.js";
import type { Logger } from "../../logger.js";

/** The outcome of verifying a challenge solution. Never carries provider internals. */
export interface ChallengeResult {
  readonly ok: boolean;
}

/**
 * Verifies a respondent's challenge solution. `token` is the opaque solution the
 * client obtained from the provider widget; `ip` is the client IP (providers
 * bind a solution to the solver's address). Returns `{ ok }` — the caller maps a
 * failure to a rejected start-session; the verifier never throws for a *failed*
 * challenge (only for an infrastructure fault).
 */
export interface ChallengeVerifier {
  verify(token: string | undefined, ip: string | undefined): Promise<ChallengeResult>;
}

/**
 * The `provider: none` implementation: every challenge passes, including a
 * missing token. This is what makes a `challengeRequired` form a no-op when no
 * provider is configured — the setting is honored structurally (the check runs)
 * but always succeeds.
 */
export const nullChallengeVerifier: ChallengeVerifier = {
  verify(): Promise<ChallengeResult> {
    return Promise.resolve({ ok: true });
  },
};

/**
 * Turnstile verifier — **shell only (029)**. Fails closed: until the real
 * siteverify call lands, a deployment that opts into `turnstile` rejects every
 * challenged start-session rather than accepting unverified traffic. Logs once
 * per call at warn so the misconfiguration is visible.
 */
export function turnstileChallengeVerifier(logger: Logger): ChallengeVerifier {
  return {
    verify(): Promise<ChallengeResult> {
      logger.warn("challenge provider 'turnstile' is not implemented yet (029); failing closed");
      return Promise.resolve({ ok: false });
    },
  };
}

/**
 * Select the verifier for the configured provider. `none` → the null verifier
 * (default); `turnstile` → the 029 shell. The provider is validated at boot
 * (config), so this switch is total over the flag's enum.
 */
export function selectChallengeVerifier(config: Config, logger: Logger): ChallengeVerifier {
  switch (config.flags.challengeProvider) {
    case "none":
      return nullChallengeVerifier;
    case "turnstile":
      return turnstileChallengeVerifier(logger);
  }
}
