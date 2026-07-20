/**
 * The dependency object (task 017).
 *
 * `Deps` is the explicit, typed bag of collaborators `createApp` and every
 * slice receive — constructor injection, no DI container (.NET mapping: a
 * hand-rolled `IServiceProvider`, but it is just this object). Handlers pull
 * everything they need — the db handle, config, the clock, the logger, the
 * rate-limit store, and the typed flags — from here, so they never reach for a
 * module-level singleton or a `node:*` API (R4).
 */

import type { Executor } from "@qcms/db";

import type { Clock } from "./clock.js";
import type { Config, Flags } from "./config.js";
import type { ChallengeVerifier } from "./features/responses/challenge.js";
import type { Logger } from "./logger.js";
import type { RateLimitStore } from "./rate-limit.js";

export interface Deps {
  /** Drizzle handle (or transaction) — the query helpers' first argument. */
  readonly db: Executor;
  /** The validated boot configuration. */
  readonly config: Config;
  /** Injected clock — production wall time or a test-controlled one. */
  readonly clock: Clock;
  /** Injected structured logger — handlers log through this interface only. */
  readonly logger: Logger;
  /** Rate-limit store (in-memory default; swappable for Redis). */
  readonly rateLimitStore: RateLimitStore;
  /** Challenge verifier for `challengeRequired` forms (026); null verifier when provider `none`. */
  readonly challenge: ChallengeVerifier;
  /** Typed feature flags (ADR-24); a convenience alias of `config.flags`. */
  readonly flags: Flags;
}
