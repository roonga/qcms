import { readFileSync } from "node:fs";

import { batchLogExportTimings, batchSpanExportTimings } from "@roonga/qcms-observability/otel";
import { describe, expect, it } from "vitest";

import {
  OTLP_DELIVERY_BUDGET_MS,
  OTLP_EXPORT_TIMEOUT_MS,
  OTLP_POLL_MS,
  OTLP_SCHEDULE_DELAY_MS,
  otlpDeliveryNote,
} from "./harness-config.js";

/** One repo file, as text, resolved from this file rather than from the process cwd. */
function source(relativePath: string): string {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}

/** The four standard batch variables, paired with the constant each must be given. */
const REQUIRED_ENV = [
  ["OTEL_BSP_SCHEDULE_DELAY", "OTLP_SCHEDULE_DELAY_MS"],
  ["OTEL_BSP_EXPORT_TIMEOUT", "OTLP_EXPORT_TIMEOUT_MS"],
  ["OTEL_BLRP_SCHEDULE_DELAY", "OTLP_SCHEDULE_DELAY_MS"],
  ["OTEL_BLRP_EXPORT_TIMEOUT", "OTLP_EXPORT_TIMEOUT_MS"],
] as const;

describe("the configured batch timings", () => {
  it.each(REQUIRED_ENV)("resolves %s from the harness constant", (variable) => {
    const env = {
      OTEL_BSP_SCHEDULE_DELAY: OTLP_SCHEDULE_DELAY_MS,
      OTEL_BSP_EXPORT_TIMEOUT: OTLP_EXPORT_TIMEOUT_MS,
      OTEL_BLRP_SCHEDULE_DELAY: OTLP_SCHEDULE_DELAY_MS,
      OTEL_BLRP_EXPORT_TIMEOUT: OTLP_EXPORT_TIMEOUT_MS,
    };
    const timings = variable.startsWith("OTEL_BSP")
      ? batchSpanExportTimings(env)
      : batchLogExportTimings(env);

    expect(timings.scheduledDelayMillis).toBe(Number(OTLP_SCHEDULE_DELAY_MS));
    expect(timings.exportTimeoutMillis).toBe(Number(OTLP_EXPORT_TIMEOUT_MS));
  });

  it.each(REQUIRED_ENV)(
    "is handed to both dev servers as %s, from %s",
    (variable, constantName) => {
      const config = source("playwright.config.ts");
      const assignments = config.split(`${variable}: ${constantName},`).length - 1;

      expect(assignments).toBe(2);
    },
  );

  it.each(REQUIRED_ENV)(
    "is handed to the composed API as %s, from %s",
    (variable, constantName) => {
      expect(source("apps/portal/e2e/support/api-process-entry.ts")).toContain(
        `${variable}: ${constantName},`,
      );
    },
  );
});

describe("OTLP_DELIVERY_BUDGET_MS", () => {
  it("is the batch delay twice, plus one export attempt, plus an ingest margin", () => {
    const delay = Number(OTLP_SCHEDULE_DELAY_MS);
    const exportTimeout = Number(OTLP_EXPORT_TIMEOUT_MS);

    expect(OTLP_DELIVERY_BUDGET_MS).toBeGreaterThan(2 * delay + exportTimeout);
    expect(OTLP_DELIVERY_BUDGET_MS).toBeLessThan(2 * delay + exportTimeout + 5_000);
  });

  it("leaves room for the flow that precedes it inside the spec timeout", () => {
    expect(OTLP_DELIVERY_BUDGET_MS).toBeLessThan(30_000);
  });

  it("is a whole number of poll intervals wide enough to poll more than once", () => {
    expect(OTLP_DELIVERY_BUDGET_MS / OTLP_POLL_MS).toBeGreaterThan(10);
  });
});

describe("otlpDeliveryNote", () => {
  it("prints the elapsed time, the budget, and the configuration that set it", () => {
    const note = otlpDeliveryNote(12_507);

    expect(note).toContain("12507ms");
    expect(note).toContain(`${String(OTLP_DELIVERY_BUDGET_MS)}ms budget`);
    expect(note).toContain(`${OTLP_SCHEDULE_DELAY_MS}ms batch delay`);
    expect(note).toContain(`${OTLP_EXPORT_TIMEOUT_MS}ms export timeout`);
  });
});
