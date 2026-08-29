import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  field,
  issueSummary,
  openFormDetails,
  pinQuestion,
  savedStamp,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * Both save models, named on the screens that use them (issue 518).
 *
 * The audit's §4.6 finding was that this app has two save models and names neither, and
 * that the cost of the silence is paid on the manual screen: an author who has learned the
 * builder saves itself assumes the question editor does too, and loses work. So the two
 * halves of this file are deliberately asymmetric. On the builder it checks that the
 * statement MOVED - out of the validation panel's live region, into persistent chrome, with
 * the panel left holding the issue count it is the sole authority for
 * (`plan/admin-ux-audit.md` §5.6). On the question editor it checks that a statement
 * EXISTS, visibly, and that no ambient "Saved" strip has appeared beside a Save button
 * (`plan/admin-design-contracts.md` §6).
 *
 * ## What is asserted here and what is asserted in Vitest
 *
 * ADR-23 puts behaviour at the highest layer that exists, which for an admin screen is
 * this one. But the third acceptance criterion - no screen in the app shows two different
 * save-state statements - is a property of every screen, and a browser test can only
 * speak for the ones it opens. `apps/admin/lib/save-model.test.ts` carries that half as a
 * source-level inventory; this file carries what an author actually sees.
 *
 * ## The strip is checked for what it does NOT say, too
 *
 * Element 7 wants save state out of the validation panel and §5.6 wants the panel to stay
 * the single authoritative issue count. Those pull against each other: the easy way to
 * satisfy the first is a status strip, and a status strip is exactly the thing that grows
 * an issue badge later. So the strip is asserted to carry none of the panel's vocabulary,
 * which is the assertion that fails the day someone helpfully adds "2 issues" to it.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("savemodel");

/** Ids are never reused (R6) and the harness database survives local runs, so slugs vary. */
const RUN = Date.now().toString(36);

/** Published in the first test, so the form has something to pin - and so it is frozen. */
const PINNED_SLUG = `e2e-save-model-pin-${RUN}`;
/** Left as a draft by the second test, which is the only state the editor is editable in. */
const DRAFT_SLUG = `e2e-save-model-draft-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

/** Set by the first test, which enrolls the account the second signs in with. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("the builder states one save model, in ambient chrome outside the validation panel", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // A form can only pin a PUBLISHED version (022), so the library is authored first.
  await createDraft(page, PINNED_SLUG, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createForm(page, `e2e-save-model-${RUN}`, "Save model");
  await addStep(page, "Only step");
  await pinQuestion(page, questionIdFor(PINNED_SLUG), 1);
  await waitForSaved(page);

  // The validation panel and the form's title are the FORM's, and pinning left the screen
  // on the step. The save strip is neither screen's - it is the builder's chrome, which is
  // most of what this test is about - so it stays visible across the switch either way.
  await openFormDetails(page);

  const strip = page.getByTestId("qcms-save-status");
  const panel = page.getByTestId("qcms-validation-status");

  // 1. The statement exists, is persistent chrome, and there is exactly one of it.
  await expect(strip).toHaveCount(1);
  await expect(strip).toBeVisible();
  // BEHIND A "?" SINCE 2026-08-26, which §6 is amended for in
  // `plan/admin-design-contracts.md`: "persistent chrome" was the letter, and the reason -
  // an author must not be able to assume the wrong save model - survives, because the
  // sentence is one press away on the screen it describes and beside the state it explains.
  // Asserted through that press rather than dropped: it still has to be reachable and it
  // still has to say what it always said.
  await expect(page.getByTestId("qcms-save-model")).toHaveCount(0);
  await page.getByRole("button", { name: "How does this screen save?" }).click();
  await expect(page.getByTestId("qcms-save-model")).toHaveText(
    "This draft saves automatically as you edit.",
  );
  await page.getByRole("button", { name: "How does this screen save?" }).click();

  // 2. It is OUTSIDE the validation panel, which is the whole of element 7's objection.
  //    Asserted as containment rather than as position, because "not in the panel" is the
  //    requirement and any layout satisfying it is fine.
  await expect(panel.getByTestId("qcms-save-state")).toHaveCount(0);
  await expect(strip.getByTestId("qcms-save-state")).toHaveCount(1);

  // 3. It is still ANNOUNCED. The region is the settled sentence only: the model sentence
  //    is static and the in-flight sentence is aria-hidden, both on purpose (churn), so
  //    this is the one live thing in the strip.
  await expect(strip.getByTestId("qcms-save-state")).toHaveAttribute("aria-live", "polite");
  await expect(strip.getByTestId("qcms-save-state")).toContainText(/^Last saved /);

  // 4. The timestamp is governed: date, HH:MM and the zone, no seconds
  //    (`plan/admin-design-contracts.md` §2, amended 2026-08-20).
  const sentence = (await strip.getByTestId("qcms-save-state").textContent()) ?? "";
  expect(sentence, "the saved-at time names its zone").toMatch(/UTC/u);
  expect(sentence, "no seconds: HH:MM only").not.toMatch(/\d{1,2}:\d{2}:\d{2}/u);

  // 5. The panel keeps the issue list and stays the only thing that counts issues.
  await expect(panel).toHaveAttribute("aria-live", "polite");
  await expect(issueSummary(page)).toHaveText("No issues. Everything here would pass a publish.");
  await expect(strip).not.toContainText(/issue/iu);

  // 6. And the strip announces a NEW save rather than going quiet. The machine-readable
  //    instant is the hook, because the sentence deliberately has minute granularity.
  const before = await savedStamp(page);
  await fillStable(field(page, "Form title"), "Save model, renamed");
  await waitForSaveAfter(page, before);
  expect(await savedStamp(page), "a second save moved the instant").not.toBe(before);
});

test("the question editor states its manual model, visibly, with no ambient strip", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // Creating: the mode where the loss is total, so it gets its own sentence.
  await page.goto("/questions/new");
  const note = page.getByTestId("qcms-manual-save-note");
  await expect(note).toHaveCount(1);
  await expect(note).toBeVisible();
  await expect(note).toContainText("This editor does not save automatically.");
  await expect(note).toContainText("Create draft");
  // A visible statement, not a tooltip: it is real text in the document, not a title.
  await expect(note).not.toHaveAttribute("title", /./u);

  // No ambient save chrome anywhere on a screen that has a Save button - contract §6, and
  // the confusion §4.6 warns about is precisely the two appearing together.
  await expect(page.getByTestId("qcms-save-status")).toHaveCount(0);
  await expect(page.getByTestId("qcms-save-state")).toHaveCount(0);

  // Editing: the same statement, naming the button this mode actually has. A draft is the
  // only state the editor is editable in, so this test makes its own rather than reusing
  // the first test's question, which is published and therefore frozen.
  await createDraft(page, DRAFT_SLUG, "Long text");
  await expect(page).toHaveURL(new RegExp(`/questions/${questionIdFor(DRAFT_SLUG)}`, "u"));
  await expect(page.getByTestId("qcms-manual-save-note")).toContainText(
    "This editor does not save automatically.",
  );
  await expect(page.getByTestId("qcms-manual-save-note")).toContainText("Save draft");
  await expect(page.getByTestId("qcms-save-status")).toHaveCount(0);

  // And a frozen version says nothing at all: it has no Save button, so contract §6's
  // read-only clause applies and a manual-model statement would be a claim about a control
  // that is not there.
  await page.goto(`/questions/${questionIdFor(PINNED_SLUG)}`);
  await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByTestId("qcms-manual-save-note")).toHaveCount(0);
  await expect(page.getByTestId("qcms-save-status")).toHaveCount(0);
});
