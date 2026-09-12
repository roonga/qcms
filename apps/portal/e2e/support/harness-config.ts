/**
 * Shared constants for the portal Playwright harness (task 029).
 *
 * `playwright.config.ts` (the webServer env) and `api-server.ts` (the composed
 * API) both import from here so the SEC-4 internal token is *identical* on both
 * sides of the wire. Since task 031 the admin app's harness reads {@link FIXTURES_PATH}
 * and the token from here too, for the same reason: one database, one API, two
 * frontends, so one set of constants. The separately-spawned portal dev server presents
 * this token to the in-process composed API, which was built to accept exactly it.
 *
 * The token is a synthetic, test-only value (never a real credential): it exists
 * only to let the two processes authenticate to each other. It is >= the config
 * `MIN_SECRET_LENGTH` (32) and contains no whitespace or comma (the key-list
 * parser splits on those).
 */

import { fileURLToPath } from "node:url";

import { PORT_SEAT, harnessPort } from "./port-seat.js";

/**
 * Every port below is derived from the run's **seat** (`QCMS_PORT_SEAT`, default 0),
 * never written as a literal. Stable human-facing services take the 4-digit `7Sxx`
 * block; an ephemeral test harness like this one takes the 5-digit `17Sxx` block.
 * The authoritative table and the reasoning are in **`docs/PORTS.md`**; the
 * arithmetic is in `scripts/ports.mjs` and the startup refusals in `./port-seat.ts`.
 */

/** The port the composed API listens on (in the globalSetup process). */
export const API_PORT = harnessPort("api", PORT_SEAT);

/** The base URL the portal BFF calls (server-only `QCMS_API_BASE_URL`). */
export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/** The port the portal dev server listens on. */
export const PORTAL_PORT = harnessPort("portal", PORT_SEAT);

/**
 * The in-test OTLP receiver's port and base endpoint (task 054).
 *
 * Deliberately NOT 4318 (the OTLP/HTTP default): a developer running the documented
 * local trace viewer holds that port, and the suite must neither silently export
 * into it nor fail to bind because it is taken. The seat scheme now satisfies that
 * intent by construction rather than by a chosen constant: every seat's receiver sits
 * inside `17Sxx`, and 4318 is outside the repo's whole allocation entirely.
 */
export const OTLP_PORT = harnessPort("otlp", PORT_SEAT);

/** What both traced processes get as `OTEL_EXPORTER_OTLP_ENDPOINT`. */
export const OTLP_ENDPOINT = `http://127.0.0.1:${OTLP_PORT}`;

/** Service names the traced e2e run reports, so a span's origin is unambiguous. */
export const OTEL_SERVICE_NAMES = {
  api: "qcms-api-e2e",
  portal: "qcms-portal-e2e",
  admin: "qcms-admin-e2e",
} as const;

/**
 * How long the batch processors wait before exporting, for BOTH pipelines
 * (`OTEL_BSP_SCHEDULE_DELAY` for spans, `OTEL_BLRP_SCHEDULE_DELAY` for log records).
 * The SDK defaults are 5s and 1s, which a telemetry spec would spend waiting on every
 * run; 500ms keeps both prompt without exporting per record.
 *
 * **Both names are now passed, and the reason is issue #901.** This constant existed
 * from task 054 but only ever reached `OTEL_BSP_SCHEDULE_DELAY`, and in OpenTelemetry
 * JS 2.x that variable reaches no processor this repository constructs: the env
 * fallbacks live in the `@opentelemetry/sdk-trace-base` compatibility shims, and
 * `@opentelemetry/sdk-logs` publishes no shim at all. So the whole suite ran on the
 * library defaults while its comments said 500ms, and the admin log spec's 20s poll had
 * a fifth of the margin it was written with. `@roonga/qcms-observability/otel` resolves
 * these variables explicitly now, and the services pass the result to their processors.
 */
export const OTLP_SCHEDULE_DELAY_MS = "500";

/**
 * How long ONE export attempt may run before the processor abandons that batch
 * (`OTEL_BSP_EXPORT_TIMEOUT`, `OTEL_BLRP_EXPORT_TIMEOUT`).
 *
 * Pinned here for the same reason the delay is, plus one of its own: it is the term
 * that dominates {@link OTLP_DELIVERY_BUDGET_MS}, and the SDK default of 30s is longer
 * than the whole spec timeout, so a budget derived from it could not be waited for. The
 * receiver is 40 lines of `node:http` on loopback in the runner process, where an export
 * of a few kilobytes completes in single-digit milliseconds, so 10s is already three
 * orders of magnitude of headroom. Production keeps the 30s default.
 */
export const OTLP_EXPORT_TIMEOUT_MS = "10000";

/**
 * Receiver ingest plus poll granularity: the part of the trip that is neither a batch
 * delay nor an export attempt. The receiver appends the body to a JSONL file and a spec
 * re-reads that file every {@link OTLP_POLL_MS}, so a record can be in the file for one
 * poll interval before any assertion sees it.
 */
const OTLP_INGEST_MARGIN_MS = 1_500;

/** How often a spec re-reads the capture file while waiting for exported telemetry. */
export const OTLP_POLL_MS = 250;

/**
 * How long a spec may wait for exported telemetry to reach the receiver before failing
 * (issue #901).
 *
 * **Derived, never a literal.** Two specs used to poll a flat 20s for a record whose
 * pipeline they could have asked, and the number bore no relation to the configuration:
 * with the values above unset, one missed batch cycle plus one export attempt running
 * to its own ceiling is 35s for the span pipeline, so the poll could expire while the
 * SDK was still doing exactly what it was configured to do. The spec then failed on
 * delivery latency and reported it as a missing record, which is the same
 * mis-attribution issue #604 is about, on a network hop rather than a container boot.
 *
 * The terms are the trip a record actually makes: a full batch delay (a record that
 * arrives just after a flush cycle starts waits the whole next one), plus a second delay
 * for the second pipeline the admin spec needs (the API's span and the two services' log
 * records travel independently), plus one export attempt at its configured ceiling, plus
 * the ingest margin above. With the values in this file that is 12.5s.
 *
 * Measured against it on the branch that introduced it, from the moment the request
 * completed to the moment both correlated log records were readable: 1.1s, 1.6s, 2.5s,
 * 3.4s and 4.0s BEFORE the delay reached the processors, at host loads from idle to 95
 * on 24 cores, and consistently under a second after. The budget is therefore roughly
 * ten times the observed worst case rather than five, and it moves with the
 * configuration instead of being re-guessed.
 */
export const OTLP_DELIVERY_BUDGET_MS =
  2 * Number(OTLP_SCHEDULE_DELAY_MS) + Number(OTLP_EXPORT_TIMEOUT_MS) + OTLP_INGEST_MARGIN_MS;

/**
 * The sentence a telemetry spec fails with, so the next sighting is diagnosable from
 * the failure alone (issue #901).
 *
 * A poll that expires prints what it waited for, what the pipeline was configured to
 * do, and how long it actually took. That is what separates a slow pipeline from a real
 * regression: a missing record reads as "elapsed 12507ms of 12500ms" against a 500ms
 * delay, and a genuinely broken correlation reads as an immediate failure with the
 * elapsed time near zero.
 */
export function otlpDeliveryNote(elapsedMs: number): string {
  return (
    `waited ${String(elapsedMs)}ms of a ${String(OTLP_DELIVERY_BUDGET_MS)}ms budget ` +
    `(2 x ${OTLP_SCHEDULE_DELAY_MS}ms batch delay + ${OTLP_EXPORT_TIMEOUT_MS}ms export ` +
    `timeout + ${String(OTLP_INGEST_MARGIN_MS)}ms ingest margin)`
  );
}

/** Synthetic shared SEC-4 internal token (test-only, not a real secret). */
export const FIXED_INTERNAL_TOKEN = "qcms-e2e-portal-shared-internal-token-000000";

/**
 * Synthetic `QCMS_APP_KEY` for the suite (test-only, never a real key).
 *
 * Fixed rather than generated, for the same reason `FIXED_AUTH_SECRET` is: two
 * processes in this run have to agree on it. `validEnv()` mints a fresh key on every
 * call, and the app key is what a webhook secret is encrypted under at rest (SEC-6) -
 * so a spec that composes its own `Deps` to drive a delivery pass would decrypt a
 * secret the API wrote under a different key, and every delivery would fail with
 * `secret_decrypt_failed` rather than reaching the receiver (task 035).
 *
 * 32+ characters, which is what `QCMS_APP_KEY` requires.
 */
export const FIXED_APP_KEY = "qcms-e2e-synthetic-app-key-0000000000000000";

/**
 * Per-deployment theming config the harness runs the portal under (task 051).
 *
 * Deliberately NOT the defaults: the whole browser suite runs on an ALTERNATE
 * theme and an alternate corner preset, so `QCMS_PORTAL_THEME` /
 * `QCMS_PORTAL_CORNERS` are proven end to end (config -> `<html>` -> computed
 * style) rather than only where the shipped defaults would have matched anyway.
 * The default resolution and the typo fallback are covered by
 * `lib/server/theme.test.ts`.
 */
export const HARNESS_THEME = "harbor";
export const HARNESS_CORNERS = "rounded";

/**
 * Per-deployment FONT config the harness runs the portal under (task 052).
 *
 * Same reasoning as the theme above: the whole browser suite runs on a curated
 * subset with a non-default default font, so `QCMS_PORTAL_FONT` /
 * `QCMS_PORTAL_FONTS` are proven end to end (config -> `<html class>` -> the
 * computed `font-family` -> a real same-origin `woff2` request) rather than only
 * where the shipped System default would have matched anyway. It also means every
 * other spec in the suite runs on a self-hosted webfont, so a font that failed to
 * load would show up as collateral damage across the suite, not just here.
 *
 * `HARNESS_FONTS` deliberately omits most of the registry and deliberately omits
 * `system`, which `fontChoices()` must add back: that is the "System can never be
 * curated away" rule, observed through config rather than asserted in a unit test.
 */
export const HARNESS_FONT = "inter";
export const HARNESS_FONTS = "atkinson, inter, merriweather, jetbrainsmono";

/**
 * Per-deployment BRAND config the harness runs the portal under (task 053, issue
 * #25).
 *
 * Non-default for the same reason the theme and font are: the header brand mark and
 * the document title are proven to come from config, end to end, rather than only
 * where a shipped default would have matched anyway. It is also the standing check
 * that no `QCMS` literal came back into the shell - if one did, the whole suite
 * would still show this string in the header and the assertion in
 * `appearance.pw.ts` would be the only thing that noticed.
 *
 * The logo is a base64 `data:` image rather than a file, deliberately: it proves the
 * `<img>` renders and that the shipped CSP (`img-src 'self' data:`, SEC-9) permits
 * the value `portalBrand()` accepted, without committing a fixture asset or adding a
 * `public/` directory to the app for test-only reasons. A 24x24 rounded square.
 */
export const HARNESS_BRAND_NAME = "Northwind Rowing Club";
export const HARNESS_BRAND_LOGO =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIg" +
  "aGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaW" +
  "xsPSIjM2Y2ZjhmIi8+PC9zdmc+";

/*
 * Per-deployment DENSITY config: THERE IS NO `HARNESS_DENSITY`, and that is a decision
 * rather than the one knob nobody got round to (issue #196, option 3).
 *
 * Every constant above is deliberately non-default so that its config path is proven end to
 * end: theme, corners, font, font list, brand name and brand logo all reach a browser from
 * `QCMS_PORTAL_*` rather than from a shipped default that would have matched anyway.
 * `QCMS_PORTAL_DENSITY` is the one appearance knob that does not, and the asymmetry is
 * recorded here because this file is the list a reader consults to find out what the
 * harness proves.
 *
 * The reason is a genuine conflict between two things worth proving, not an oversight.
 * `theming.pw.ts` measures the Comfortable spacing values on rendered controls - a 44px
 * control height, 36px of card padding, an 8px field gap - and those numbers only mean
 * anything while the base level is what the server actually serves. Setting the harness to
 * Compact would invalidate a set of measurements that exist to prove the spacing group
 * reaches the vendored controls at all. The harness boots ONE shared portal through
 * `webServer`, so covering both would mean a second server or a per-test restart.
 *
 * What that leaves uncovered is narrower than "density is untested", and the difference
 * matters: the SAME server-side resolution is driven end to end through the density
 * **cookie** in `appearance.pw.ts`, which is the path a respondent actually takes, and
 * `lib/server/theme.test.ts` unit-tests the env var against every value plus the typo
 * fallback. The only path with no browser behind it is specifically "the env var, with no
 * cookie present", which is one `oneOf` call away from a path that has one.
 *
 * The two shapes that would close it are recorded so nobody re-derives them: a spec that
 * boots its own portal on an overridden env, or parameterising `theming.pw.ts` by the
 * served density so the harness could run Compact. The second couples that spec to the
 * resolver it is trying to measure independently, which is why neither was taken.
 */

/** Absolute path of the fixtures the specs read (written by globalSetup). */
export const FIXTURES_PATH = fileURLToPath(
  new URL("../../.playwright/fixtures.json", import.meta.url),
);

/**
 * Absolute directory the server-side logs are captured into for the run window
 * (task 045, exit criterion 5): the composed API's structured log, the Postgres
 * container's server log, and the portal dev-server's stdout/stderr. The log
 * gate scans these for any error/warn-level line.
 */
export const SERVER_LOG_DIR = fileURLToPath(
  new URL("../../.playwright/server-logs/", import.meta.url),
);

/** The three captured server-log files (API, Postgres, portal server). */
export const SERVER_LOG_FILES = {
  api: `${SERVER_LOG_DIR}api.log`,
  postgres: `${SERVER_LOG_DIR}postgres.log`,
  portal: `${SERVER_LOG_DIR}portal.log`,
} as const;

/**
 * Where the in-test OTLP receiver appends every exported payload, verbatim, one
 * JSON body per line (task 054). Written in the Playwright runner process by
 * `otlp-receiver.ts`; read by `otel-trace.pw.ts` in a worker process, which is why
 * it is a file rather than a module singleton.
 */
export const OTLP_CAPTURE_PATH = fileURLToPath(
  new URL("../../.playwright/otlp/spans.jsonl", import.meta.url),
);

/**
 * Where the telemetry specs append the delivery latency they measured (issue #901).
 *
 * Same reason the font and appearance metrics files exist: a claim with numbers in it
 * has to leave the numbers behind after a GREEN run. `OTLP_DELIVERY_BUDGET_MS` says
 * what the pipeline is allowed to take, and this file says what it took, run after run,
 * which is the evidence that would have made the two #901 sightings a measurement
 * rather than a guess. A red run prints the same numbers in its failure message.
 */
export const OTLP_DELIVERY_PATH = fileURLToPath(
  new URL("../../.playwright/otlp/delivery.txt", import.meta.url),
);

/**
 * Where `fonts.pw.ts` writes the per-font WCAG 1.4.12 measurements it takes
 * (task 052). The same table is attached to the Playwright report; the file exists
 * so a GREEN run leaves the numbers readable, since `docs/theming.md` states them.
 */
export const FONT_FLOORS_PATH = fileURLToPath(
  new URL("../../.playwright/font-floors.txt", import.meta.url),
);

/**
 * Where `appearance.pw.ts` writes the per-density WCAG 2.5.8 target-size
 * measurements (task 053), for the same reason as the file above: "every control
 * target clears 24px at Compact" is a claim with numbers in it, and the numbers have
 * to be readable after a green run.
 */
export const APPEARANCE_METRICS_PATH = fileURLToPath(
  new URL("../../.playwright/appearance-target-sizes.txt", import.meta.url),
);

/**
 * Where `appearance.pw.ts` writes the WCAG 1.4.12 floors measured at every density x
 * every registry font (task 053). `FONT_FLOORS_PATH` covers the font axis at the
 * default density; this covers the whole grid, which is what exit criterion 2 asks
 * for. An `attach()` alone is not enough: with the `list` reporter there is no HTML
 * report for an inline attachment to end up in, so a green run would leave no numbers
 * behind at all.
 */
export const APPEARANCE_FLOORS_PATH = fileURLToPath(
  new URL("../../.playwright/appearance-floors.txt", import.meta.url),
);
