import type { LogRecordProcessor, ReadWriteLogRecord } from "@opentelemetry/sdk-logs";

/**
 * The exported event vocabulary. An unlisted `msg` becomes `application.event`,
 * the correct fail direction for privacy (ADR-34); the coverage test beside this
 * file requires every message literal in the workspace to be listed here or
 * recorded there as intentionally opaque. An entry is admissible only when its
 * body is a constant declared at the call site and the attributes it sets carry
 * no value a request or a model chose (SEC-8).
 */
const SAFE_EVENTS = new Set([
  "admin two-factor reset",
  "api.call",
  "auth.api.call",
  "delivery response snippets redacted",
  "draft assistant turn",
  "draft assistant tool call rejected",
  "draft assistant provider failure",
  "agent proposal accepted",
  "agent proposal refused",
  "handled error",
  "http exception",
  "listening",
  "origin.belt.refused",
  "outbox delivery pass",
  "outbox delivery pass failed",
  "outbox payload answers redacted",
  "request",
  "retention sweep",
  "scheduler task failed",
  "shutdown complete",
  "shutting down",
  "the environment set and the configuration disagree",
  "could not check the environment set against control.environments",
  "unhandled error",
]);

const SAFE_ATTRIBUTES = new Set([
  "beltRoute",
  "beltFetchSite",
  "beltOrigin",
  "beltOutcome",
  "requestId",
  "method",
  "path",
  "status",
  "durationMs",
  "code",
  "errorId",
  // An operator's own name for an environment or a schema, chosen by the
  // deployment rather than by a request (ADR-40, SEC-13).
  "environment",
  "scheduler",
  "expiredCount",
  "redactedCount",
  "claimed",
  "delivered",
  "failed",
  "deadLettered",
]);

export function safeEventName(body: unknown): string {
  return typeof body === "string" && SAFE_EVENTS.has(body) ? body : "application.event";
}

function allowlist(record: ReadWriteLogRecord): void {
  record.setBody(safeEventName(record.body));
  for (const key of Object.keys(record.attributes)) {
    if (!SAFE_ATTRIBUTES.has(key)) delete record.attributes[key];
  }
}

/**
 * Runs synchronously, before the batch processor can retain a record (SEC-13).
 * Exports nothing itself: the next processor owns buffering and delivery.
 */
export function allowlistingLogRecordProcessor(): LogRecordProcessor {
  return {
    onEmit: allowlist,
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
