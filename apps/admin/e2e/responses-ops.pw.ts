import { expect, type Page } from "@playwright/test";

import { test } from "../../portal/e2e/support/gates.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  deactivateExistingWebhooks,
  deadUrl,
  openDeliverer,
  openResponses,
  openWebhooks,
  reviseAnswer,
  startSession,
  submitResponse,
  submitSession,
  TestConsumer,
} from "./support/ops.js";

// Serial tests advance shared enrollment and response state but get fresh browser contexts.
// Include enrollment when filtering: later tests need its secret.

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

const EMAIL = uniqueAdminEmail("ops");
let totpSecret = "";

let erasable = "";

let revised = "";
// Deactivated endpoints remain listed to preserve delivery history; scope row actions to this spec's webhook id.
let opsWebhookId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test.describe("admin operations: responses, erasure, webhooks", () => {
  test("an operator browses the responses a form collected", async ({ page }) => {
    totpSecret = await enrollNewAdmin(page, EMAIL);

    erasable = await submitResponse(SLUG, [
      [ACCIDENT, true],
      [COUNT, 1],
    ]);
    const session = await startSession(SLUG);
    await reviseAnswer(session, ACCIDENT, true);
    await reviseAnswer(session, COUNT, 2);
    await reviseAnswer(session, COUNT, 3);
    await submitSession(session);
    revised = session.sessionId;
    await submitResponse(SLUG, [[ACCIDENT, false]]);

    await openResponses(page, FORM_ID);

    const table = page.getByTestId("qcms-responses-table");
    await expect(table).toBeVisible();
    for (const sessionId of [erasable, revised]) {
      await expect(table.locator(`[data-session-id="${sessionId}"]`)).toBeVisible();
    }

    await expect(page.getByTestId("qcms-responses-total")).toContainText(/^\d{1,6} responses$/);
  });

  test("filters narrow the list, and an empty result says which kind of empty it is", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    await openResponses(page, FORM_ID);

    await page.goto(`/operations/forms/${FORM_ID}/responses?from=2020-01-01&to=2020-01-02`);
    await expect(page.getByTestId("qcms-responses-empty")).toHaveText(
      "No response matches these filters.",
    );

    await page.goto(`/operations/forms/${FORM_ID}/responses`);
    await expect(page.getByTestId("qcms-responses-table")).toBeVisible();

    await page.goto(`/operations/forms/${FORM_ID}/responses?flagged=true`);
    await expect(
      page.getByRole("button", { name: /Flagged$/ }),
      "the toolbar shows the filter the server applied",
    ).toContainText("Flagged only");
    await page.goBack();
    await expect(page.getByRole("button", { name: /Flagged$/ })).toContainText("Any");
  });

  test("the ledger timeline matches the append-only history for a revised session", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    await page.goto(`/operations/forms/${FORM_ID}/responses/${revised}`);
    await expect(page.getByTestId("qcms-response-detail")).toBeVisible();

    const entries = page.getByTestId("qcms-ledger").locator("li");
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(0)).toHaveAttribute("data-question-id", ACCIDENT);
    await expect(entries.nth(1)).toHaveAttribute("data-question-id", COUNT);
    await expect(entries.nth(2)).toHaveAttribute("data-question-id", COUNT);
    await expect(entries.nth(1)).toContainText("2");
    await expect(entries.nth(2)).toContainText("3");

    const answers = page.getByTestId("qcms-locked-answers");
    await expect(answers.locator(`[data-question-id="${COUNT}"]`)).toBeVisible();
    await expect(answers).toContainText("3");

    await expect(page.getByTestId("qcms-content-hash")).not.toBeEmpty();

    await expect(answers.locator(`dt[data-question-id="${ACCIDENT}"]`)).not.toHaveText(ACCIDENT);
  });

  test("the detail route is headed by the response, with the form left to the rail", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);

    await page.goto(`/operations/forms/${FORM_ID}/responses/${revised}`);
    await expect(page.getByTestId("qcms-response-detail")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Response ${revised}`);

    await expect(page.locator('[aria-label="Breadcrumb"]')).toHaveCount(0);
    const rail = page.getByTestId("qcms-rail");
    await expect(rail.locator("summary.qcms-rail__summary")).not.toBeEmpty();
    await expect(rail.getByRole("link", { name: "Forms", exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: `Response ${revised}` })).toHaveCount(1);

    await page.goto(`/forms/${FORM_ID}`);
    await expect(page.locator("h1").first()).toHaveText("Published form");
    await expect(page.locator("h1").first(), "and not the form's name").not.toHaveText(SLUG);
  });

  test("a CSV export downloads with the environment and the version in its name", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    await openResponses(page, FORM_ID);

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByTestId("qcms-export-dialog");
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole("button", { name: "Download" })).toBeDisabled();
    await expect(dialog).toContainText("a version is required");

    const emptyNote = dialog.getByTestId("qcms-export-empty-note");
    await expect(emptyNote).toContainText("only its header row");
    await dialog.getByRole("button", { name: /Format$/ }).click();
    await page.getByRole("option", { name: "JSON", exact: true }).click();
    await expect(emptyNote).toContainText("an empty list");
    await expect(emptyNote).not.toContainText("header row");
    await dialog.getByRole("button", { name: /Format$/ }).click();
    await page.getByRole("option", { name: "CSV", exact: true }).click();
    await expect(emptyNote).toContainText("only its header row");

    await dialog.getByRole("button", { name: /Version$/ }).click();
    await page.getByRole("option", { name: "v1", exact: true }).click();

    const shapeControl = dialog.getByRole("button", { name: /CSV shape$/ });
    await expect(dialog).toContainText("the header does not change");
    await shapeControl.click();
    await page.getByRole("option", { name: "Wide", exact: true }).click();
    await expect(dialog).toContainText("Pin the version your pipeline reads");
    await shapeControl.click();
    await page.getByRole("option", { name: "Long (default)", exact: true }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByTestId("qcms-export-download").click(),
    ]);

    expect(download.suggestedFilename()).toBe(`${FORM_ID}-prod-v1-responses.csv`);

    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(path);
    expect(bytes[0], "the export keeps the API's UTF-8 BOM").toBe(0xef);
    const text = bytes.toString("utf8");
    expect(text).toContain("session_id");
    expect(text).toContain(ACCIDENT);
    expect(text).toContain(revised);
  });

  test("erasing a response is blocked behind a typed confirmation, and is irreversible", async ({
    page,
    browserGuard,
  }) => {
    // Declare only the expected nonexistent-session 404 so other admin errors still fail the console gate.
    browserGuard.expectRequestFailure({ status: 404, url: /\/responses\/ses_neverexisted$/ });
    await signInWithTotp(page, EMAIL, totpSecret);
    await page.goto(`/operations/forms/${FORM_ID}/responses/${erasable}`);
    await expect(page.getByTestId("qcms-response-detail")).toBeVisible();

    await page.getByRole("button", { name: "Erase respondent data…" }).click();
    const dialog = page.getByTestId("qcms-erase-dialog");
    await expect(dialog).toBeVisible();

    await expect(dialog).toContainText("There is no undo");
    await expect(dialog).toContainText("A tombstone remains");

    await expect(dialog).toContainText("An event already delivered stays delivered");
    await expect(dialog).toContainText(
      "the consumer's to erase, as an independent data controller",
    );
    await expect(dialog).toContainText(
      "has not been delivered is cancelled and will never be sent",
    );
    await expect(dialog).toContainText("QCMS's own stored copy of the answers");
    await expect(dialog).toContainText("is redacted");
    const confirm = dialog.getByRole("button", { name: "Erase permanently" });
    await expect(confirm).toBeDisabled();

    await dialog.getByRole("textbox", { name: /Type the session id/ }).fill("not-the-id");
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox", { name: /Type the session id/ }).fill(erasable);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    const tombstone = page.getByTestId("qcms-tombstone");
    await expect(tombstone).toBeVisible();
    await expect(tombstone).toContainText(erasable);

    await expect(page.getByTestId("qcms-tombstone-reason")).toHaveText("Data subject request");

    await expect(page.getByTestId("qcms-locked-answers")).toBeHidden();

    await expect
      .poll(async () => headingOutline(page), {
        message: "the in-place tombstone's heading outline",
      })
      .toEqual([`h1: Response ${erasable}`, "h2: Erased"]);

    await openResponses(page, FORM_ID);
    await expect(
      page.getByTestId("qcms-responses-table").locator(`[data-session-id="${erasable}"]`),
    ).toHaveCount(0);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.goto(`/operations/forms/${FORM_ID}/export?format=csv&version=1`).catch(() => undefined),
    ]);
    const { readFileSync } = await import("node:fs");
    const exported = readFileSync(await download.path()).toString("utf8");
    expect(exported, "an erased session must not be exportable").not.toContain(erasable);
    expect(exported, "the surviving responses are still exported").toContain(revised);

    await page.goto("/responses/erasures");
    const logged = page
      .getByTestId("qcms-erasures-table")
      .locator(`[data-session-id="${erasable}"]`);
    await expect(logged).toBeVisible();
    await expect(logged, "the log reads as evidence, not as a database dump").toContainText(
      "Data subject request",
    );

    await page.goto(`/operations/forms/${FORM_ID}/responses/${erasable}`);
    await expect(page.getByTestId("qcms-tombstone")).toContainText(erasable);
    await expect(page.getByTestId("qcms-locked-answers")).toHaveCount(0);

    await expect
      .poll(async () => headingOutline(page), {
        message: "the tombstone route's heading outline, opened cold",
      })
      .toEqual([`h1: Response ${erasable}`, "h2: Erased"]);

    const unknown = await page.goto(`/operations/forms/${FORM_ID}/responses/ses_neverexisted`);
    expect(unknown?.status()).toBe(404);
  });

  test("a poisoned webhook target dead-letters, and redelivers once the URL is fixed", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);

    const consumer = new TestConsumer();
    await consumer.start();
    const deliverer = openDeliverer();
    try {
      await deactivateExistingWebhooks(page, FORM_ID);

      await expect(page.getByTestId("qcms-webhook-config")).toContainText(
        "withheld until an operator releases it",
      );
      const broken = await deadUrl();
      await page.getByRole("button", { name: "Add endpoint" }).click();
      const create = page.getByTestId("qcms-webhook-url-dialog");
      await create.getByRole("textbox", { name: "Endpoint URL" }).fill(broken);
      await create.getByRole("button", { name: "Create endpoint" }).click();

      const secretPanel = page.getByTestId("qcms-webhook-secret");
      await expect(secretPanel).toBeVisible();
      await expect(secretPanel).toContainText("only time this secret is shown");
      const secret = (await page.getByTestId("qcms-webhook-secret-value").textContent()) ?? "";
      expect(secret.length, "a secret was revealed").toBeGreaterThan(0);
      await page.getByRole("button", { name: "I have copied it" }).click();

      opsWebhookId =
        (await page
          .getByTestId("qcms-webhooks-table")
          .locator("tr")
          .filter({ hasText: broken })
          .getAttribute("data-webhook-id")) ?? "";
      expect(opsWebhookId, "the created endpoint owns a row").toMatch(/^whk_/u);

      await page.reload();
      await expect(page.getByTestId("qcms-webhooks-table")).toContainText(
        "Stored, not retrievable",
      );
      expect(await page.content()).not.toContain(secret);

      // Drain all queued events: submissions made before endpoint creation fan out too, so counts are not fixed.
      const stuck = await submitResponse(SLUG, [[ACCIDENT, false]]);
      expect(stuck).toMatch(/^ses_/);
      await deliverer.drive(11);

      await openWebhooks(page, FORM_ID);
      const deliveries = page.getByTestId("qcms-deliveries-table");
      const dead = deliveries.locator('[data-status="deadLettered"]');
      const deadCount = await dead.count();
      expect(deadCount, "the broken target dead-lettered every delivery").toBeGreaterThan(0);
      await expect(deliveries.locator("tbody tr[data-delivery-id]")).toHaveCount(deadCount);

      expect(
        await danglingAriaControls(page),
        "no collapsed row names a detail panel that is not in the document",
      ).toEqual([]);

      const openedRow = deliveries.locator("tbody tr[data-delivery-id]").first();
      await openedRow.getByRole("button", { name: /^Show request and response/ }).click();
      const panelId =
        (await openedRow
          .getByRole("button", { name: /^Hide request and response/ })
          .getAttribute("aria-controls")) ?? "";
      expect(panelId, "the open row names its panel").toMatch(/^qcms-delivery-detail-/);
      const detail = page.locator(`#${panelId}`);
      await expect(detail.getByTestId("qcms-delivery-no-response")).toContainText("network_error");

      await expect(detail.getByTestId("qcms-delivery-headers")).toContainText("x-qcms-signature");
      await expect(detail.getByTestId("qcms-delivery-headers")).toContainText("v1=<masked>");
      expect(await detail.textContent()).not.toMatch(/v1=[0-9a-f]{64}/);

      const opened = openedRow.getByRole("button", { name: /^Hide request and response/ });
      await expect(opened).toHaveAttribute("aria-expanded", "true");
      await expect(detail).toBeVisible();
      expect(
        await danglingAriaControls(page),
        "and no other row names a panel that is not in the document",
      ).toEqual([]);

      expect(
        await detail.evaluate((element) => {
          const panelRow = element.closest("tr");
          const summaryRow = panelRow?.previousElementSibling ?? null;
          return {
            sameGroup: panelRow?.parentElement === summaryRow?.parentElement,
            summaryIsDeliveryRow: summaryRow?.hasAttribute("data-delivery-id") ?? false,
          };
        }),
        "the detail sits in a second row of the same row group",
      ).toEqual({ sameGroup: true, summaryIsDeliveryRow: true });

      await opened.click();
      await expect(
        openedRow.getByRole("button", { name: /^Show request and response/ }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(await danglingAriaControls(page), "collapsing leaves nothing dangling either").toEqual(
        [],
      );

      await page.goto("/webhooks");
      await expect(page.getByTestId("qcms-dead-letters-table").locator("tbody tr")).toHaveCount(
        deadCount,
      );
      await expect(page.getByTestId("qcms-dead-letter-error").first()).toHaveText("network_error");

      // Cover both erasure orders: before fan-out no delivery materialises; after dead-lettering the row is cancelled in place.
      const redactedEarly = await deliverer.outboxPayloadsForSession(erasable);
      expect(redactedEarly.length, "the erased session's event row survives").toBeGreaterThan(0);
      expect(
        redactedEarly[0],
        "but QCMS's own copy of the answers is gone from it",
      ).not.toHaveProperty("answers");
      expect(
        redactedEarly[0]?.["sessionId"],
        "the envelope stays, so the row is still the audit record of an event",
      ).toBe(erasable);
      expect(
        (await deliverer.cancelledDeliveries(erasable)).length +
          (await deliverer.erasedDeliveries()).filter((row) => row.sessionId === erasable).length,
        "a session erased before fan-out never gets a delivery row at all",
      ).toBe(0);

      await eraseResponse(page, stuck);

      const cancelled = await deliverer.cancelledDeliveries(stuck);
      expect(cancelled.length, "the dead-lettered delivery was cancelled").toBeGreaterThan(0);
      expect(cancelled[0]?.cancelledReason).toBe("session_erased");
      expect(
        (await deliverer.outboxPayloadsForSession(stuck))[0],
        "and its payload was redacted in the same transaction",
      ).not.toHaveProperty("answers");
      const cancelledCount = cancelled.length;

      await openWebhooks(page, FORM_ID);
      await webhookRow(page).getByRole("button", { name: "Change URL" }).click();
      const retarget = page.getByTestId("qcms-webhook-url-dialog");
      await retarget.getByRole("textbox", { name: "Endpoint URL" }).fill(consumer.url());
      await retarget.getByRole("button", { name: "Save the URL" }).click();
      await expect(webhookRow(page)).toContainText(consumer.url());

      await page.goto("/webhooks");
      const queue = page.getByTestId("qcms-dead-letters-table");

      const queueAfterErasure = deadCount - cancelledCount;
      await expect(
        queue.locator("tr[data-delivery-id]"),
        "the erased session's delivery left the queue",
      ).toHaveCount(queueAfterErasure);
      await queue
        .locator("tr[data-delivery-id]")
        .first()
        .getByRole("button", { name: /^Redeliver response\.submitted to / })
        .click();

      await expect(page.getByTestId("qcms-redeliver-summary")).toHaveText(
        "1 delivery is queued for the next pass.",
      );

      await deliverer.pass();
      expect(consumer.received.length, "the fixed consumer received the delivery").toBe(1);
      expect(consumer.received[0]?.headers["x-qcms-signature"]).toMatch(/^v1=[0-9a-f]{64}$/);

      await openWebhooks(page, FORM_ID);
      const deliveredRow = page
        .getByTestId("qcms-deliveries-table")
        .locator('[data-status="delivered"]');
      await expect(deliveredRow).toHaveCount(1);
      // Select the delivered row by status: creation order need not put the redelivered row first.
      await expect(deliveredRow.getByTestId("qcms-delivery-attempts")).toHaveText("0");

      await page.goto("/webhooks");
      const remaining = queueAfterErasure - 1;
      await page.getByRole("button", { name: "Redeliver all" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Redeliver all of them" })
        .click();
      // The backlog depends on earlier specs; derive singular or plural from the remaining count.
      await expect(page.getByTestId("qcms-redeliver-summary")).toHaveText(
        remaining === 1
          ? "1 delivery is queued for the next pass."
          : `${String(remaining)} deliveries are queued for the next pass.`,
      );

      await deliverer.pass();
      expect(consumer.received.length, "every queued redelivery reached the consumer").toBe(
        queueAfterErasure,
      );

      for (const request of consumer.received) {
        for (const erasedSession of [erasable, stuck]) {
          expect(
            request.body,
            "an erased respondent's answers must never reach a consumer",
          ).not.toContain(erasedSession);
        }
      }

      await openWebhooks(page, FORM_ID);
      const table = page.getByTestId("qcms-deliveries-table");
      await expect(table.locator('[data-status="delivered"]')).toHaveCount(queueAfterErasure);
      await expect(
        table.locator('[data-status="cancelled"]'),
        "the erased session's delivery is shown as cancelled, not dropped",
      ).toHaveCount(cancelledCount);
      await expect(
        table.locator('[data-status="deadLettered"]'),
        "and nothing is left dead-lettered",
      ).toHaveCount(0);

      const cancelledRow = table.locator(
        `tr[data-delivery-id="${cancelled[0]?.deliveryId ?? ""}"]`,
      );
      await cancelledRow.getByRole("button", { name: /^Show request and response/ }).click();
      await expect(page.getByTestId("qcms-delivery-cancelled")).toContainText(
        "the respondent's data was erased",
      );
    } finally {
      await deliverer.close();
      await consumer.stop();
    }
  });

  test("rotating a secret shows the new one once, and deactivating stops fan-out", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    await openWebhooks(page, FORM_ID);

    await webhookRow(page).getByRole("button", { name: "Rotate secret" }).click();
    const rotate = page.getByRole("alertdialog");
    await expect(rotate).toContainText("starts rejecting");
    await rotate.getByRole("button", { name: "Rotate it" }).click();

    const rotated = (await page.getByTestId("qcms-webhook-secret-value").textContent()) ?? "";
    expect(rotated.length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "I have copied it" }).click();
    await page.reload();
    expect(await page.content()).not.toContain(rotated);

    await webhookRow(page).getByRole("button", { name: "Deactivate", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate it" }).click();
    await expect(webhookRow(page)).toContainText("Inactive");
  });
});

// Axe marks a collapsed disclosure's unresolved aria-controls incomplete, so assert IDREF resolution directly.
async function danglingAriaControls(page: Page): Promise<readonly string[]> {
  return page
    .getByTestId("qcms-delivery-dashboard")
    .evaluate((root) =>
      [...root.querySelectorAll("[aria-controls]")]
        .map((element) => element.getAttribute("aria-controls") ?? "")
        .filter((id) => id !== "" && root.ownerDocument.getElementById(id) === null),
    );
}

// Read visible headings only: the hidden JavaScript-required message carries another h1 on every page.
async function headingOutline(page: Page): Promise<readonly string[]> {
  return page
    .locator("h1:visible, h2:visible, h3:visible, h4:visible, h5:visible, h6:visible")
    .evaluateAll((nodes) =>
      nodes.map((node) => `${node.tagName.toLowerCase()}: ${(node.textContent ?? "").trim()}`),
    );
}

function webhookRow(page: Page) {
  return page.getByTestId("qcms-webhooks-table").locator(`tr[data-webhook-id="${opsWebhookId}"]`);
}

async function eraseResponse(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/operations/forms/${FORM_ID}/responses/${sessionId}`);
  await page.getByRole("button", { name: "Erase respondent data…" }).click();
  const dialog = page.getByTestId("qcms-erase-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /Type the session id/ }).fill(sessionId);
  await dialog.getByRole("button", { name: "Erase permanently" }).click();
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
}
