import { describe, expect, it } from "vitest";

import { batchLogExportTimings, batchSpanExportTimings } from "./otel-batch-timings.js";

/**
 * The defect this module closes is invisible: a schedule delay set in the
 * environment reached no processor, nothing failed, and the only symptom was a
 * telemetry poll with a fraction of the margin it claimed.
 *
 * So these pin the two halves silence can hide: a value that is set arrives as a
 * number a processor can be constructed with, and an unset variable resolves to
 * the default the SDK would have applied anyway, which is what makes passing
 * these options explicit a no-op for a deployment that configures nothing.
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
   * A rejected shape falls back rather than throwing, because a mistyped
   * telemetry variable must not stop a process serving requests. The cases that
   * matter are the ones a permissive parser would read as plausible numbers,
   * since those turn a typo into a timing nobody would question.
   *
   * Zero is a rejection rather than a parse failure, and diverges from the
   * upstream shim: a zero delay stops batching rather than shortening it. The
   * floor is documented in `docs/operations.md`, and one is accepted, so nothing
   * blocks a deployment that wants the promptest batch this pipeline offers.
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
