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
