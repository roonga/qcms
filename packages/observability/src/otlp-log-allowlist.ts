import type { LogRecordProcessor, ReadWriteLogRecord } from "@opentelemetry/sdk-logs";

/**
 * The exported event vocabulary. An unlisted `msg` is replaced with
 * `application.event`, which is the correct fail direction for privacy (ADR-34)
 * and a silent one for observability, since a new call site simply loses its
 * body. `./otlp-log-allowlist.coverage.test.ts` turns that silence into a red by
 * requiring every message literal in the workspace to be listed here or
 * recorded there as intentionally opaque.
 *
 * An entry is admissible when its body is a constant declared at the call site
 * and every attribute it sets is absent from SAFE_ATTRIBUTES, so what leaves the
 * process is the event name and its count rather than any value. Where a note
 * below exists, it is because that event's own reasoning is not obvious.
 */
const SAFE_EVENTS = new Set([
  // The one signal that an administrator's second factor was cleared out of
  // band: the command has no HTTP surface, so nothing else a backend can see
  // records that it ran. It carries no attributes at all, the identifiers worth
  // knowing about a reset living on the audit row instead, inside the erasure
  // and retention controls an exported record is outside of.
  "admin two-factor reset",
  "api.call",
  "auth.api.call",
  // The evidence that a redaction pass ran, carrying a count and nothing else:
  // the sweep exists to destroy the bytes it counts.
  "delivery response snippets redacted",
  "draft assistant turn",
  // The only trace an attempt to publish, erase, mint a link or read an answer
  // through the assistant leaves anywhere, so counting these is the control.
  // `tool` is a name a hostile model chose, and it does not travel.
  "draft assistant tool call rejected",
  // So a provider refusal an operator must act on leaves a trace, the panel
  // deliberately showing them no vendor detail. The vendor's own message is
  // never logged at all (SEC-8).
  "draft assistant provider failure",
  "agent proposal accepted",
  // One event for every way an accept can be refused, told apart by a `reason`
  // attribute: the consequence is the same and the combined rate is the signal,
  // a configured model producing definitions this deployment cannot take.
  // `questionId` here is an id a model invented and does not travel, and nor
  // does the definition, which is never logged (SEC-8).
  "agent proposal refused",
  "handled error",
  "http exception",
  "listening",
  // A CSRF-belt refusal from either BFF. Counting refusals is the point of the
  // line, and the count means something different per app, which the exported
  // resource's `service.name` distinguishes rather than any attribute. Every
  // field is a constant chosen by the request but never written by it.
  "origin.belt.refused",
  "outbox delivery pass",
  // Which environment's outbox is not moving is the question this line exists to
  // answer, and the only field beside the error is the environment name.
  "outbox delivery pass failed",
  "outbox payload answers redacted",
  "request",
  "retention sweep",
  "scheduler task failed",
  "shutdown complete",
  "shutting down",
  // A boot-time misconfiguration an operator has to see by name, built from
  // environment names alone and never a connection string or credential
  // (SEC-8). It refuses the boot, so this is the last thing the process writes.
  "the environment set and the configuration disagree",
  // Its own line, because the check failing is handled the opposite way from the
  // check disagreeing: the process warns and binds. Collapsing it would leave an
  // operator unable to tell a fault from an unknown. The body is the driver's
  // error and no connection string (SEC-8).
  "could not check the environment set against control.environments",
  "unhandled error",
]);

const SAFE_ATTRIBUTES = new Set([
  // The belt-refusal fields, prefixed deliberately so that admitting them
  // widens this set for one event's classifications rather than for a common
  // word a future caller might hand a raw value under. Each holds a member of a
  // closed vocabulary declared at the call site, none copied from the request,
  // so none can carry a token, a session id, an address or an
  // attacker-chosen string. Nothing here enumerates values, only names.
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
  // Every count a per-environment job logs is a count in one environment, and a
  // line without the name would report that an outbox is not draining without
  // saying which one (ADR-40, SEC-13). Safe for the reason `scheduler` is: the
  // value is an operator's own name for a schema, chosen by the deployment
  // rather than by a request, carrying no answer, token or identity.
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
 * It exports nothing itself: the next processor owns buffering and delivery.
 */
export function allowlistingLogRecordProcessor(): LogRecordProcessor {
  return {
    onEmit: allowlist,
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
