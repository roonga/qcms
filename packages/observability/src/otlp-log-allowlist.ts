import type { LogRecordProcessor, SdkLogRecord } from "@opentelemetry/sdk-logs";

/**
 * The exported event vocabulary. An unlisted `msg` is replaced with
 * `application.event`, which is the correct fail direction for privacy (ADR-34) and a
 * silent one for observability: a new call site simply loses its body in the exported
 * signal. `./otlp-log-allowlist.coverage.test.ts` is what turns that silence into a red
 * - it scans every message literal in the workspace and requires each to be listed here
 * or recorded there as intentionally opaque (issue #490).
 */
const SAFE_EVENTS = new Set([
  "api.call",
  "auth.api.call",
  // The two retention-sweep redaction records (issue #490). Both are the evidence that a
  // redaction pass ran, which is the operationally interesting part, and both carry a
  // count and nothing else: the sweep exists to destroy the bytes it is counting, so a
  // call site that logged one of them would defeat itself long before this set saw it
  // (`apps/api/src/schedulers/retention-sweep.ts`).
  "delivery response snippets redacted",
  // Task 041's two assist records. Both are pass-level metrics an operator watches, and
  // both are safe for the same reason `origin.belt.refused` is: the body is a constant
  // declared at the call site, and every attribute either of them sets (`provider`,
  // `promptVersion`, `steps`, `inputTokens`, `outputTokens`, `finishReason`,
  // `toolRejected`, `tool`, `allowlisted`) is absent from SAFE_ATTRIBUTES and is
  // therefore deleted below. So what leaves the process is the event name and its count,
  // never a value.
  //
  // That last point is load-bearing for the second one rather than incidental. `tool` on
  // a rejected call is a name a hostile MODEL chose, which is the one string in this
  // slice an outside party can influence, and it does not travel. The name that does is
  // the reason the record exists: an allowlist refusal is the only trace an attempt to
  // publish, erase, mint a link or read an answer through the assistant leaves anywhere,
  // and counting those is the whole point of 041's control.
  "draft assistant turn",
  "draft assistant tool call rejected",
  "handled error",
  "http exception",
  "listening",
  // A CSRF-belt refusal, from either BFF: the portal's (issue #578) and the admin's
  // (issue #620) emit the same event name and the same four fields. Admitted to the
  // export vocabulary rather than collapsed to `application.event` because counting
  // refusals is the entire point of the line, and what the count means differs by app:
  // on the portal it is the accepted Fetch Metadata lockout rate an adopter needs to
  // compare against the estimate, on the admin it is the only trace a cross-origin
  // probe against the authentication routes leaves anywhere. Which app a record came
  // from is the exported resource's `service.name`, not an attribute (`service` is a
  // logger binding and is deleted below with everything else unlisted).
  //
  // Safe to export for the reason `apps/portal/lib/server/origin-belt-log.ts` and its
  // admin twin both set out: every field on this event is a constant declared in those
  // files, chosen by the request but never written by it.
  "origin.belt.refused",
  "outbox delivery pass",
  "outbox payload answers redacted",
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
  // vocabulary declared in `apps/portal/lib/server/origin-belt-log.ts` or in its admin
  // twin: a path template, how `Sec-Fetch-Site` read, how `Origin` read, and what the
  // refused party got back. None is copied from the request, so none can carry a
  // token, a session id, an address or an attacker-chosen string.
  //
  // The two apps' vocabularies for these names are disjoint but not identical in size
  // (`beltOutcome` has three members on the portal and two on the admin), which is a
  // property of those modules rather than of this set: nothing here enumerates values,
  // only names.
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
