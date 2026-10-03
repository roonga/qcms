/**
 * The dependency object (task 017).
 *
 * `Deps` is the explicit, typed bag of collaborators `createApp` and every
 * slice receive - constructor injection, no DI container (.NET mapping: a
 * hand-rolled `IServiceProvider`, but it is just this object). Handlers pull
 * everything they need - the database pools, config, the clock, the logger, the
 * rate-limit store, and the typed flags - from here, so they never reach for a
 * module-level singleton or a `node:*` API (R4).
 *
 * The single `db` handle became {@link Deps.databases} in task 064: under ADR-40 a
 * process holds one pool per environment plus a control pool, and which one a handler
 * runs on is what the database will enforce.
 */

import type { Clock } from "./clock.js";
import type { Databases } from "./environments.js";
import type { Config, Flags } from "./config.js";
import type { DraftAssistant } from "./features/forms/assist/types.js";
import type { ChallengeVerifier } from "./features/responses/challenge.js";
import type { Logger } from "./logger.js";
import type { RateLimitStore } from "./rate-limit.js";

export interface Deps {
  /**
   * The pools, one per environment plus a control pool (ADR-40, Q2 with Q40).
   *
   * **Which pool a handler takes is a privilege decision, not a convenience.** The
   * control pool holds no privilege on any data-plane table except `INSERT` on each
   * environment's `outbox`, and an environment pool holds none at all on the identity
   * and grant tables - so a handler reaching for the wrong one fails on permission
   * rather than reading something it should not. Criterion 6 is the test of it: no
   * authoring, identity, grant or release path runs on an environment pool, and no
   * respondent path runs on the control pool.
   */
  readonly databases: Databases;
  /** The validated boot configuration. */
  readonly config: Config;
  /** Injected clock - production wall time or a test-controlled one. */
  readonly clock: Clock;
  /** Injected structured logger - handlers log through this interface only. */
  readonly logger: Logger;
  /** Rate-limit store (in-memory default; swappable for Redis). */
  readonly rateLimitStore: RateLimitStore;
  /** Challenge verifier for `challengeRequired` forms (026); null verifier when provider `none`. */
  readonly challenge: ChallengeVerifier;
  /**
   * Draft assistant (041, ADR-25). Inert when `QCMS_FLAG_AGENT_AUTHORING=none`,
   * which is also when the assist routes are not mounted at all.
   */
  readonly draftAssistant: DraftAssistant;
  /** Typed feature flags (ADR-24); a convenience alias of `config.flags`. */
  readonly flags: Flags;
}
