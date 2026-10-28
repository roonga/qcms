import { readFileSync } from "node:fs";

import { readFixtures } from "./support/fixtures.js";
import { test, expect } from "./support/gates.js";
import { waitForHydration } from "./support/hydration.js";
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
  chooseFromSelect,
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

const ANSWER_CANARY = "Zzcanaryqx Redactowski";

const REPEAT_ANSWER_CANARY = "Zzrepeatqx Redactowski notes";

const INSTANCE_LABEL = "Vehicle 2";

const SPAN_WAIT_MS = OTLP_DELIVERY_BUDGET_MS;
const POLL_MS = OTLP_POLL_MS;

/** What one bounded wait for exported telemetry observed. */
interface Waited<T> {
  /** Everything captured by the end of the wait, satisfied or not. */
  readonly captured: readonly T[];
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

  await fillText(page, KS.fullName, ANSWER_CANARY);
  await enterDate(page, "05171990");
  await continueStep(page);

  await chooseRadio(page, "No");
  await checkOption(page, "Breakdown");
  await continueStep(page);

  await chooseSingleChoice(page, "Standard");
  await chooseFromSelect(page, "q_body_type", "Wagon");
  const submitted = page.waitForResponse(
    (response) => response.url().includes("/submit") && response.request().method() === "POST",
  );
  await page.getByTestId("primary-action").click();
  const submitResponse = await submitted;
  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/);

  const requestId = submitResponse.headers()["x-request-id"];
  expect(requestId, "the portal must echo x-request-id").toBeTruthy();

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

test("a repeating group exports its ins_ ids and no answer value or instance label", async ({
  page,
}) => {
  const { repeatFleetSlug } = readFixtures();

  await page.goto(`/f/${repeatFleetSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
  await waitForHydration(page);

  const card = (ordinal: number) => page.locator("fieldset[data-qcms-instance]").nth(ordinal - 1);
  const answered = (questionId: string): Promise<unknown> =>
    page.waitForResponse((response) => {
      if (response.request().method() !== "POST" || response.status() !== 200) return false;
      if (!/\/answers$/.test(new URL(response.url()).pathname)) return false;
      const body = response.request().postDataJSON() as { questionId?: unknown } | null;
      const posted = typeof body?.questionId === "string" ? body.questionId : "";
      return posted.endsWith(questionId);
    });

  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await page.getByLabel("Fleet reference").blur();

  const plateOne = answered("q_rf_plate");
  await card(1).getByLabel("Registration plate").fill("AAA111");
  await card(1).getByLabel("Registration plate").blur();
  await plateOne;

  const noted = answered("q_rf_notes");
  await card(1).getByLabel("Anything else about this vehicle?").fill(REPEAT_ANSWER_CANARY);
  await card(1).getByLabel("Anything else about this vehicle?").blur();
  await noted;

  const roster = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/roster$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "Add Vehicle" }).click();
  expect((await roster).status()).toBe(200);
  await expect(page.getByRole("heading", { name: INSTANCE_LABEL })).toBeVisible();
  await waitForHydration(page);
  const plateTwo = answered("q_rf_plate");
  await card(2).getByLabel("Registration plate").fill("BBB222");
  await card(2).getByLabel("Registration plate").blur();
  await plateTwo;

  const submitted = page.waitForResponse(
    (response) => response.url().includes("/submit") && response.request().method() === "POST",
  );
  await page.getByTestId("primary-action").click();
  const requestId = (await submitted).headers()["x-request-id"];
  await page.waitForURL(/\/done/);
  expect(requestId, "the portal must echo x-request-id").toBeTruthy();

  const { note } = await waitForSpans(
    "the API's submit SERVER span for the repeating form",
    (all) =>
      all.some(
        (span) =>
          span.serviceName === OTEL_SERVICE_NAMES.api &&
          span.kind === SPAN_KIND_SERVER &&
          span.attributes["qcms.request_id"] === requestId,
      ),
  );

  const payloads = readCapturedPayloads();
  expect(payloads.length, `the receiver should have captured payloads; ${note}`).toBeGreaterThan(0);
  expect(payloads).not.toContain(REPEAT_ANSWER_CANARY);
  expect(payloads).not.toContain("AAA111");
  expect(payloads).not.toContain("BBB222");
  expect(payloads).not.toContain(INSTANCE_LABEL);
  for (const log of [SERVER_LOG_FILES.api, SERVER_LOG_FILES.portal]) {
    const text = readFileSync(log, "utf8");
    expect(text).not.toContain(REPEAT_ANSWER_CANARY);
    expect(text).not.toContain(INSTANCE_LABEL);
  }
});
