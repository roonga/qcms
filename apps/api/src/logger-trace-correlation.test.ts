import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createJsonLogger } from "./logger.js";

/**
 * Task 054 exit criterion 3: an API log line carries `trace_id`/`span_id` when
 * tracing is active, without requiring correlation fields at call sites.
 *
 * A real `NodeSDK` is started here rather than a bare tracer provider because the
 * logger needs an active span, and an active span needs the SDK's
 * AsyncLocalStorage context manager.
 */

const sdk = new NodeSDK({
  spanProcessors: [new SimpleSpanProcessor({ exporter: new InMemorySpanExporter() })],
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

    let activeContext: { traceId: string; spanId: string } | undefined;
    trace.getTracer("test").startActiveSpan("active", (active) => {
      activeContext = active.spanContext();
      logger.info("inside", { path: "/health" });
      active.end();
    });

    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line.msg).toBe("inside");
    expect(line.path).toBe("/health");
    // The injected ids must BE the active span's context, not merely id-shaped:
    // shape-only assertions would pass if the instrumentation injected a stale
    // or unrelated context.
    expect(line.trace_id).toBe(activeContext?.traceId);
    expect(line.span_id).toBe(activeContext?.spanId);
    expect(line.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(line.span_id).toMatch(/^[0-9a-f]{16}$/);
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
