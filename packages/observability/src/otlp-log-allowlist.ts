import type { LogRecordProcessor, SdkLogRecord } from "@opentelemetry/sdk-logs";

const SAFE_EVENTS = new Set([
  "api.call",
  "auth.api.call",
  "handled error",
  "http exception",
  "listening",
  // A portal CSRF-belt refusal (issue #578). Admitted to the export vocabulary rather
  // than collapsed to `application.event` because counting refusals is the entire
  // point of the line: an adopter with an OTLP backend has to be able to see whether
  // the accepted Fetch Metadata lockout rate matches the estimate. Safe to export for
  // the reason `apps/portal/lib/server/origin-belt-log.ts` sets out - every field on
  // this event is a constant declared in that file, chosen by the request but never
  // written by it.
  "origin.belt.refused",
  "outbox delivery pass",
  "request",
  "retention sweep",
  "scheduler task failed",
  "shutdown complete",
  "shutting down",
  "unhandled error",
]);

const SAFE_ATTRIBUTES = new Set([
  // The four fields of `origin.belt.refused`, deliberately prefixed so that widening
  // this set widens it for one event's classifications and not for a common word a
  // future caller might hand a raw value under. Each holds a member of a closed
  // vocabulary declared in `apps/portal/lib/server/origin-belt-log.ts`: a path
  // template, how `Sec-Fetch-Site` read, how `Origin` read, and what the respondent
  // got back. None is copied from the request, so none can carry a token, a session
  // id, an address or an attacker-chosen string.
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
