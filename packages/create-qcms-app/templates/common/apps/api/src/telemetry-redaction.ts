/**
 * SEC-13: allowlist redaction for exported spans (task 054, ADR-34).
 *
 * Telemetry leaves the process and lands in an adopter's backend, outside our
 * erasure reach, so what may appear in a span is decided by an **allowlist**, not
 * by a list of things to strip. Anything an instrumentation invents that is not
 * named here is dropped before export.
 *
 * Never in any signal: respondent answer values, `LocalizedText` content,
 * secure-link tokens (`lnk_`), the SEC-4 internal token, auth secrets. Branded
 * ids (`frm_`, `stp_`, `q_`, `ses_`) are permitted as pseudonymous correlators -
 * they are random and opaque, and they are what makes a trace worth reading.
 *
 * Two deliberate consequences of the allowlist, both narrower than "keep the
 * useful bits":
 *
 * - **Query strings go**, whole. Nothing in the API's own routes carries a secret
 *   in a query today (`?step=<n>` is the only one), and a rule that drops them
 *   cannot be broken later by a route that does.
 * - **`exception.message` and `exception.stacktrace` go**, so `exception.type`
 *   survives on its own. A validation error message is the one place an answer
 *   value can plausibly end up inside an error string. Task 062 added OTLP log
 *   export, so "exported" now covers log records as well, and the same rule holds
 *   there by a different mechanism: an `Error` field redacts to an object, only
 *   scalar fields become OTLP attributes, and the log allowlist in
 *   `@qcms/observability/logs` drops every key outside a small operational set.
 *   What still carries the message and the stack is the **stdout** structured log,
 *   next to the same `requestId`/`trace_id`, which is where a developer should
 *   read them.
 *
 * The seam is a `SpanProcessor` placed FIRST in the SDK's processor list, so it
 * runs before the exporting processor queues the span (`MultiSpanProcessor`
 * dispatches `onEnd` in order). Redaction therefore happens once, centrally,
 * rather than in every instrumentation's config.
 */

import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace";

/**
 * The span attribute keys allowed to leave this process.
 *
 * Both the stable semantic-convention names and the legacy `http.*` spellings are
 * listed: the instrumentations emit stable names, and some still emit the older
 * ones beside them, so naming both is the difference between a readable trace and
 * an empty one after an upstream upgrade.
 */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  // HTTP server + client (stable semconv).
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "url.scheme",
  "url.path",
  "url.full",
  "server.address",
  "server.port",
  "network.protocol.version",
  "network.peer.address",
  "network.peer.port",
  "user_agent.original",
  // HTTP (legacy semconv, still emitted by some instrumentation versions).
  "http.method",
  "http.status_code",
  "http.url",
  "http.target",
  "http.scheme",
  "http.host",
  "http.flavor",
  "net.peer.name",
  "net.peer.port",
  // Database (stable + legacy). Statement text only, parameterized: the pg
  // instrumentation's `enhancedDatabaseReporting` stays off, so no bound values.
  "db.system.name",
  "db.system",
  "db.namespace",
  "db.name",
  "db.operation.name",
  "db.operation",
  "db.query.text",
  "db.statement",
  "db.collection.name",
  "db.sql.table",
  "db.user",
  // Service identity, set as span attributes by the Hono middleware.
  "service.name",
  "service.version",
  // The human-facing correlation token (P5): the id in the error envelope, the
  // response header, and the API's log line.
  "qcms.request_id",
  // Exception events: the type, never the message or the stack (see the header).
  "exception.type",
  "exception.escaped",
]);

/** Attribute keys whose value is a URL and therefore needs its query removed. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "url.full",
  "url.path",
  "http.url",
  "http.target",
]);

/**
 * A URL (absolute or path-only) with its query and fragment removed.
 *
 * String surgery rather than `new URL()`: the value may be a bare path
 * (`http.target`), and a parse failure must never throw inside a span processor.
 */
export function redactUrl(value: string): string {
  const end = Math.min(
    ...[value.indexOf("?"), value.indexOf("#")]
      .filter((index) => index >= 0)
      .concat([value.length]),
  );
  return value.slice(0, end);
}

/**
 * Drop every attribute the allowlist does not name and redact the ones it does.
 * Mutates in place: this runs on the SDK's own span object before the exporting
 * processor sees it, which is what makes the guarantee central rather than
 * per-instrumentation.
 */
export function sanitizeAttributes(attributes: Attributes): void {
  for (const key of Object.keys(attributes)) {
    if (!ALLOWED_ATTRIBUTES.has(key)) {
      delete attributes[key];
      continue;
    }
    const value = attributes[key];
    if (URL_ATTRIBUTES.has(key) && typeof value === "string") {
      attributes[key] = redactUrl(value);
    }
  }
}

/** Apply the allowlist to a span's own attributes and to every event's. */
export function sanitizeSpan(span: ReadableSpan): void {
  sanitizeAttributes(span.attributes);
  for (const event of span.events) {
    if (event.attributes !== undefined) sanitizeAttributes(event.attributes);
  }
}

/**
 * The SEC-13 processor. Register it FIRST in the SDK's `spanProcessors` so the
 * exporting processor only ever queues sanitized spans.
 */
export function redactingSpanProcessor(): SpanProcessor {
  return {
    // Attributes arrive throughout a span's life (the Hono middleware sets the
    // status code at the end), so redaction can only be complete at `onEnd`.
    onStart: () => undefined,
    onEnd: (span) => sanitizeSpan(span),
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
