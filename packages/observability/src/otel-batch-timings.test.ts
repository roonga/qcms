import { describe, expect, it } from "vitest";

import { batchLogExportTimings, batchSpanExportTimings } from "./otel-batch-timings.js";

/**
 * What these cases are for (issue #901).
 *
 * The defect this module exists to close was invisible: `OTEL_BSP_SCHEDULE_DELAY=500`
 * had been set in the browser harness since task 054 and reached no processor, because
 * OpenTelemetry JS 2.x moved the env fallbacks out of the constructors these apps call.
 * Nothing failed, so nothing pointed at it; the only symptom was a telemetry poll with
 * a fifth of the margin its comment claimed.
 *
 * So the assertions below pin the two halves that silence can hide: that a value which
 * IS set arrives as a number a processor can be constructed with, and that an unset
 * variable resolves to the same default the SDK would have applied anyway, which is
 * what makes passing these options explicitly a no-op for every deployment that
 * configures nothing.
 */
describe("batchSpanExportTimings", () => {
  it("falls back to the specification defaults when nothing is configured", () => {
    expect(batchSpanExportTimings({})).toEqual({
      scheduledDelayMillis: 5_000,
      exportTimeoutMillis: 30_000,
    });
  });

  it("reads the standard OTEL_BSP variables", () => {
    expect(
      batchSpanExportTimings({
        OTEL_BSP_SCHEDULE_DELAY: "500",
        OTEL_BSP_EXPORT_TIMEOUT: "10000",
      }),
    ).toEqual({ scheduledDelayMillis: 500, exportTimeoutMillis: 10_000 });
  });

  it("ignores the log pipeline's variables (the two are configured separately)", () => {
    expect(
      batchSpanExportTimings({
        OTEL_BLRP_SCHEDULE_DELAY: "500",
        OTEL_BLRP_EXPORT_TIMEOUT: "10000",
      }),
    ).toEqual({ scheduledDelayMillis: 5_000, exportTimeoutMillis: 30_000 });
  });
});

describe("batchLogExportTimings", () => {
  it("falls back to the specification defaults when nothing is configured", () => {
    expect(batchLogExportTimings({})).toEqual({
      scheduledDelayMillis: 1_000,
      exportTimeoutMillis: 30_000,
    });
  });

  it("reads the standard OTEL_BLRP variables", () => {
    expect(
      batchLogExportTimings({
        OTEL_BLRP_SCHEDULE_DELAY: "500",
        OTEL_BLRP_EXPORT_TIMEOUT: "10000",
      }),
    ).toEqual({ scheduledDelayMillis: 500, exportTimeoutMillis: 10_000 });
  });

  it("ignores the span pipeline's variables", () => {
    expect(
      batchLogExportTimings({
        OTEL_BSP_SCHEDULE_DELAY: "500",
        OTEL_BSP_EXPORT_TIMEOUT: "10000",
      }),
    ).toEqual({ scheduledDelayMillis: 1_000, exportTimeoutMillis: 30_000 });
  });

  it("trims surrounding whitespace, which a compose file or a shell can add", () => {
    expect(batchLogExportTimings({ OTEL_BLRP_SCHEDULE_DELAY: " 750 " }).scheduledDelayMillis).toBe(
      750,
    );
  });

  /**
   * Every rejected shape falls back rather than throwing, and the reason is a
   * deliberate trade: a mistyped telemetry variable must not be able to stop a process
   * from serving requests. The cases that matter are the ones a permissive parser would
   * accept as plausible numbers - `parseInt("500ms")` is 500 and `parseInt("1e4")` is 1 -
   * because those turn a typo into a timing nobody would question.
   */
  it.each([
    ["not a number", "soon"],
    ["a unit suffix", "500ms"],
    ["exponent notation", "1e4"],
    ["a decimal", "500.5"],
    ["a negative", "-500"],
    ["zero, which would mean export on every record", "0"],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("falls back to the default on %s", (_shape, raw) => {
    expect(batchLogExportTimings({ OTEL_BLRP_SCHEDULE_DELAY: raw }).scheduledDelayMillis).toBe(
      1_000,
    );
  });

  it("is undisturbed by an unrelated OTEL variable", () => {
    expect(batchLogExportTimings({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" })).toEqual(
      { scheduledDelayMillis: 1_000, exportTimeoutMillis: 30_000 },
    );
  });
});
