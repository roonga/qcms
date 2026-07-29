import { trace } from "@opentelemetry/api";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createJsonLogger } from "./logger.js";

/**
 * Task 054 exit criterion 3: an API log line carries `trace_id`/`span_id` when
 * tracing is active, and it gets them from `@opentelemetry/instrumentation-pino` -
 * not from a call site, and not from any context lookup of ours.
 *
 * The ordering this test encodes is the whole reason `createJsonLogger` requires
 * pino lazily (see the comment on `requireFromHere` in `logger.ts`): the
 * instrumentation patches pino when the module is first required, so the SDK must
 * start FIRST. If a future change hoists that require to module scope, the
 * injection silently stops and this test is what notices.
 *
 * A real `NodeSDK` is started here rather than a bare tracer provider because the
 * injection needs an active span, and an active span needs the SDK's
 * AsyncLocalStorage context manager.
 */

const sdk = new NodeSDK({
  spanProcessors: [new SimpleSpanProcessor({ exporter: new InMemorySpanExporter() })],
  instrumentations: [new PinoInstrumentation({ disableLogSending: true })],
});

beforeAll(() => {
  // Never inherit a developer's real endpoint: this test exports nowhere.
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
  sdk.start();
});

afterAll(async () => {
  await sdk.shutdown();
  vi.unstubAllEnvs();
});

describe("log/trace correlation", () => {
  it("injects trace_id and span_id into lines emitted inside a span", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({ write: (line) => lines.push(line), base: { service: "t" } });

    const span = trace.getTracer("test").startSpan("unit");
    const expected = span.spanContext();
    trace.getTracer("test").startActiveSpan("active", (active) => {
      logger.info("inside", { path: "/health" });
      active.end();
    });
    span.end();

    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line.msg).toBe("inside");
    expect(line.path).toBe("/health");
    expect(typeof line.trace_id).toBe("string");
    expect(line.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(line.span_id).toMatch(/^[0-9a-f]{16}$/);
    // Sanity: a recording SDK is in place, so the ids above are real ones.
    expect(expected.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("emits no trace fields outside a span, and keeps the shape otherwise", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      write: (line) => lines.push(line),
      now: () => new Date("2026-07-29T00:00:00.000Z"),
      base: { service: "qcms-api" },
    });

    logger.warn("outside", { status: 404 });

    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({
      level: "warn",
      time: "2026-07-29T00:00:00.000Z",
      msg: "outside",
      service: "qcms-api",
      status: 404,
    });
    expect(line.trace_id).toBeUndefined();
  });
});
