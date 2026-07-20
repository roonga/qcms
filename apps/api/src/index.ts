/**
 * qcms-api public surface (task 017: the composition root).
 *
 * The app is a private application, not a published package; this barrel exists
 * so slices (018–026) and tests import the composition contracts from one place.
 * The server entry is `serve.ts` (run via `pnpm start`), intentionally not
 * re-exported here — importing this module must never bind a port.
 */

export { createApp, type RouteGroups, type SliceRegistrar, type CreateAppOptions } from "./app.js";
export { appGroups } from "./registrars.js";
export { buildApiDocuments, type ApiDocuments, type OpenApiDocument } from "./openapi-document.js";
export type { Deps } from "./deps.js";
export {
  loadConfig,
  ConfigError,
  FLAG_REGISTRY,
  MIN_SECRET_LENGTH,
  APP_KEY_MIN_LENGTH,
  type Config,
  type Flags,
  type MountFlags,
} from "./config.js";
export { systemClock, type Clock } from "./clock.js";
export {
  createJsonLogger,
  createNullLogger,
  type Logger,
  type LogFields,
  type LogLevel,
} from "./logger.js";
export {
  InMemoryRateLimitStore,
  rateLimit,
  type RateLimitStore,
  type RateLimitResult,
  type RateLimitOptions,
} from "./rate-limit.js";
export { ApiError, errors, type ErrorEnvelope, type ApiErrorStatus } from "./errors.js";
export {
  ErrorEnvelopeSchema,
  errorResponses,
  withScopes,
  SCOPES,
  PAT_SECURITY_SCHEME,
  type ApiEnv,
  type Scope,
} from "./openapi.js";
export { internalToken } from "./middleware/internal-token.js";
export { requestLogger } from "./middleware/request-logger.js";
export { errorEnvelope } from "./middleware/error-envelope.js";
export { registerHealthRoutes } from "./routes/health.js";
export {
  createIntervalScheduler,
  type Scheduler,
  type IntervalSchedulerOptions,
} from "./schedulers/scheduler.js";
export { createOutboxScheduler, type OutboxDeliver } from "./schedulers/outbox.js";
export { createRetentionSweepScheduler } from "./schedulers/retention-sweep.js";
