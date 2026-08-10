import type { LogRecordProcessor, SdkLogRecord } from "@opentelemetry/sdk-logs";

const SAFE_EVENTS = new Set([
  "api.call",
  "auth.api.call",
  "handled error",
  "http exception",
  "listening",
  "outbox delivery pass",
  "request",
  "retention sweep",
  "scheduler task failed",
  "shutdown complete",
  "shutting down",
  "unhandled error",
]);

const SAFE_ATTRIBUTES = new Set([
  "requestId",
  "method",
  "path",
  "status",
  "durationMs",
  "code",
  "errorId",
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

function allowlist(record: SdkLogRecord): void {
  record.setBody(safeEventName(record.body));
  for (const key of Object.keys(record.attributes)) {
    if (!SAFE_ATTRIBUTES.has(key)) delete record.attributes[key];
  }
}

/**
 * SEC-13 runs synchronously before the batch processor can retain a record.
 * It exports no data itself; the next processor owns buffering and delivery.
 */
export function allowlistingLogRecordProcessor(): LogRecordProcessor {
  return {
    onEmit: allowlist,
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
