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

function describeArrival(millis: number): string {
  return millis < 0 ? "never arrived" : `${String(millis)}ms`;
}

interface CorrelatedDelivery {
  readonly traceId: string;

  readonly logs: readonly CapturedLog[];

  readonly note: string;
}

// Telemetry legs export independently; poll within the configured batch-delay and export-timeout budget.
// Do not retry: that would hide the first-attempt latency this spec measures.
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

  // Retain arrival times on success too so a slow export can be distinguished from a missing artifact.
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

// This auth flow exports while holding passwords, factor secrets and recovery codes.
// Check all minted credentials against captured telemetry to enforce redaction.
test("an Admin request exports safe logs in its connected API trace", async ({ page }) => {
  const email = uniqueAdminEmail("otel-logs");
  await createTestAdmin(email);

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
