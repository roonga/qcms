import { expect, test } from "../../portal/e2e/support/gates.js";
import { OTEL_SERVICE_NAMES } from "../../portal/e2e/support/harness-config.js";
import { readCapturedLogs, readCapturedSpans } from "../../portal/e2e/support/otlp-receiver.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin } from "./support/flow.js";

const WAIT_MS = 20_000;

test("an Admin request exports safe logs in its connected API trace", async ({ page }) => {
  const email = uniqueAdminEmail("otel-logs");
  await createTestAdmin(email);
  await enrollNewAdmin(page, email);

  const response = await page.goto("/forms");
  const requestId = response?.headers()["x-request-id"];
  expect(requestId).toBeTruthy();

  const deadline = Date.now() + WAIT_MS;
  let traceId = "";
  let logs = readCapturedLogs();
  while (Date.now() < deadline) {
    const apiSpan = readCapturedSpans().find(
      (span) =>
        span.serviceName === OTEL_SERVICE_NAMES.api &&
        span.attributes["qcms.request_id"] === requestId,
    );
    traceId = apiSpan?.traceId ?? "";
    logs = readCapturedLogs();
    const services = new Set(
      logs
        .filter((record) => record.traceId === traceId && record.attributes.requestId === requestId)
        .map((record) => record.serviceName),
    );
    if (services.has(OTEL_SERVICE_NAMES.admin) && services.has(OTEL_SERVICE_NAMES.api)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  expect(traceId).toMatch(/^[0-9a-f]{32}$/u);
  const correlated = logs.filter(
    (record) => record.traceId === traceId && record.attributes.requestId === requestId,
  );
  expect(correlated.some((record) => record.serviceName === OTEL_SERVICE_NAMES.admin)).toBe(true);
  expect(correlated.some((record) => record.serviceName === OTEL_SERVICE_NAMES.api)).toBe(true);
});
