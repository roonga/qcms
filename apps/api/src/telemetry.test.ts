import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SERVICE_NAME,
  otlpEndpoint,
  startTelemetry,
  suppressDuplicateIncomingHttpSpans,
} from "./telemetry.js";

/**
 * The gate, not the exporter (task 054, ADR-34, exit criterion 2). Telemetry is a
 * hard no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set: the OTLP exporter's own
 * default would otherwise POST to `localhost:4318` and turn every flush into a
 * connection error in CI and in default dev runs.
 */
describe("otlpEndpoint", () => {
  it("is undefined when the endpoint is unset, blank, or whitespace", () => {
    expect(otlpEndpoint({})).toBeUndefined();
    expect(otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "" })).toBeUndefined();
    expect(otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "   " })).toBeUndefined();
  });

  it("trims the value and drops trailing slashes (the exporter appends /v1/traces)", () => {
    expect(otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: " http://collector:4318 " })).toBe(
      "http://collector:4318",
    );
    expect(otlpEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318//" })).toBe(
      "http://collector:4318",
    );
  });

  it("is not enabled by the signal-specific traces endpoint alone (one switch)", () => {
    expect(
      otlpEndpoint({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector:4318/v1/traces" }),
    ).toBeUndefined();
  });
});

describe("startTelemetry", () => {
  it("starts nothing when no endpoint is configured", async () => {
    const telemetry = await startTelemetry({ env: {} });
    expect(telemetry.enabled).toBe(false);

    // The proof that no SDK was registered: with only the API's no-op tracer
    // provider in place, a span is not recording, so nothing is sampled, batched
    // or exported anywhere.
    const span = trace.getTracer("test").startSpan("probe");
    expect(span.isRecording()).toBe(false);
    span.end();

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it("names the service qcms-api by default", () => {
    expect(DEFAULT_SERVICE_NAME).toBe("qcms-api");
  });
});

describe("suppressDuplicateIncomingHttpSpans", () => {
  it("drops only incoming node:http SERVER spans", () => {
    const ended: unknown[] = [];
    const delegate = {
      onStart: vi.fn(),
      onEnd: vi.fn((span: unknown) => ended.push(span)),
      forceFlush: vi.fn(() => Promise.resolve()),
      shutdown: vi.fn(() => Promise.resolve()),
    };
    const processor = suppressDuplicateIncomingHttpSpans(delegate);
    const rawServer = {
      kind: 1,
      instrumentationScope: { name: "@opentelemetry/instrumentation-http" },
    };
    const honoServer = { kind: 1, instrumentationScope: { name: "@hono/otel" } };
    const httpClient = {
      kind: 2,
      instrumentationScope: { name: "@opentelemetry/instrumentation-http" },
    };

    processor.onEnd(rawServer as never);
    processor.onEnd(honoServer as never);
    processor.onEnd(httpClient as never);

    expect(ended).toEqual([honoServer, httpClient]);
  });
});
