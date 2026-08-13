import { expect, test } from "../../portal/e2e/support/gates.js";
import { OTEL_SERVICE_NAMES } from "../../portal/e2e/support/harness-config.js";
import {
  readCapturedLogs,
  readCapturedPayloads,
  readCapturedSpans,
} from "../../portal/e2e/support/otlp-receiver.js";

import { createTestAdmin, TEST_PASSWORD, uniqueAdminEmail } from "./support/admin-account.js";
import { readSetupKey, submitSignIn, submitTotp } from "./support/flow.js";

const WAIT_MS = 20_000;

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
