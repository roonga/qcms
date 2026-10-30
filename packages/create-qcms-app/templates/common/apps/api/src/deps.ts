import type { Clock } from "./clock.js";
import type { Databases } from "./environments.js";
import type { Config, Flags } from "./config.js";
import type { DraftAssistant } from "./features/agent/types.js";
import type { ChallengeVerifier } from "./features/responses/challenge.js";
import type { Logger } from "./logger.js";
import type { RateLimitStore } from "./rate-limit.js";

export interface Deps {
  /**
   * Which pool a handler takes is a privilege decision: each role holds no privilege on
   * the other plane's tables, so reaching for the wrong one fails on permission.
   */
  readonly databases: Databases;
  readonly config: Config;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly rateLimitStore: RateLimitStore;
  /** Null verifier when the provider is `none`, so it passes every solution. */
  readonly challenge: ChallengeVerifier;
  readonly draftAssistant: DraftAssistant;
  readonly flags: Flags;
}
