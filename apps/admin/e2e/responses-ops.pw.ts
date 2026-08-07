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

/**
 * The operations arc (task 035, stage 8a exit gate): browse seeded responses, export
 * CSV, erase one and see it gone, then poison a webhook target, watch it dead-letter,
 * fix the target and redeliver until it is delivered.
 *
 * ## It runs against the seeded insurance form on purpose
 *
 * `frm_auto_quote` has a published version with stored compiled A2UI, so the
 * respondent path works and these responses are real submissions written by the real
 * submit slice (020) - locked answers, a content hash, an append-only ledger and an
 * outbox event. 034's suite authored its own questions through the UI because it
 * needed `compileDraft`, which the seed cannot satisfy (issue #275: the seed's
 * question versions are never published, whatever its doc comment says). Nothing here
 * compiles a draft, so that trap does not apply and the cheaper fixture is the right
 * one.
 *
 * ## Serial, with one enrollment
 *
 * `mode: "serial"` orders the tests; it does NOT share a browser context (031's note
 * in `support/flow.ts`), so each test signs in again with the TOTP secret the first
 * one enrolled. That also means **`-g` is not an iteration tool here**: filtering out
 * the first test drops the enrollment every later test depends on, and the run dies on
 * an unrelated locator timeout.
 */

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

const EMAIL = uniqueAdminEmail("ops");
let totpSecret = "";
/** The response the erasure test destroys, kept off every other test's path. */
let erasable = "";
/** The response whose ledger carries a revision (exit criterion 4). */
let revised = "";
/**
 * The endpoint this spec configures.
 *
 * Every row action is scoped to it by `data-webhook-id`. The suite shares one database,
 * so the endpoints table can hold rows an earlier spec left behind (deactivated by
 * `deactivateExistingWebhooks`, but still listed - deactivation is soft so the delivery
 * history survives), and a bare `getByRole("button", { name: "Change URL" })` then
 * matches every row at once.
 */
let opsWebhookId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test.describe("admin operations: responses, erasure, webhooks", () => {
  test("an operator browses the responses a form collected", async ({ page }) => {
    totpSecret = await enrollNewAdmin(page, EMAIL);

    // Three real submissions. The second is revised before submitting, so its ledger
    // has two revisions of one question and the timeline has something to prove.
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
    // The count is the API's total for the filtered set, not the row count of this
    // page, so it is asserted as a sentence rather than inferred from the table.
    await expect(page.getByTestId("qcms-responses-total")).toContainText(/^\d{1,6} responses$/);
  });

  test("filters narrow the list, and an empty result says which kind of empty it is", async ({
    page,
  }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    await openResponses(page, FORM_ID);

    // A date range in the past matches nothing. The message must be the FILTERED
    // empty state, not "nothing has been submitted" - the form plainly has responses,
    // and 034's retro names copy that describes intent rather than state as the
    // recurring defect in this train.
    await page.goto(`/forms/${FORM_ID}/responses?from=2020-01-01&to=2020-01-02`);
    await expect(page.getByTestId("qcms-responses-empty")).toHaveText(
      "No response matches these filters.",
    );

    await page.goto(`/forms/${FORM_ID}/responses`);
    await expect(page.getByTestId("qcms-responses-table")).toBeVisible();

    // The controls re-seed from what the SERVER applied. Navigating back to a filtered
    // URL used to leave them showing the previous set, so the toolbar and the table
    // beside it disagreed about what was on screen.
    await page.goto(`/forms/${FORM_ID}/responses?flagged=true`);
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
    await page.goto(`/forms/${FORM_ID}/responses/${revised}`);
    await expect(page.getByTestId("qcms-response-detail")).toBeVisible();

    // Exit criterion 4. Three revisions were written: the accident answer, then the
    // count twice (2, then 3). The timeline shows every one of them, in order, and the
    // LOCKED answer is only the last.
    const entries = page.getByTestId("qcms-ledger").locator("li");
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(0)).toHaveAttribute("data-question-id", ACCIDENT);
    await expect(entries.nth(1)).toHaveAttribute("data-question-id", COUNT);
    await expect(entries.nth(2)).toHaveAttribute("data-question-id", COUNT);
    await expect(entries.nth(1)).toContainText("2");
    await expect(entries.nth(2)).toContainText("3");

    // The locked set carries the final value only: the ledger is the history, the
    // answers are the state.
    const answers = page.getByTestId("qcms-locked-answers");
    await expect(answers.locator(`[data-question-id="${COUNT}"]`)).toBeVisible();
    await expect(answers).toContainText("3");

    // The content hash is the audit anchor and is rendered, not implied.
    await expect(page.getByTestId("qcms-content-hash")).not.toBeEmpty();

    // Captions come from the pinned question version, so they are words rather than
    // ids when the wording resolves.
    await expect(answers.locator(`dt[data-question-id="${ACCIDENT}"]`)).not.toHaveText(ACCIDENT);
  });

  test("a CSV export downloads with the version in its name", async ({ page }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    await openResponses(page, FORM_ID);

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByTestId("qcms-export-dialog");
    await expect(dialog).toBeVisible();

    // CSV without a version cannot be downloaded: the API needs the version to know
    // the column set, and the dialog says so rather than letting the operator find out
    // from a 400.
    await expect(dialog.getByRole("button", { name: "Download" })).toBeDisabled();
    await expect(dialog).toContainText("a version is required");

    // The empty-result sentence describes the file the SELECTED format would produce.
    // An empty CSV is its header row; an empty JSON export is a list with nothing in
    // it, and one sentence claiming a header row for both was wrong for whichever
    // format was not chosen.
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

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByTestId("qcms-export-download").click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${FORM_ID}-v1-responses.csv`);

    // The bytes are the API's: a UTF-8 BOM, then a header row naming the metadata
    // columns and the version's questions. Asserting the BOM proves this app streamed
    // the body rather than re-encoding it.
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
    // The last step navigates to a session that never existed, and the browser reports
    // that 404 as a console error. Declared per test and per URL rather than allowed
    // globally: a 404 from any other admin URL in this test is still a failure, and a
    // declaration that never fires fails the test, so this cannot rot into a mute.
    browserGuard.expectRequestFailure({ status: 404, url: /\/responses\/ses_neverexisted$/ });
    await signInWithTotp(page, EMAIL, totpSecret);
    await page.goto(`/forms/${FORM_ID}/responses/${erasable}`);
    await expect(page.getByTestId("qcms-response-detail")).toBeVisible();

    await page.getByRole("button", { name: "Erase respondent data…" }).click();
    const dialog = page.getByTestId("qcms-erase-dialog");
    await expect(dialog).toBeVisible();

    // Exit criterion 2, first half: no single-click path. The dialog states the three
    // ADR-17 facts, and the confirm button is inert until the id is typed back.
    await expect(dialog).toContainText("There is no undo");
    await expect(dialog).toContainText("A tombstone remains");
    // The third fact has three clauses, and each is a separate promise about a
    // different copy of the data (059). Asserted one at a time so a rewrite that drops
    // one fails here rather than passing on the other two; the behaviour behind each is
    // asserted in test 6 below and in the @qcms/db integration suite.
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

    // Exit criterion 2, second half: the post-state is right everywhere.
    const tombstone = page.getByTestId("qcms-tombstone");
    await expect(tombstone).toBeVisible();
    await expect(tombstone).toContainText(erasable);
    // The compliance surface must not leak the machine enum: the dialog that recorded
    // this offered "Data subject request", and the record of it has to say the same.
    await expect(page.getByTestId("qcms-tombstone-reason")).toHaveText("Data subject request");
    // The answers are gone from the screen that was showing them a moment ago.
    await expect(page.getByTestId("qcms-locked-answers")).toBeHidden();

    // Gone from the list.
    await openResponses(page, FORM_ID);
    await expect(
      page.getByTestId("qcms-responses-table").locator(`[data-session-id="${erasable}"]`),
    ).toHaveCount(0);

    // Gone from the export.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.goto(`/forms/${FORM_ID}/export?format=csv&version=1`).catch(() => undefined),
    ]);
    const { readFileSync } = await import("node:fs");
    const exported = readFileSync(await download.path()).toString("utf8");
    expect(exported, "an erased session must not be exportable").not.toContain(erasable);
    expect(exported, "the surviving responses are still exported").toContain(revised);

    // Present in the erasure log, which is the compliance evidence that replaces it.
    await page.goto("/responses/erasures");
    const logged = page
      .getByTestId("qcms-erasures-table")
      .locator(`[data-session-id="${erasable}"]`);
    await expect(logged).toBeVisible();
    await expect(logged, "the log reads as evidence, not as a database dump").toContainText(
      "Data subject request",
    );

    // The detail URL keeps working and keeps telling the truth: the tombstone, served
    // from the erasure log, rather than a stale render or a 404 for a URL an operator
    // may have in a ticket.
    await page.goto(`/forms/${FORM_ID}/responses/${erasable}`);
    await expect(page.getByTestId("qcms-tombstone")).toContainText(erasable);
    await expect(page.getByTestId("qcms-locked-answers")).toHaveCount(0);

    // A session that never existed is still a 404.
    const unknown = await page.goto(`/forms/${FORM_ID}/responses/ses_neverexisted`);
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
      // 1. Configure an endpoint pointing at nothing. The secret is revealed once.
      //    Any endpoint an earlier spec left on this form is deactivated first, so the
      //    fan-out is exactly one endpoint wide and the counts below mean what they say.
      await deactivateExistingWebhooks(page, FORM_ID);

      // The screen's own claim about what consumers receive, pinned. The submit slice
      // enqueues `response.submitted` only for an unflagged submission
      // (`apps/api/src/features/responses/submit/handler.ts`), and this task ships the
      // unflag action whose whole premise is that a flagged one was withheld - so an
      // intro promising "every submission" would be a sentence the same diff disproves.
      // Asserted rather than reviewed, because that copy shipped once already.
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

      // Read the id off the row rather than guessing it, and scope every later action to
      // it. The row is found by the URL it was just given, which is unique to this spec.
      opsWebhookId =
        (await page
          .getByTestId("qcms-webhooks-table")
          .locator("tr")
          .filter({ hasText: broken })
          .getAttribute("data-webhook-id")) ?? "";
      expect(opsWebhookId, "the created endpoint owns a row").toMatch(/^whk_/u);

      // Reloading proves the reveal was one-time: nothing on the reloaded screen
      // carries the value, because no read route can produce it (SEC-6).
      await page.reload();
      await expect(page.getByTestId("qcms-webhooks-table")).toContainText(
        "Stored, not retrievable",
      );
      expect(await page.content()).not.toContain(secret);

      // 2. Every event this form has queued fans out to it, and every attempt fails
      //    until they all dead-letter.
      //
      //    "Every event", not "the one I just submitted": the outbox is drained on the
      //    first pass, and the earlier tests' submissions were still sitting in it
      //    unfanned because no webhook existed yet. That is the product working as
      //    designed (an endpoint configured today receives the events already queued),
      //    so the assertions count what the screen actually holds rather than a number
      //    this test wishes were one.
      const stuck = await submitResponse(SLUG, [[ACCIDENT, false]]);
      expect(stuck).toMatch(/^ses_/);
      await deliverer.drive(11);

      await openWebhooks(page, FORM_ID);
      const deliveries = page.getByTestId("qcms-deliveries-table");
      const dead = deliveries.locator('[data-status="deadLettered"]');
      const deadCount = await dead.count();
      expect(deadCount, "the broken target dead-lettered every delivery").toBeGreaterThan(0);
      await expect(deliveries.locator("tbody tr[data-delivery-id]")).toHaveCount(deadCount);

      // The attempt record is real: the deliverer never got a response from a refused
      // connection, so there is no status and the error names the transport failure.
      await deliveries
        .getByRole("button", { name: /^Show request and response/ })
        .first()
        .click();
      const detail = page.getByTestId("qcms-delivery-detail");
      await expect(detail.getByTestId("qcms-delivery-no-response")).toContainText("network_error");
      // The signature header is present and masked, in the data rather than the render.
      await expect(detail.getByTestId("qcms-delivery-headers")).toContainText("x-qcms-signature");
      await expect(detail.getByTestId("qcms-delivery-headers")).toContainText("v1=<masked>");
      expect(await detail.textContent()).not.toMatch(/v1=[0-9a-f]{64}/);

      // 3. The queue shows them, across every form.
      await page.goto("/webhooks");
      await expect(page.getByTestId("qcms-dead-letters-table").locator("tbody tr")).toHaveCount(
        deadCount,
      );
      await expect(page.getByTestId("qcms-dead-letter-error").first()).toHaveText("network_error");

      // 3b. ADR-17 as amended 2026-08-02 (task 059): erasure reaches this queue.
      //
      //     Two orderings matter, and this test now covers both.
      //
      //     `erasable` was submitted in test 1 and erased in test 5, BEFORE any
      //     endpoint existed. Its outbox row was redacted then, so the materialize
      //     phase above declined to fan it out at all: it never became a delivery.
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

      //     `stuck` is the other ordering, and the one 035's handler-only guard could
      //     not reach: submitted at the top of this test, already dead-lettered above,
      //     and erased now. Its delivery is cancelled in place.
      await eraseResponse(page, stuck);

      const cancelled = await deliverer.cancelledDeliveries(stuck);
      expect(cancelled.length, "the dead-lettered delivery was cancelled").toBeGreaterThan(0);
      expect(cancelled[0]?.cancelledReason).toBe("session_erased");
      expect(
        (await deliverer.outboxPayloadsForSession(stuck))[0],
        "and its payload was redacted in the same transaction",
      ).not.toHaveProperty("answers");
      const cancelledCount = cancelled.length;

      // 4. Fix the target through the UI, then redeliver ONE from the queue.
      await openWebhooks(page, FORM_ID);
      await webhookRow(page).getByRole("button", { name: "Change URL" }).click();
      const retarget = page.getByTestId("qcms-webhook-url-dialog");
      await retarget.getByRole("textbox", { name: "Endpoint URL" }).fill(consumer.url());
      await retarget.getByRole("button", { name: "Save the URL" }).click();
      await expect(webhookRow(page)).toContainText(consumer.url());

      await page.goto("/webhooks");
      const queue = page.getByTestId("qcms-dead-letters-table");
      // The cancelled delivery is OFF this queue (059): the queue is a worklist of rows
      // being offered back for redelivery, and a cancelled one may never be sent. No
      // exclusion selector is needed any more - before 059 this test had to compute one
      // so it would not press a button the API was about to refuse.
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
      // The button queues; it does not deliver, and the message says exactly that.
      await expect(page.getByTestId("qcms-redeliver-summary")).toHaveText(
        "1 delivery is queued for the next pass.",
      );

      // 5. The next pass delivers that one to the real consumer, signed for real.
      await deliverer.pass();
      expect(consumer.received.length, "the fixed consumer received the delivery").toBe(1);
      expect(consumer.received[0]?.headers["x-qcms-signature"]).toMatch(/^v1=[0-9a-f]{64}$/);

      await openWebhooks(page, FORM_ID);
      const deliveredRow = page
        .getByTestId("qcms-deliveries-table")
        .locator('[data-status="delivered"]');
      await expect(deliveredRow).toHaveCount(1);
      // Read from the DELIVERED row rather than the first row on screen: the table is
      // ordered by creation and the redelivered one is not necessarily at the top. A
      // first-time success after the reset shows zero FAILED attempts, which is what
      // that column counts (`markDeliveryDelivered` in @qcms/db explains why).
      await expect(deliveredRow.getByTestId("qcms-delivery-attempts")).toHaveText("0");

      // 6. Bulk redeliver takes everything that is left. Nothing is refused, because
      //    nothing refusable is on the queue any more - the erased session's row was
      //    removed from it by the cancellation rather than left on it to be pressed and
      //    rejected. That is the whole shape of the 059 change in one assertion.
      await page.goto("/webhooks");
      const remaining = queueAfterErasure - 1;
      await page.getByRole("button", { name: "Redeliver all" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Redeliver all of them" })
        .click();
      // Pluralised, because `remaining` is not a fixed number: it is whatever the
      // outbox held when this test drove its passes, and the axe sweep earlier in the
      // run now drains the backlog of submissions made before any endpoint existed
      // (issue #306). The screen says "1 delivery is" for one, and a hard-coded plural
      // here would fail on the count rather than on the behaviour.
      await expect(page.getByTestId("qcms-redeliver-summary")).toHaveText(
        remaining === 1
          ? "1 delivery is queued for the next pass."
          : `${String(remaining)} deliveries are queued for the next pass.`,
      );

      await deliverer.pass();
      expect(consumer.received.length, "every queued redelivery reached the consumer").toBe(
        queueAfterErasure,
      );

      // 7. The payload assertion this whole test exists for: nothing the consumer
      //    received names an erased session, or carries a redacted answer set. Same
      //    shape as the CSV assertion three tests up, pointed at the bytes that
      //    actually leave the deployment.
      for (const request of consumer.received) {
        for (const erasedSession of [erasable, stuck]) {
          expect(
            request.body,
            "an erased respondent's answers must never reach a consumer",
          ).not.toContain(erasedSession);
        }
      }

      // 8. The cancelled delivery is not hidden - it is on the dashboard with its
      //    status and the reason, which is where "what happened to that delivery" gets
      //    answered now that it is off the queue.
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

/** This spec's endpoint row, by the id read off it when it was created. */
function webhookRow(page: Page) {
  return page.getByTestId("qcms-webhooks-table").locator(`tr[data-webhook-id="${opsWebhookId}"]`);
}

/**
 * Erase one submitted response through the operator's own door (task 059).
 *
 * The same steps test 5 walks in full, minus its copy and disabled-state assertions:
 * this is used where the erasure is the *setup* for something else, and duplicating
 * those assertions would spread the dialog's contract across two places.
 */
async function eraseResponse(page: Page, sessionId: string): Promise<void> {
  await page.goto(`/forms/${FORM_ID}/responses/${sessionId}`);
  await page.getByRole("button", { name: "Erase respondent data…" }).click();
  const dialog = page.getByTestId("qcms-erase-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /Type the session id/ }).fill(sessionId);
  await dialog.getByRole("button", { name: "Erase permanently" }).click();
  await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
}
