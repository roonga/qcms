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
 *    the shared server logger. Three artefacts, one id, no call-site plumbing.
 * 4. **SEC-13 holds.** A known submitted answer value appears nowhere in the
 *    captured payloads or in either server log, and the secure-link token in
 *    `/l/<token>` is exported as `/l/[token]` - redacted, not merely absent.
 */

import { readFileSync } from "node:fs";

import { readFixtures } from "./support/fixtures.js";
import { test, expect } from "./support/gates.js";
import {
  OTEL_SERVICE_NAMES,
  OTLP_DELIVERY_BUDGET_MS,
  OTLP_POLL_MS,
  SERVER_LOG_FILES,
  otlpDeliveryNote,
} from "./support/harness-config.js";
import { recordOtlpDelivery } from "./support/otlp-delivery.js";
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
  readCapturedLogs,
  readCapturedPayloads,
  readCapturedSpans,
  type CapturedLog,
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

/**
 * Batch export plus receiver write: poll rather than sleep a fixed amount, on the
 * budget the exporters' own configuration implies (issue #901). This was a literal
 * 20s, the twin of the one `apps/admin/e2e/otel-logs.pw.ts` failed on twice in a week;
 * `OTLP_DELIVERY_BUDGET_MS` moves with the batch delay and export timeout the harness
 * sets, so the two specs cannot drift apart from the pipeline or from each other.
 */
const SPAN_WAIT_MS = OTLP_DELIVERY_BUDGET_MS;
const POLL_MS = OTLP_POLL_MS;

/** What one bounded wait for exported telemetry observed. */
interface Waited<T> {
  /** Everything captured by the end of the wait, satisfied or not. */
  readonly captured: readonly T[];
  /**
   * The sentence an assertion adds when what it wanted is not in `captured`: what was
   * waited for, how long it took, and the configuration that set the budget. Without
   * it a slow pipeline and a broken correlation both read as a missing record, which
   * is the mis-attribution issue #901 was filed about.
   */
  readonly note: string;
}

/**
 * Poll until `ready`, then return what was captured with the measurement beside it.
 *
 * Each wait records its own latency, so a green run leaves the trip's real cost in
 * `OTLP_DELIVERY_PATH` rather than only proving it fitted inside a budget.
 */
async function waitFor<T>(
  what: string,
  read: () => T[],
  ready: (captured: T[]) => boolean,
): Promise<Waited<T>> {
  const started = Date.now();
  const deadline = started + SPAN_WAIT_MS;
  let captured = read();
  while (!ready(captured) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    captured = read();
  }
  const elapsedMs = Date.now() - started;
  const satisfied = ready(captured);
  recordOtlpDelivery(what, elapsedMs, { arrived: satisfied ? elapsedMs : -1 });
  return { captured, note: `${what}: ${otlpDeliveryNote(elapsedMs)}` };
}

/** Wait until the captured spans satisfy `ready`, then return them. */
async function waitForSpans(
  what: string,
  ready: (spans: CapturedSpan[]) => boolean,
): Promise<Waited<CapturedSpan>> {
  return waitFor(what, readCapturedSpans, ready);
}

async function waitForLogs(
  what: string,
  ready: (logs: CapturedLog[]) => boolean,
): Promise<Waited<CapturedLog>> {
  return waitFor(what, readCapturedLogs, ready);
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

  const { captured: spans, note: submitSpanNote } = await waitForSpans(
    "the API's submit SERVER span",
    (all) => all.some(isSubmitServerSpan),
  );
  expect(
    spans.filter(isSubmitServerSpan),
    `the API should export one semantic SERVER span, not a duplicate raw HTTP span; ${submitSpanNote}`,
  ).toHaveLength(1);
  const apiServerSpan = spans.find(isSubmitServerSpan);
  expect(
    apiServerSpan,
    `the API should have exported a SERVER span for the submit carrying this request id; ${submitSpanNote}`,
  ).toBeDefined();
  const traceId = apiServerSpan?.traceId ?? "";
  expect(traceId, `the exported API span should carry a trace id; ${submitSpanNote}`).toMatch(
    /^[0-9a-f]{32}$/,
  );

  // The portal's own spans must be in the SAME trace: that is `traceparent`
  // crossing the BFF hop and `@hono/otel` extracting it.
  const { captured: trace, note: traceNote } = await waitForSpans(
    "the portal's spans in the API's trace",
    (all) =>
      all.some(
        (span) => span.traceId === traceId && span.serviceName === OTEL_SERVICE_NAMES.portal,
      ),
  );
  const inTrace = trace.filter((span) => span.traceId === traceId);
  const portalSpans = inTrace.filter((span) => span.serviceName === OTEL_SERVICE_NAMES.portal);
  expect(
    portalSpans.length,
    `portal spans must share the API span's trace id (traceparent over the BFF hop); ${traceNote}`,
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
  // The shared logger put these there; no call site mentions trace_id.
  expect(correlated.some((line) => line.trace_id === traceId)).toBe(true);
  expect(correlated.every((line) => typeof line.span_id === "string")).toBe(true);

  const { captured: logRecords, note: logNote } = await waitForLogs(
    "both services' log records in that trace",
    (records) => {
      const services = new Set(
        records
          .filter(
            (record) => record.traceId === traceId && record.attributes.requestId === requestId,
          )
          .map((record) => record.serviceName),
      );
      return services.has(OTEL_SERVICE_NAMES.portal) && services.has(OTEL_SERVICE_NAMES.api);
    },
  );
  const exportedLogs = logRecords.filter((record) => record.traceId === traceId);
  expect(
    exportedLogs.some(
      (record) =>
        record.serviceName === OTEL_SERVICE_NAMES.portal &&
        record.attributes.requestId === requestId,
    ),
    `the Portal should export a safe log in the connected trace; ${logNote}`,
  ).toBe(true);
  expect(
    exportedLogs.some(
      (record) =>
        record.serviceName === OTEL_SERVICE_NAMES.api && record.attributes.requestId === requestId,
    ),
    `the API should export a safe log in the connected trace; ${logNote}`,
  ).toBe(true);

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

  const { captured: spans, note: linkSpanNote } = await waitForSpans(
    "the portal's redacted link-route span",
    (all) =>
      all.some(
        (span) =>
          span.serviceName === OTEL_SERVICE_NAMES.portal && span.name.includes("/l/[token]"),
      ),
  );
  const redacted = spans.filter(
    (span) => span.serviceName === OTEL_SERVICE_NAMES.portal && span.name.includes("/l/[token]"),
  );
  expect(
    redacted.length,
    `the portal should export the link route with its token replaced by the pattern; ${linkSpanNote}`,
  ).toBeGreaterThan(0);
  expect(readCapturedPayloads()).not.toContain(invalidToken);
});
