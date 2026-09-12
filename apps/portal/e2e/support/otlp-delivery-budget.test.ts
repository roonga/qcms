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

/**
 * The telemetry delivery budget, and the wiring it is derived from (issue #901).
 *
 * The defect these cases exist to keep closed was a silent one. `OTEL_BSP_SCHEDULE_DELAY`
 * was set in the browser harness from task 054 onward and reached no processor, because
 * OpenTelemetry JS 2.x reads the batch variables only in the compatibility shims these
 * apps do not construct. Every telemetry spec therefore waited on the library defaults
 * while its comments claimed 500ms, and `otel-logs.pw.ts` failed twice in one week on a
 * 20s poll that was never related to the pipeline it was polling.
 *
 * Nothing about that was observable from a passing suite, so the assertions below pin
 * the two links a green run cannot vouch for:
 *
 *  1. **The value survives the resolver.** A harness constant is a string in an
 *     environment record, and `@roonga/qcms-observability/otel` parses strictly, so
 *     "500" reaching a processor as 500 is a claim worth checking rather than assuming.
 *  2. **Every service is handed all four.** The span pair alone was the original defect;
 *     a future edit that adds a webServer entry, or drops a line from one of the two
 *     that exist, puts a service back on the library defaults with no other symptom.
 *
 * Read as source rather than imported, deliberately: `playwright.config.ts` runs the
 * seat preflight at load, which binds sockets and can refuse outright, and
 * `api-process-entry.ts` starts an SDK and an API server. Neither is importable from a
 * unit test, and what is being checked here is what the file says.
 */

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

    // Not the library default, which is the whole point: a value that failed to parse
    // would silently come back as 5000, 1000 or 30000 and look like a configuration.
    expect(timings.scheduledDelayMillis).toBe(Number(OTLP_SCHEDULE_DELAY_MS));
    expect(timings.exportTimeoutMillis).toBe(Number(OTLP_EXPORT_TIMEOUT_MS));
  });

  it.each(REQUIRED_ENV)(
    "is handed to both dev servers as %s, from %s",
    (variable, constantName) => {
      const config = source("playwright.config.ts");
      const assignments = config.split(`${variable}: ${constantName},`).length - 1;

      // Two webServer entries, so exactly two assignments: the portal and the admin.
      // The admin is the service `otel-logs.pw.ts` hunts a log record from and the
      // portal is the one `otel-trace.pw.ts` does, and both share this run's API.
      expect(assignments).toBe(2);
    },
  );

  it.each(REQUIRED_ENV)(
    "is handed to the composed API as %s, from %s",
    (variable, constantName) => {
      // In the env RECORD the API reads, not `process.env`: `startTelemetry` takes an
      // explicit environment so this in-process API need not mutate the ambient one.
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

    // The formula, asserted as a relation rather than as the number it currently
    // produces, so retuning either constant moves the budget instead of failing here.
    expect(OTLP_DELIVERY_BUDGET_MS).toBeGreaterThan(2 * delay + exportTimeout);
    expect(OTLP_DELIVERY_BUDGET_MS).toBeLessThan(2 * delay + exportTimeout + 5_000);
  });

  it("leaves room for the flow that precedes it inside the spec timeout", () => {
    // `playwright.config.ts` gives every test 60s, and the admin spec spends most of
    // that signing in and enrolling a TOTP factor before it waits for telemetry at all.
    // A budget that could outlast the test would surface as an undiagnosable Playwright
    // timeout instead of the message this budget exists to print.
    expect(OTLP_DELIVERY_BUDGET_MS).toBeLessThan(30_000);
  });

  it("is a whole number of poll intervals wide enough to poll more than once", () => {
    expect(OTLP_DELIVERY_BUDGET_MS / OTLP_POLL_MS).toBeGreaterThan(10);
  });
});

describe("otlpDeliveryNote", () => {
  it("prints the elapsed time, the budget, and the configuration that set it", () => {
    const note = otlpDeliveryNote(12_507);

    // The diagnosis the two #901 sightings did not have: a failure has to say how long
    // it waited and what it was waiting on, so a slow pipeline reads differently from a
    // record that never arrived.
    expect(note).toContain("12507ms");
    expect(note).toContain(`${String(OTLP_DELIVERY_BUDGET_MS)}ms budget`);
    expect(note).toContain(`${OTLP_SCHEDULE_DELAY_MS}ms batch delay`);
    expect(note).toContain(`${OTLP_EXPORT_TIMEOUT_MS}ms export timeout`);
  });
});
