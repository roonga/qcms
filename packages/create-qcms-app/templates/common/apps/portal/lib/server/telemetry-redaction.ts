/**
 * SEC-13: allowlist redaction for the portal's exported spans (task 054, ADR-34).
 *
 * Same control as the API's (`apps/api/src/telemetry-redaction.ts`), applied to a
 * different span vocabulary: the portal's spans come from Next.js and
 * `@vercel/otel`, and one of them carries something the API's never do.
 *
 * **The secure-link token is in the URL.** The respondent entry point is
 * `/l/<token>` (task 029), so Next's root span is named from the real pathname
 * (`GET /l/<token>`, exactly as the Next OTel guide documents) and its
 * `http.target` / `url.path` attributes hold the same string. A `lnk_` token is a
 * credential: it may not leave this process in any signal. So this module redacts
 * the **span name** as well as the attribute values - the one place either app
 * rewrites a name rather than dropping a field.
 *
 * Everything else follows the API's rules: an allowlist over attribute keys
 * (unknown keys are dropped, not inspected), query strings removed whole, and
 * `exception.message` / `exception.stacktrace` never exported (the message is the
 * one field where an answer value can plausibly end up inside an error string;
 * the server log keeps it, correlated by `trace_id`).
 *
 * Registered FIRST in `registerOTel`'s `spanProcessors`, before the exporting
 * processor, so nothing unsanitized is ever queued.
 */

import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";

/** Span attribute keys allowed to leave the portal process. */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  // Next.js's own span attributes (nextjs.org/docs/app/guides/open-telemetry).
  "next.span_name",
  "next.span_type",
  "next.route",
  "next.page",
  "next.segment",
  "next.rsc",
  "next.clientComponentLoadCount",
  // `@vercel/otel` derives these from the request for backend compatibility.
  "operation.name",
  "resource.name",
  "span.type",
  // HTTP, stable and legacy semconv (the fetch instrumentation emits both).
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "http.method",
  "http.status_code",
  "http.url",
  "http.target",
  "http.host",
  "http.scheme",
  "url.scheme",
  "url.path",
  "url.full",
  "server.address",
  "server.port",
  "net.peer.name",
  "net.peer.port",
  // Resource-ish attributes @vercel/otel sets on spans in a self-hosted run.
  "service.name",
  "node.env",
  "process.runtime.name",
  // Exception events: the type only.
  "exception.type",
  "exception.escaped",
]);

/** Attribute keys whose value is a URL or a path and must be path-redacted. */
const PATH_ATTRIBUTES: ReadonlySet<string> = new Set([
  "http.url",
  "http.target",
  "url.path",
  "url.full",
  "next.span_name",
  "resource.name",
]);

/**
 * The secure-link entry point, whose single path segment IS the credential.
 * Replaced with the route pattern Next itself uses, so a trace still shows which
 * route ran without showing the token.
 */
const LINK_PATH = /\/l\/[^/?#]+/g;

/**
 * A URL, path, or span name with its query, fragment and secure-link token
 * removed. String surgery, not `new URL()`: the value may be a bare path or a
 * span name (`GET /l/abc`), and nothing here may throw inside a span processor.
 */
export function redactPath(value: string): string {
  const cut = Math.min(
    ...[value.indexOf("?"), value.indexOf("#")]
      .filter((index) => index >= 0)
      .concat([value.length]),
  );
  return value.slice(0, cut).replace(LINK_PATH, "/l/[token]");
}

/** Drop every attribute the allowlist does not name; path-redact the rest. */
export function sanitizeAttributes(attributes: Attributes): void {
  for (const key of Object.keys(attributes)) {
    if (!ALLOWED_ATTRIBUTES.has(key)) {
      delete attributes[key];
      continue;
    }
    const value = attributes[key];
    if (PATH_ATTRIBUTES.has(key) && typeof value === "string") {
      attributes[key] = redactPath(value);
    }
  }
}

/**
 * The span's `name` field, which SEC-13 has to rewrite rather than drop.
 *
 * `ReadableSpan` types `name` as readonly because a *consumer* of a span must not
 * rename it. Redaction is not consumption: this processor is part of the pipeline
 * that produces the exported span, and the name is where Next puts the raw
 * pathname (so, for `/l/<token>`, the token). Hence one narrowly-typed mutable
 * view, for this one field. The SDK's span object is a plain mutable object here;
 * `@vercel/otel` itself mutates `span.attributes` in its own `onEnd` for the same
 * reason.
 */
interface RenameableSpan {
  name: string;
}

/** Apply the allowlist to a span's name, attributes and event attributes. */
export function sanitizeSpan(span: ReadableSpan): void {
  const renameable = span as unknown as RenameableSpan;
  renameable.name = redactPath(span.name);
  sanitizeAttributes(span.attributes);
  for (const event of span.events) {
    if (event.attributes !== undefined) sanitizeAttributes(event.attributes);
  }
}

/**
 * The SEC-13 processor. Pass it FIRST in `registerOTel`'s `spanProcessors`, ahead
 * of `"auto"`, so the exporting processor only ever queues sanitized spans
 * (`@vercel/otel` dispatches `onEnd` to its processors in order).
 */
export function redactingSpanProcessor(): SpanProcessor {
  return {
    // Attributes and the final name arrive over a span's lifetime, so redaction
    // can only be complete at `onEnd`.
    onStart: () => undefined,
    onEnd: (span) => sanitizeSpan(span),
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
