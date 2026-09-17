import { expect, test } from "../../portal/e2e/support/gates.js";
import {
  OTEL_SERVICE_NAMES,
  OTLP_DELIVERY_BUDGET_MS,
  OTLP_POLL_MS,
  otlpDeliveryNote,
} from "../../portal/e2e/support/harness-config.js";
import { recordOtlpDelivery } from "../../portal/e2e/support/otlp-delivery.js";
import {
  readCapturedLogs,
  readCapturedPayloads,
  readCapturedSpans,
  type CapturedLog,
} from "../../portal/e2e/support/otlp-receiver.js";

import { createTestAdmin, TEST_PASSWORD, uniqueAdminEmail } from "./support/admin-account.js";
import { readSetupKey, submitSignIn, submitTotp } from "./support/flow.js";

/** One artefact's arrival, in the words a failure message needs. */
function describeArrival(millis: number): string {
  return millis < 0 ? "never arrived" : `${String(millis)}ms`;
}

/** What one wait for exported telemetry observed. */
interface CorrelatedDelivery {
  /** The trace id the API span reported, or "" if no such span ever arrived. */
  readonly traceId: string;
  /** Every log record captured by the end of the wait. */
  readonly logs: readonly CapturedLog[];
  /** The sentence a failing assertion adds, naming the budget and the slow leg. */
  readonly note: string;
}

/**
 * Wait for the three artefacts one admin request produces, on a budget the exporters'
 * own configuration implies (issue #901).
 *
 * They travel independently after the request completes: the API's span (which is what
 * resolves the trace id) and one log record from each service, each waiting out its
 * processor's batch delay and then one export attempt over loopback to the in-test
 * receiver. So this is a bounded poll rather than a fixed sleep, and the bound is
 * `OTLP_DELIVERY_BUDGET_MS`, derived from the delay and export timeout the harness
 * configures. It used to be a literal 20s, which was unrelated to that configuration
 * and, with the batch variables reaching no processor at all, shorter than the
 * pipeline's own worst case.
 *
 * It returns rather than asserts, and there is deliberately no retry around it. A retry
 * would turn a slow pipeline into a pass and hide the latency this spec now measures;
 * the recorded first-seen times are what tell a slow pipeline from a broken one.
 */
async function waitForCorrelatedDelivery(requestId: string): Promise<CorrelatedDelivery> {
  const started = Date.now();
  const deadline = started + OTLP_DELIVERY_BUDGET_MS;
  let traceId = "";
  let logs: readonly CapturedLog[];
  let apiSpanAt = -1;
  let adminLogAt = -1;
  let apiLogAt = -1;
  for (;;) {
    const apiSpan = readCapturedSpans().find(
      (span) =>
        span.serviceName === OTEL_SERVICE_NAMES.api &&
        span.attributes["qcms.request_id"] === requestId,
    );
    traceId = apiSpan?.traceId ?? "";
    if (traceId !== "" && apiSpanAt < 0) apiSpanAt = Date.now() - started;
    logs = readCapturedLogs();
    const services = new Set(
      logs
        .filter((record) => record.traceId === traceId && record.attributes.requestId === requestId)
        .map((record) => record.serviceName),
    );
    if (services.has(OTEL_SERVICE_NAMES.admin) && adminLogAt < 0) adminLogAt = Date.now() - started;
    if (services.has(OTEL_SERVICE_NAMES.api) && apiLogAt < 0) apiLogAt = Date.now() - started;
    if (services.has(OTEL_SERVICE_NAMES.admin) && services.has(OTEL_SERVICE_NAMES.api)) break;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, OTLP_POLL_MS));
  }

  // The numbers, kept after a green run as well as a red one: the two #901 sightings
  // were argued from a timeout rather than from a latency, because no run had ever
  // recorded one.
  const elapsedMs = Date.now() - started;
  recordOtlpDelivery("admin request, correlated API span and both log records", elapsedMs, {
    apiSpan: apiSpanAt,
    adminLog: adminLogAt,
    apiLog: apiLogAt,
  });

  const seen =
    `first seen: API span ${describeArrival(apiSpanAt)}, ` +
    `admin log ${describeArrival(adminLogAt)}, API log ${describeArrival(apiLogAt)}`;
  return { traceId, logs, note: `${otlpDeliveryNote(elapsedMs)}; ${seen}` };
}

/**
 * The Admin half of the cross-service log check, and the only exported-telemetry spec in
 * the repo whose flow handles real credentials: it signs in with a password and enrols a
 * TOTP factor, so the process under test holds a password, a shared secret and a set of
 * recovery codes while it is exporting.
 *
 * That makes it the one place the SEC-13 claim about credentials can be *checked* rather
 * than argued. The Portal spec hunts an answer value it submitted; this one hunts every
 * credential this flow minted.
 */
test("an Admin request exports safe logs in its connected API trace", async ({ page }) => {
  const email = uniqueAdminEmail("otel-logs");
  await createTestAdmin(email);

  // Enrollment is spelled out here rather than delegated to `enrollNewAdmin` for one
  // reason: this spec needs the recovery codes, and that helper reads past them on its
  // way into the app. The steps and the screens are the helper's, unchanged.
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  const totpSecret = await readSetupKey(page);
  await submitTotp(page, totpSecret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  const recoveryCodes = (
    await page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").allInnerTexts()
  ).map((code) => code.trim());
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await page.waitForURL(/\/questions$/);

  const response = await page.goto("/forms");
  const requestId = response?.headers()["x-request-id"];
  expect(requestId).toBeTruthy();

  const { traceId, logs, note } = await waitForCorrelatedDelivery(String(requestId));

  expect(
    traceId,
    `no API span carrying this request id reached the receiver, so there is no trace id to correlate on: ${note}`,
  ).toMatch(/^[0-9a-f]{32}$/u);
  const correlated = logs.filter(
    (record) => record.traceId === traceId && record.attributes.requestId === requestId,
  );
  expect(
    correlated.some((record) => record.serviceName === OTEL_SERVICE_NAMES.admin),
    `no admin log record correlated to this request reached the receiver: ${note}`,
  ).toBe(true);
  expect(
    correlated.some((record) => record.serviceName === OTEL_SERVICE_NAMES.api),
    `no API log record correlated to this request reached the receiver: ${note}`,
  ).toBe(true);

  // --- SEC-13: no credential this flow minted reaches an exported payload -------------
  //
  // An absence assertion is worth exactly as much as the evidence that there was
  // something to find. Two ways this block could pass while proving nothing, both closed
  // before the greps run: a capture file that is empty or was never written, and a
  // credential that is blank or padded so that no substring of the capture could ever
  // equal it. The correlated records above are the third leg: they are the same flow's
  // own log lines, so the capture demonstrably covers the window the credentials were
  // live in, not some quiet interval beside it.
  expect(TEST_PASSWORD.length, "the suite password should be a real value").toBeGreaterThan(12);
  expect(totpSecret, "enrollment should have shown a setup key").not.toMatch(/^\s*$/u);
  expect(totpSecret, "the setup key should be a bare secret, not a formatted one").not.toMatch(
    /\s/u,
  );
  expect(totpSecret.length, "the setup key should be a full-length secret").toBeGreaterThanOrEqual(
    16,
  );
  expect(
    recoveryCodes.length,
    "enrollment should have shown recovery codes",
  ).toBeGreaterThanOrEqual(5);
  for (const code of recoveryCodes) {
    expect(code.length, "a recovery code should be a real value").toBeGreaterThanOrEqual(8);
  }

  const payloads = readCapturedPayloads();
  expect(payloads.length, "the receiver should have captured payloads").toBeGreaterThan(0);
  expect(
    correlated.length,
    "this flow's own records should be inside the captured payloads",
  ).toBeGreaterThan(0);

  expect(payloads, "the account password must not reach an exported payload").not.toContain(
    TEST_PASSWORD,
  );
  expect(payloads, "the TOTP secret must not reach an exported payload").not.toContain(totpSecret);
  for (const code of recoveryCodes) {
    expect(payloads, "a recovery code must not reach an exported payload").not.toContain(code);
  }
});
