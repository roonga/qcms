/**
 * Allowlist redaction for the Next apps' exported spans (SEC-13, ADR-34). The
 * same control as the API's, over a different span vocabulary, and one of these
 * spans carries something the API's never do.
 *
 * The secure-link token is in the URL, so Next's root span is named from the
 * real pathname and its path attributes hold the same string. That token is a
 * credential and may not leave the process in any signal, so this module
 * rewrites the span name as well as the attribute values. Only one app serves
 * that route, and both register the processor: a rule inert in one of them is
 * safer than two processors that can drift apart.
 *
 * The link token is the only branded id rewritten here; the rest are permitted
 * pseudonymous correlators under SEC-13. An instance label, which is authored
 * text, and an answer value under a qualified field name are dropped by the key
 * allowlist without being inspected.
 *
 * Otherwise the API's rules: unknown attribute keys are dropped rather than
 * inspected, a query string is removed whole, and an exception's message and
 * stack trace are never exported, the message being the one field where an
 * answer value can plausibly end up. The stdout log keeps it, correlated by
 * trace id.
 *
 * Registered before the exporting processor, so nothing unsanitized is queued.
 */

import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";

const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "next.span_name",
  "next.span_type",
  "next.route",
  "next.page",
  "next.segment",
  "next.rsc",
  "next.clientComponentLoadCount",
  "operation.name",
  "resource.name",
  "span.type",
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
  "service.name",
  "node.env",
  "process.runtime.name",
  "exception.type",
  "exception.escaped",
]);
const PATH_ATTRIBUTES = new Set([
  "http.url",
  "http.target",
  "url.path",
  "url.full",
  "next.span_name",
  "resource.name",
]);
const LINK_PATH = /\/l\/[^/?#]+/g;

export function redactTelemetryPath(value: string): string {
  const cut = Math.min(
    ...[value.indexOf("?"), value.indexOf("#")]
      .filter((index) => index >= 0)
      .concat([value.length]),
  );
  return value.slice(0, cut).replace(LINK_PATH, "/l/[token]");
}

export function sanitizeNextSpanAttributes(attributes: Attributes): void {
  for (const key of Object.keys(attributes)) {
    if (!ALLOWED_ATTRIBUTES.has(key)) {
      delete attributes[key];
      continue;
    }
    const value = attributes[key];
    if (PATH_ATTRIBUTES.has(key) && typeof value === "string") {
      attributes[key] = redactTelemetryPath(value);
    }
  }
}

export function sanitizeNextSpan(span: ReadableSpan): void {
  (span as unknown as { name: string }).name = redactTelemetryPath(span.name);
  sanitizeNextSpanAttributes(span.attributes);
  for (const event of span.events) {
    if (event.attributes !== undefined) sanitizeNextSpanAttributes(event.attributes);
  }
}

export function redactingNextSpanProcessor(): SpanProcessor {
  return {
    onStart: () => undefined,
    onEnd: sanitizeNextSpan,
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
