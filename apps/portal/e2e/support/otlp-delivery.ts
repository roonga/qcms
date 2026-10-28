import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { OTLP_DELIVERY_BUDGET_MS, OTLP_DELIVERY_PATH } from "./harness-config.js";

/** Start a fresh delivery record for this run window. Called once, from globalSetup. */
export function startOtlpDeliveryRecord(): void {
  mkdirSync(dirname(OTLP_DELIVERY_PATH), { recursive: true });
  writeFileSync(OTLP_DELIVERY_PATH, "", "utf8");
}

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
  appendFileSync(OTLP_DELIVERY_PATH, line, "utf8");
}
