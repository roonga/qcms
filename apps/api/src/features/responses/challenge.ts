import { getEnvironmentChallengeProvider } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import type { Config } from "../../config.js";
import type { Logger } from "../../logger.js";

export interface ChallengeResult {
  readonly ok: boolean;
}

/** A failed challenge returns `{ ok: false }`; only infrastructure faults throw. */
export interface ChallengeVerifier {
  verify(token: string | undefined, ip: string | undefined): Promise<ChallengeResult>;
}

/** With no provider configured a `challengeRequired` form still runs the check, and passes. */
export const nullChallengeVerifier: ChallengeVerifier = {
  verify(): Promise<ChallengeResult> {
    return Promise.resolve({ ok: true });
  },
};

/** Not implemented yet, so it fails closed rather than accepting unverified traffic. */
export function turnstileChallengeVerifier(logger: Logger): ChallengeVerifier {
  return {
    verify(): Promise<ChallengeResult> {
      logger.warn("challenge provider 'turnstile' is not implemented yet (029); failing closed");
      return Promise.resolve({ ok: false });
    },
  };
}

export function selectChallengeVerifier(config: Config, logger: Logger): ChallengeVerifier {
  switch (config.flags.challengeProvider) {
    case "none":
      return nullChallengeVerifier;
    case "turnstile":
      return turnstileChallengeVerifier(logger);
  }
}

/** `challenge_provider` is a `text` column so a new provider needs no migration: validated here, on read. */
const ENVIRONMENT_CHALLENGE_PROVIDERS = ["none", "turnstile"] as const;

const failClosedChallengeVerifier: ChallengeVerifier = {
  verify(): Promise<ChallengeResult> {
    return Promise.resolve({ ok: false });
  },
};

/**
 * `NULL` leaves the installation-wide verifier in force. A missing row or an
 * unrecognised provider name is a misconfiguration and fails closed.
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
