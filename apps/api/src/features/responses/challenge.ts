/**
 * Challenge adapter seam (task 026).
 *
 * A per-form `challengeRequired` setting (domain config on the `forms` row, NOT
 * a deployment flag - ADR-24) can gate session creation behind a human-verification
 * challenge (e.g. Cloudflare Turnstile). The *provider* is a deployment flag
 * (`QCMS_FLAG_CHALLENGE_PROVIDER`, ADR-24): `none` (the default) ships a null
 * verifier that accepts everything, so a `challengeRequired` form no-ops until
 * an operator wires a real provider.
 *
 * **The provider is also a per-environment value, since task 066** (Q11, ADR-24's
 * amendment): `control.environments.challenge_provider` overrides the flag for one
 * environment, and `NULL` leaves the flag in force.
 * {@link environmentChallengeVerifier} is that read, and it is the one the respondent
 * path calls. The retention TTLs beside it in that table are Q11's other half and are
 * task 067's.
 *
 * This module is the seam and the null implementation only. The Turnstile
 * verifier itself is shell code delivered with the portal (029) - here it is a
 * placeholder that fails closed, so an operator who sets the flag to `turnstile`
 * without 029 present blocks challenged forms rather than silently letting bots
 * through. Fetch-pure (R4): a real verifier calls the provider over `fetch`, no
 * `node:*`.
 */

import { getEnvironmentChallengeProvider } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import type { Config } from "../../config.js";
import type { Logger } from "../../logger.js";

/** The outcome of verifying a challenge solution. Never carries provider internals. */
export interface ChallengeResult {
  readonly ok: boolean;
}

/**
 * Verifies a respondent's challenge solution. `token` is the opaque solution the
 * client obtained from the provider widget; `ip` is the client IP (providers
 * bind a solution to the solver's address). Returns `{ ok }` - the caller maps a
 * failure to a rejected start-session; the verifier never throws for a *failed*
 * challenge (only for an infrastructure fault).
 */
export interface ChallengeVerifier {
  verify(token: string | undefined, ip: string | undefined): Promise<ChallengeResult>;
}

/**
 * The `provider: none` implementation: every challenge passes, including a
 * missing token. This is what makes a `challengeRequired` form a no-op when no
 * provider is configured - the setting is honored structurally (the check runs)
 * but always succeeds.
 */
export const nullChallengeVerifier: ChallengeVerifier = {
  verify(): Promise<ChallengeResult> {
    return Promise.resolve({ ok: true });
  },
};

/**
 * Turnstile verifier - **shell only (029)**. Fails closed: until the real
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

/**
 * The provider names a per-environment column may carry (Q11, task 066).
 *
 * The same vocabulary `QCMS_FLAG_CHALLENGE_PROVIDER` accepts, deliberately: one setting
 * with two places it can be set is still one setting, and an environment that could name
 * a provider the installation-wide flag cannot would be a second feature wearing the same
 * name. The column is `text` rather than an enum because the operator command writes it
 * and a new provider must not need a migration, so the validation is here, on read.
 */
const ENVIRONMENT_CHALLENGE_PROVIDERS = ["none", "turnstile"] as const;

/** Refuses every challenged start. The misconfiguration posture, never a provider. */
const failClosedChallengeVerifier: ChallengeVerifier = {
  verify(): Promise<ChallengeResult> {
    return Promise.resolve({ ok: false });
  },
};

/**
 * The challenge verifier for one **environment** (Q11, ADR-24's amendment, task 066).
 *
 * `control.environments.challenge_provider` names it, or `NULL` leaves the
 * installation-wide typed value in force - which is `deps.challenge`, built once at boot
 * from `QCMS_FLAG_CHALLENGE_PROVIDER`. Read from the environment row rather than from the
 * process environment, which is the half of Q11 this task owns; the retention TTLs in the
 * same table are task 067's.
 *
 * Read on the **environment** pool, which holds `SELECT` on `control.environments`
 * (Q48's read list), and only when a form actually carries `challengeRequired` - so the
 * ordinary request pays nothing for a setting almost no form sets.
 *
 * **An unrecognised name fails closed.** A column holding a provider this build does not
 * know is a misconfiguration, and the two ways to be wrong are not symmetric: letting
 * every challenged start through is the failure the setting exists to prevent, while
 * refusing them is visible at once and is fixed by correcting one row. That is the posture
 * the `turnstile` shell above already takes.
 *
 * **A missing environment row is a different fault** and is not this reader's to paper
 * over: boot has already reconciled the configured set against `control.environments`
 * (task 064, criterion 6a), so an absent row means somebody removed it under a running
 * process. It fails closed too, and the log line says which environment.
 */
export async function environmentChallengeVerifier(
  deps: { readonly challenge: ChallengeVerifier; readonly logger: Logger },
  exec: Executor,
  environment: string,
): Promise<ChallengeVerifier> {
  const provider = await getEnvironmentChallengeProvider(exec, environment);
  if (provider === undefined) {
    deps.logger.warn("challenge provider: no control.environments row; failing closed", {
      environment,
    });
    return failClosedChallengeVerifier;
  }
  if (provider === null) return deps.challenge;
  switch (provider) {
    case "none":
      return nullChallengeVerifier;
    case "turnstile":
      return turnstileChallengeVerifier(deps.logger);
    default:
      deps.logger.warn("challenge provider: unknown name on the environment; failing closed", {
        environment,
        allowed: [...ENVIRONMENT_CHALLENGE_PROVIDERS].join(","),
      });
      return failClosedChallengeVerifier;
  }
}
