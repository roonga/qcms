/**
 * The tracing baseline, proved end to end (task 054, ADR-34; exit criteria 1, 3
 * and 4).
 *
 * This is the spec the whole task rests on, and it asserts against **real exported
 * OTLP payloads**: `globalSetup` boots a 40-line in-test OTLP receiver
 * (`support/otlp-receiver.ts`), starts the API-side `NodeSDK`, and the portal dev
 * server runs with `OTEL_EXPORTER_OTLP_ENDPOINT` pointed at the same receiver. No
 * collector, no viewer, no hand-built spans.
 *
 * What it proves, in the order the criteria are numbered:
 *
 * 1. **One respondent submit is one trace.** The portal's server span and the
 *    API's `SpanKind.SERVER` span share a trace id - which can only happen if the
 *    BFF's fetch carried `traceparent` (`propagateContextUrls` in
 *    `instrumentation.ts`) and `@hono/otel` extracted it - and the `pg` spans hang
 *    under the API span in that same trace.
 * 3. **The `x-request-id` bridge.** The id the portal echoes to the browser is the
 *    id the API recorded on its span (`qcms.request_id`) and the id in the API's
 *    log line, and that log line also carries `trace_id`/`span_id` from
 *    `instrumentation-pino`. Three artefacts, one id, no call-site plumbing.
 * 4. **SEC-13 holds.** A known submitted answer value appears nowhere in the
 *    captured payloads or in either server log, and the secure-link token in
 *    `/l/<token>` is exported as `/l/[token]` - redacted, not merely absent.
 */

import { readFileSync } from "node:fs";

import { readFixtures } from "./support/fixtures.js";
import { test, expect } from "./support/gates.js";
import { OTEL_SERVICE_NAMES, SERVER_LOG_FILES } from "./support/harness-config.js";
import {
  KS,
  checkOption,
  chooseRadio,
  chooseSingleChoice,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";
import {
  readCapturedPayloads,
  readCapturedSpans,
  type CapturedSpan,
} from "./support/otlp-receiver.js";

/**
 * The answer value this spec submits and then hunts for. Deliberately unlike any
 * fixture label, id or route so that finding it anywhere in the telemetry is
 * unambiguous evidence of a leak rather than a coincidence - and deliberately a
 * VALID `q_full_name` (the kitchen-sink fixture constrains it to
 * `^[A-Za-z][A-Za-z .,'-]{0,99}$`), because the point is to submit a real answer,
 * not to provoke a rejection.
 */
const ANSWER_CANARY = "Zzcanaryqx Redactowski";

/** Batch export plus receiver write: poll rather than sleep a fixed amount. */
const SPAN_WAIT_MS = 20_000;
const POLL_MS = 250;

/** Wait until the captured spans satisfy `ready`, then return them. */
async function waitForSpans(ready: (spans: CapturedSpan[]) => boolean): Promise<CapturedSpan[]> {
  const deadline = Date.now() + SPAN_WAIT_MS;
  let spans = readCapturedSpans();
  while (!ready(spans) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    spans = readCapturedSpans();
  }
  return spans;
}

/** OTLP span kinds, as they appear on the wire. */
const SPAN_KIND_SERVER = 2;

/** True when any string attribute of the span contains `needle`. */
function mentions(span: CapturedSpan, needle: string): boolean {
  return Object.values(span.attributes).some(
    (value) => typeof value === "string" && value.includes(needle),
  );
}

test("a respondent submit produces one connected trace, correlated logs, and no answer content", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();

  await startKitchenSink(page, kitchenSinkSlug);

  // Step 1: the canary rides in as a real answer value, through the real form.
  await fillText(page, KS.fullName, ANSWER_CANARY);
  await enterDate(page, "05171990");
  await continueStep(page);

  // Step 2: "No" leaves the accident-count follow-up hidden, so this is the
  // shortest complete walk of the kitchen-sink form.
  await chooseRadio(page, "No");
  await checkOption(page, "Breakdown");
  await continueStep(page);

  // Step 3: choose cover, then submit and keep the BFF's response headers.
  await chooseSingleChoice(page, "Standard");
  const submitted = page.waitForResponse(
    (response) => response.url().includes("/submit") && response.request().method() === "POST",
  );
  await page.getByTestId("primary-action").click();
  const submitResponse = await submitted;
  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/);

  // The id the respondent could quote: minted by the portal proxy, echoed here.
  const requestId = submitResponse.headers()["x-request-id"];
  expect(requestId, "the portal must echo x-request-id").toBeTruthy();

  // --- Exit criterion 1: one connected trace ---------------------------------
  const isSubmitServerSpan = (span: CapturedSpan): boolean =>
    span.serviceName === OTEL_SERVICE_NAMES.api &&
    span.kind === SPAN_KIND_SERVER &&
    span.attributes["qcms.request_id"] === requestId &&
    mentions(span, "/submit");

  const spans = await waitForSpans((all) => all.some(isSubmitServerSpan));
  const apiServerSpan = spans.find(isSubmitServerSpan);
  expect(
    apiServerSpan,
    "the API should have exported a SERVER span for the submit carrying this request id",
  ).toBeDefined();
  const traceId = apiServerSpan?.traceId ?? "";
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);

  // The portal's own spans must be in the SAME trace: that is `traceparent`
  // crossing the BFF hop and `@hono/otel` extracting it.
  const trace = await waitForSpans((all) =>
    all.some((span) => span.traceId === traceId && span.serviceName === OTEL_SERVICE_NAMES.portal),
  );
  const inTrace = trace.filter((span) => span.traceId === traceId);
  const portalSpans = inTrace.filter((span) => span.serviceName === OTEL_SERVICE_NAMES.portal);
  expect(
    portalSpans.length,
    "portal spans must share the API span's trace id (traceparent over the BFF hop)",
  ).toBeGreaterThan(0);

  // The pg spans belong to the API's side of that trace, under an API span.
  const apiSpanIds = new Set(
    inTrace
      .filter((span) => span.serviceName === OTEL_SERVICE_NAMES.api)
      .map((span) => span.spanId),
  );
  const pgSpans = inTrace.filter(
    (span) =>
      span.attributes["db.system.name"] !== undefined || span.attributes["db.system"] !== undefined,
  );
  expect(pgSpans.length, "the submit must have produced database spans").toBeGreaterThan(0);
  expect(
    pgSpans.every((span) => apiSpanIds.has(span.parentSpanId)),
    "every pg span should hang under an API span in the same trace",
  ).toBe(true);

  // --- Exit criterion 3: x-request-id + trace-correlated API logs ------------
  const apiLog = readFileSync(SERVER_LOG_FILES.api, "utf8");
  const correlated = apiLog
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter((line) => line.requestId === requestId);

  expect(
    correlated.length,
    "the API should have logged the request id the portal forwarded",
  ).toBeGreaterThan(0);
  // `instrumentation-pino` put these there; no call site mentions trace_id.
  expect(correlated.some((line) => line.trace_id === traceId)).toBe(true);
  expect(correlated.every((line) => typeof line.span_id === "string")).toBe(true);

  // --- Exit criterion 4: SEC-13 --------------------------------------------
  const payloads = readCapturedPayloads();
  expect(payloads.length, "the receiver should have captured payloads").toBeGreaterThan(0);
  expect(payloads).not.toContain(ANSWER_CANARY);
  expect(readFileSync(SERVER_LOG_FILES.api, "utf8")).not.toContain(ANSWER_CANARY);
  expect(readFileSync(SERVER_LOG_FILES.portal, "utf8")).not.toContain(ANSWER_CANARY);
});

test("a secure-link token is redacted out of the exported span, not just absent", async ({
  page,
}) => {
  const { invalidToken } = readFixtures();

  // The token is a PATH segment here, so Next names its root span from it
  // (`GET /l/<token>`) - the one place either app has to rewrite a span name.
  // An invalid token is used deliberately: it exercises the same route without
  // consuming a fixture link.
  await page.goto(`/l/${invalidToken}`);
  await page.waitForURL(/\/link-error/);

  const spans = await waitForSpans((all) =>
    all.some(
      (span) => span.serviceName === OTEL_SERVICE_NAMES.portal && span.name.includes("/l/[token]"),
    ),
  );
  const redacted = spans.filter(
    (span) => span.serviceName === OTEL_SERVICE_NAMES.portal && span.name.includes("/l/[token]"),
  );
  expect(
    redacted.length,
    "the portal should export the link route with its token replaced by the pattern",
  ).toBeGreaterThan(0);
  expect(readCapturedPayloads()).not.toContain(invalidToken);
});
