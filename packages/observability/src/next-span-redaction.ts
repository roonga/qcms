/**
 * SEC-13: allowlist redaction for the Next apps' exported spans (task 054, ADR-34; shared
 * by Portal and Admin in task 062).
 *
 * Same control as the API's (`apps/api/src/telemetry-redaction.ts`), applied to a
 * different span vocabulary: these spans come from Next.js and `@vercel/otel`, and one of
 * them carries something the API's never do.
 *
 * **The secure-link token is in the URL.** The respondent entry point is `/l/<token>`
 * (task 029), so Next's root span is named from the real pathname (`GET /l/<token>`,
 * exactly as the Next OTel guide documents) and its `http.target` / `url.path` attributes
 * hold the same string. A `lnk_` token is a credential: it may not leave the process in
 * any signal. So this module redacts the **span name** as well as the attribute values,
 * the one place any app rewrites a name rather than dropping a field. Only the Portal
 * serves that route, but both apps register the same processor: a rule that is inert in
 * one of them is safer than two processors that can drift apart.
 *
 * Everything else follows the API's rules: an allowlist over attribute keys (unknown keys
 * are dropped, not inspected), query strings removed whole, and `exception.message` /
 * `exception.stacktrace` never exported (the message is the one field where an answer
 * value can plausibly end up inside an error string; the stdout log keeps it, correlated
 * by `trace_id`).
 *
 * Registered FIRST in `registerOTel`'s `spanProcessors`, before the exporting processor,
 * so nothing unsanitized is ever queued.
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
