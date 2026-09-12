/**
 * The delivery latency a telemetry spec measured, written where a green run leaves it
 * behind (issue #901).
 *
 * Two sightings of `otel-logs.pw.ts` failing on export latency were argued from a
 * timeout: the poll expired, so the record was reported missing, and nobody could say
 * whether delivery normally took 300ms or 19s because no run had ever recorded it. The
 * budget is derived now (`OTLP_DELIVERY_BUDGET_MS`), and this is the other half of that:
 * every run of a telemetry spec appends what the trip actually cost, so the next
 * sighting starts from a distribution rather than from a guess.
 *
 * Test support only, and append-only within a run: `startOtlpReceiver` truncates the
 * capture file at the start of a run window, and this file is truncated by the first
 * writer of each run for the same reason. One Playwright worker runs the whole suite
 * (`workers: 1`), so no two specs interleave here.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { OTLP_DELIVERY_BUDGET_MS, OTLP_DELIVERY_PATH } from "./harness-config.js";

/** True once this process has claimed the file for the current run. */
let truncated = false;

/**
 * Append one measurement.
 *
 * @param what  The artefacts waited for, as a reader of the file would name them.
 * @param elapsedMs  From the request completing to the last artefact being readable.
 * @param legs  Per-artefact first-seen offsets in ms, or a negative value for one that
 *   never arrived, so a slow leg can be told from a slow pipeline.
 */
export function recordOtlpDelivery(
  what: string,
  elapsedMs: number,
  legs: Readonly<Record<string, number>>,
): void {
  const detail = Object.entries(legs)
    .map(([leg, millis]) => {
      const arrival = millis < 0 ? "never" : `${String(millis)}ms`;
      return `${leg}=${arrival}`;
    })
    .join(" ");
  const line =
    `${new Date().toISOString()} ${what}: elapsed=${String(elapsedMs)}ms ` +
    `budget=${String(OTLP_DELIVERY_BUDGET_MS)}ms ${detail}\n`;
  mkdirSync(dirname(OTLP_DELIVERY_PATH), { recursive: true });
  if (truncated) {
    appendFileSync(OTLP_DELIVERY_PATH, line, "utf8");
    return;
  }
  writeFileSync(OTLP_DELIVERY_PATH, line, "utf8");
  truncated = true;
}
