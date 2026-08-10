/**
 * A minimal OTLP/HTTP receiver for the Playwright suite (task 054).
 *
 * Test support only - it exists so the tracing baseline can be proved against
 * **real exported payloads** with no external collector, no viewer, and no new
 * production surface. It accepts `POST /v1/traces` and `POST /v1/logs`
 * (OTLP/HTTP + JSON, the encoding
 * `@opentelemetry/exporter-trace-otlp-http` and `@vercel/otel` with
 * `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` both send), appends each request body
 * verbatim to a JSONL capture file, and answers `{}`.
 *
 * Verbatim matters twice over. The connected-trace assertions read parsed spans
 * out of it, and the SEC-13 assertion greps the raw bytes: "a known submitted
 * answer string appears nowhere in the captured OTLP payloads" is only a real
 * check if what was captured is exactly what left the process.
 *
 * It runs in the Playwright runner process (globalSetup starts it, globalTeardown
 * stops it) while both traced processes - the composed API in that same process
 * and the portal dev server in another - export to it over HTTP. The capture file
 * is how a spec in a worker process reads what the runner received.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname } from "node:path";

import { OTLP_CAPTURE_PATH, OTLP_PORT } from "./harness-config.js";

/** The scalar shapes an OTLP attribute value can flatten to. */
export type CapturedAttributeValue = string | number | boolean;

/** One span, flattened out of the OTLP JSON envelope for assertions. */
export interface CapturedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string;
  readonly name: string;
  /** OTLP span kind: 2 = SERVER, 3 = CLIENT, 1 = INTERNAL. */
  readonly kind: number;
  /** `service.name` from the owning resource. */
  readonly serviceName: string;
  readonly attributes: Readonly<Record<string, CapturedAttributeValue>>;
}

export interface CapturedLog {
  readonly traceId: string;
  readonly spanId: string;
  readonly serviceName: string;
  readonly body: string;
  readonly attributes: Readonly<Record<string, CapturedAttributeValue>>;
}

let server: Server | undefined;

/** Start the receiver and truncate the capture file for this run window. */
export async function startOtlpReceiver(): Promise<void> {
  if (server !== undefined) return;
  mkdirSync(dirname(OTLP_CAPTURE_PATH), { recursive: true });
  writeFileSync(OTLP_CAPTURE_PATH, "", "utf8");

  const listening = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (
        (request.url === "/v1/traces" || request.url === "/v1/logs") &&
        request.method === "POST"
      ) {
        // One line per export request; newlines inside a JSON body are impossible
        // (the exporter emits compact JSON), so JSONL is safe here.
        appendFileSync(OTLP_CAPTURE_PATH, `${Buffer.concat(chunks).toString("utf8")}\n`);
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    // A dropped export must never take the receiver (or the suite) down.
    request.on("error", () => response.destroy());
  });

  await new Promise<void>((resolve) => {
    listening.listen(OTLP_PORT, "127.0.0.1", resolve);
  });
  server = listening;
}

/** Stop the receiver. Safe to call when it was never started. */
export async function stopOtlpReceiver(): Promise<void> {
  const current = server;
  server = undefined;
  if (current === undefined) return;
  await new Promise<void>((resolve) => {
    current.close(() => resolve());
  });
}

/** Every exported OTLP payload received so far, as raw text (the SEC-13 grep). */
export function readCapturedPayloads(): string {
  try {
    return readFileSync(OTLP_CAPTURE_PATH, "utf8");
  } catch {
    return "";
  }
}

/** The OTLP JSON shapes this receiver reads. Only the fields assertions need. */
interface OtlpValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}
interface OtlpAttribute {
  key?: string;
  value?: OtlpValue;
}
interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number;
  attributes?: OtlpAttribute[];
}
interface OtlpResourceSpans {
  resource?: { attributes?: OtlpAttribute[] };
  scopeSpans?: { spans?: OtlpSpan[] }[];
}
interface OtlpPayload {
  resourceSpans?: OtlpResourceSpans[];
  resourceLogs?: OtlpResourceLogs[];
}

interface OtlpLogRecord {
  traceId?: string;
  spanId?: string;
  body?: OtlpValue;
  attributes?: OtlpAttribute[];
}

interface OtlpResourceLogs {
  resource?: { attributes?: OtlpAttribute[] };
  scopeLogs?: { logRecords?: OtlpLogRecord[] }[];
}

/** Flatten OTLP's typed attribute values to scalars, dropping anything else. */
function flattenAttributes(
  attributes: OtlpAttribute[] | undefined,
): Record<string, CapturedAttributeValue> {
  const out: Record<string, CapturedAttributeValue> = {};
  for (const attribute of attributes ?? []) {
    const key = attribute.key;
    const value = attribute.value;
    if (key === undefined || value === undefined) continue;
    if (value.stringValue !== undefined) out[key] = value.stringValue;
    else if (value.intValue !== undefined) out[key] = Number(value.intValue);
    else if (value.doubleValue !== undefined) out[key] = value.doubleValue;
    else if (value.boolValue !== undefined) out[key] = value.boolValue;
  }
  return out;
}

/** Flatten every span carried by one resource, stamping its `service.name`. */
function spansOfResource(resourceSpan: OtlpResourceSpans): CapturedSpan[] {
  const resource = flattenAttributes(resourceSpan.resource?.attributes);
  const service = resource["service.name"];
  const serviceName = typeof service === "string" ? service : "";
  return (resourceSpan.scopeSpans ?? []).flatMap((scopeSpan) =>
    (scopeSpan.spans ?? []).map((span) => ({
      traceId: span.traceId ?? "",
      spanId: span.spanId ?? "",
      parentSpanId: span.parentSpanId ?? "",
      name: span.name ?? "",
      kind: span.kind ?? 0,
      serviceName,
      attributes: flattenAttributes(span.attributes),
    })),
  );
}

/** One captured line, or `undefined` if it is not parseable OTLP JSON. */
function parsePayload(line: string): OtlpPayload | undefined {
  try {
    return JSON.parse(line) as OtlpPayload;
  } catch {
    return undefined;
  }
}

/** Every captured span, flattened. Malformed lines are skipped, never thrown on. */
export function readCapturedSpans(): CapturedSpan[] {
  return readCapturedPayloads()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => parsePayload(line)?.resourceSpans ?? [])
    .flatMap(spansOfResource);
}

export function readCapturedLogs(): CapturedLog[] {
  return readCapturedPayloads()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => parsePayload(line)?.resourceLogs ?? [])
    .flatMap((resourceLog) => {
      const resource = flattenAttributes(resourceLog.resource?.attributes);
      const service = resource["service.name"];
      const serviceName = typeof service === "string" ? service : "";
      return (resourceLog.scopeLogs ?? []).flatMap((scopeLog) =>
        (scopeLog.logRecords ?? []).map((record) => ({
          traceId: record.traceId ?? "",
          spanId: record.spanId ?? "",
          serviceName,
          body: record.body?.stringValue ?? "",
          attributes: flattenAttributes(record.attributes),
        })),
      );
    });
}
