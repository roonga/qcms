/**
 * SEC-13: spans leave our erasure reach, so an allowlist over attribute keys (never values)
 * decides what appears. Never exported: answer values, `LocalizedText`, link tokens, the
 * SEC-4 token, secrets. Query strings and `exception.message`/`stacktrace` go whole.
 */

import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace";

/**
 * Both the stable semantic-convention names and the legacy spellings are listed, because
 * some instrumentation versions still emit the older ones.
 */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
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
  "http.method",
  "http.status_code",
  "http.url",
  "http.target",
  "http.scheme",
  "http.host",
  "http.flavor",
  "net.peer.name",
  "net.peer.port",
  // Statement text is parameterized only: the pg instrumentation's
  // `enhancedDatabaseReporting` stays off, so no bound values appear.
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
  "service.name",
  "service.version",
  "qcms.request_id",
  // An operator's own schema name out of `control.environments`: not respondent-derived,
  // and carrying no answer, token or identity.
  "qcms.environment",
  // The type only, never the message or the stack.
  "exception.type",
  "exception.escaped",
]);

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "url.full",
  "url.path",
  "http.url",
  "http.target",
]);

/**
 * String surgery rather than `new URL()`: the value may be a bare path, and a parse
 * failure must never throw inside a span processor.
 */
export function redactUrl(value: string): string {
  const end = Math.min(
    ...[value.indexOf("?"), value.indexOf("#")]
      .filter((index) => index >= 0)
      .concat([value.length]),
  );
  return value.slice(0, end);
}

/** Mutates in place: this is the SDK's own span object, before any exporter sees it. */
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

export function sanitizeSpan(span: ReadableSpan): void {
  sanitizeAttributes(span.attributes);
  for (const event of span.events) {
    if (event.attributes !== undefined) sanitizeAttributes(event.attributes);
  }
}

/** Must be registered FIRST in `spanProcessors` so exporters only queue sanitized spans. */
export function redactingSpanProcessor(): SpanProcessor {
  return {
    // Attributes arrive throughout a span's life, so redaction is only complete at `onEnd`.
    onStart: () => undefined,
    onEnd: (span) => sanitizeSpan(span),
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
