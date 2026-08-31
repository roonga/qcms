import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  field,
  issueSummary,
  openFormDetails,
  openStep,
  pinQuestion,
  savedStamp,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * The builder reports what it has checked, and nothing else (issue 625).
 *
 * `components/forms/form-builder.tsx` seeds its issue list empty and its autosave effect
 * returns early until the author changes something, so the first dry run happens on the
 * first keystroke. Until then the count on screen was an initial value being rendered as a
 * verdict: "No issues. Everything here would pass a publish." beside the Publish button,
 * and `Issues: None` on every pin, on a form nothing had validated.
 *
 * ## Why this is a browser test and not only a component one
 *
 * Issue 518's neighbouring defect could only be seen below the browser, because a failed
 * server action is not reachable from a page gesture. This one is the opposite: it is the
 * ORDINARY path. Opening a form and reading it is the most common thing anybody does on
 * this screen, so the highest layer that exists for it (ADR-23) is the seeded end-to-end
 * one, and it is the layer that catches a regression arriving from anywhere in the stack -
 * the effect's guard, the seeded prop, the page's props, the copy.
 *
 * `components/forms/unvalidated-builder.test.tsx` and `validation-panel.test.tsx` hold the
 * state matrix, which is cheaper to enumerate there and includes a state (a check that
 * FAILED) no gesture can produce.
 *
 * ## The fixture is a seeded one, on purpose, and it is read here and not written
 *
 * `frm_unpublished_pins` is a form the harness seeds for this spec and nothing else: its
 * draft pins two question versions that were never published, so the API's dry run reports
 * two `UNPUBLISHED_QUESTION_PIN` issues against `stp_history`. That is the exact
 * contradiction this issue was filed on: the §7 rail badges `2 issues` for that step on
 * the other seven form screens while the builder's own panel said there were none. Both
 * halves are asserted below so the two cannot drift apart again.
 *
 * This spec used to read the shared insurance form, which carried the same two issues
 * **by accident**: the seed created its question versions and never published them, while
 * its own comment said it did (issue #275). Correcting that removed the fixture from under
 * this spec, which is how the borrowing came to light. The fixture is now deliberate, and
 * it is a fixture nothing else writes to: what is asserted here is a COUNT, so a second
 * writer would change it. Nothing below stores anything on it either - the first two tests
 * only read.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("validation625");
const RUN = Date.now().toString(36);

/**
 * This spec's own fixture, whose two pins name versions that were never published.
 *
 * Read from the harness rather than written down here, so the id cannot drift from the
 * seed that creates it (`apps/api/e2e/support/seed.ts`, `seedUnpublishedPinForm`). Read
 * inside a test rather than at module scope, as every other spec does: the fixtures file
 * is written by globalSetup, which runs after the test files are collected.
 */
function seededForm(): string {
  return readFixtures().unpublishedPinFormId;
}
/** The step those two pins live on. A constant of the seeded definition, not of the seed. */
const SEEDED_STEP = "stp_history";

const NOT_CHECKED = "This draft has not been checked yet.";
const ALL_CLEAR = "No issues. Everything here would pass a publish.";

/** Set by `beforeAll`; each test signs in again because serial tests share no context. */
let totpSecret = "";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

test("a draft with issues does not read as publish-ready before anything has checked it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/forms/${seededForm()}`);

  // THE BUILDER OPENS ON THE FORM, not on a step, since the two became separate screens on
  // 2026-08-26. The panel and the grid are on opposite sides of that split now, so this
  // reads each where it lives rather than expecting both at once.
  //
  // The panel, which `plan/admin-ux-audit.md` §5.6 makes the single authoritative count.
  await expect(issueSummary(page)).toContainText(NOT_CHECKED);
  await expect(issueSummary(page)).not.toContainText("would pass a publish");

  // The pin grid, which said the same thing one row at a time.
  await openStep(page, "Driving history");
  await expect(page.locator('[data-pin-issues="unchecked"]')).toHaveCount(2);
  await expect(page.locator('[data-pin-issues="none"]')).toHaveCount(0);

  // And the step rail, which has no zero to render and so says nothing. This is what
  // "the rail agrees with the panel" means in the unvalidated state: one surface states
  // that it has not checked, and the others make no claim at all.
  await expect(page.locator("[data-step-issues]")).toHaveCount(0);
});

test("the §7 rail's count and the builder's silence are about the same draft", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // The other half of the contradiction. This screen validates server-side, so it has a
  // verdict and badges it; the builder has none and says so. Neither of them claims zero,
  // which is the property that makes the pair readable.
  await page.goto(`/forms/${seededForm()}/versions`);
  const badge = page.locator(`[data-rail-item="step:${SEEDED_STEP}"] [data-rail-issues]`);
  await expect(badge).toHaveAttribute("data-rail-issues", "2");
});

test("a stored, checked, clean draft still says it has not been checked after a reload", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // A form of this run's own, because everything below this line writes.
  const questionSlug = `e2e-idle-${RUN}`;
  await createDraft(page, questionSlug, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createForm(page, `idle-${RUN}`, "Untouched draft");
  await addStep(page, "Only step");
  await pinQuestion(page, `q_${questionSlug.replaceAll("-", "_")}`, 1);
  await waitForSaved(page);

  // A real verdict of zero, which is the sentence this fix had to leave reachable. The
  // grid belongs to the step and the panel to the form, so each is read on its own screen.
  await expect(page.locator('[data-pin-issues="none"]')).toHaveCount(1);
  await openFormDetails(page);
  await expect(issueSummary(page)).toHaveText(ALL_CLEAR, { timeout: 30_000 });

  // The same draft, stored and clean, one reload later. The state is about whether a check
  // has run this visit, not about whether the draft reached the server: a fresh page has
  // asked nobody anything, so it says so rather than repeating the last visit's verdict.
  await page.reload();
  await expect(issueSummary(page)).toContainText(NOT_CHECKED);
  await openStep(page, "Only step");
  await expect(page.locator('[data-pin-issues="unchecked"]')).toHaveCount(1);

  // And the first change puts a real count back, so the absence is a state rather than a
  // latch. One edit, and the panel and the grid both speak again.
  const before = await savedStamp(page);
  await openFormDetails(page);
  await fillStable(field(page, "Form title"), "Untouched draft, renamed");
  await waitForSaveAfter(page, before);
  await expect(issueSummary(page)).toHaveText(ALL_CLEAR, { timeout: 30_000 });
  await openStep(page, "Only step");
  await expect(page.locator('[data-pin-issues="none"]')).toHaveCount(1);
});
