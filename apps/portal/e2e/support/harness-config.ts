import { fileURLToPath } from "node:url";

import { PORT_SEAT, harnessPort } from "./port-seat.js";

/** The port the composed API listens on (in the globalSetup process). */
export const API_PORT = harnessPort("api", PORT_SEAT);

/** The base URL the portal BFF calls (server-only `QCMS_API_BASE_URL`). */
export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/** The port the portal dev server listens on. */
export const PORTAL_PORT = harnessPort("portal", PORT_SEAT);

export const OTLP_PORT = harnessPort("otlp", PORT_SEAT);

/** What both traced processes get as `OTEL_EXPORTER_OTLP_ENDPOINT`. */
export const OTLP_ENDPOINT = `http://127.0.0.1:${OTLP_PORT}`;

/** Service names the traced e2e run reports, so a span's origin is unambiguous. */
export const OTEL_SERVICE_NAMES = {
  api: "qcms-api-e2e",
  portal: "qcms-portal-e2e",
  admin: "qcms-admin-e2e",
} as const;

export const OTLP_SCHEDULE_DELAY_MS = "500";

export const OTLP_EXPORT_TIMEOUT_MS = "10000";

const OTLP_INGEST_MARGIN_MS = 1_500;

/** How often a spec re-reads the capture file while waiting for exported telemetry. */
export const OTLP_POLL_MS = 250;

export const OTLP_DELIVERY_BUDGET_MS =
  2 * Number(OTLP_SCHEDULE_DELAY_MS) + Number(OTLP_EXPORT_TIMEOUT_MS) + OTLP_INGEST_MARGIN_MS;

export function otlpDeliveryNote(elapsedMs: number): string {
  return (
    `waited ${String(elapsedMs)}ms of a ${String(OTLP_DELIVERY_BUDGET_MS)}ms budget ` +
    `(2 x ${OTLP_SCHEDULE_DELAY_MS}ms batch delay + ${OTLP_EXPORT_TIMEOUT_MS}ms export ` +
    `timeout + ${String(OTLP_INGEST_MARGIN_MS)}ms ingest margin)`
  );
}

/** Synthetic shared SEC-4 internal token (test-only, not a real secret). */
export const FIXED_INTERNAL_TOKEN = "qcms-e2e-portal-shared-internal-token-000000";

export const FIXED_APP_KEY = "qcms-e2e-synthetic-app-key-0000000000000000";

export const HARNESS_THEME = "harbor";
export const HARNESS_CORNERS = "rounded";

export const HARNESS_FONT = "inter";
export const HARNESS_FONTS = "atkinson, inter, merriweather, jetbrainsmono";

export const HARNESS_BRAND_NAME = "Northwind Rowing Club";
export const HARNESS_BRAND_LOGO =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIg" +
  "aGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaW" +
  "xsPSIjM2Y2ZjhmIi8+PC9zdmc+";

/** Absolute path of the fixtures the specs read (written by globalSetup). */
export const FIXTURES_PATH = fileURLToPath(
  new URL("../../.playwright/fixtures.json", import.meta.url),
);

export const SERVER_LOG_DIR = fileURLToPath(
  new URL("../../.playwright/server-logs/", import.meta.url),
);

/** The three captured server-log files (API, Postgres, portal server). */
export const SERVER_LOG_FILES = {
  api: `${SERVER_LOG_DIR}api.log`,
  postgres: `${SERVER_LOG_DIR}postgres.log`,
  portal: `${SERVER_LOG_DIR}portal.log`,
} as const;

export const OTLP_CAPTURE_PATH = fileURLToPath(
  new URL("../../.playwright/otlp/spans.jsonl", import.meta.url),
);

export const OTLP_DELIVERY_PATH = fileURLToPath(
  new URL("../../.playwright/otlp/delivery.txt", import.meta.url),
);

export const FONT_FLOORS_PATH = fileURLToPath(
  new URL("../../.playwright/font-floors.txt", import.meta.url),
);

export const APPEARANCE_METRICS_PATH = fileURLToPath(
  new URL("../../.playwright/appearance-target-sizes.txt", import.meta.url),
);

export const APPEARANCE_FLOORS_PATH = fileURLToPath(
  new URL("../../.playwright/appearance-floors.txt", import.meta.url),
);
