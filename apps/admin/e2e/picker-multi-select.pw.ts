import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  openStep,
  pickerChoice,
  pickerCommit,
  pinLabel,
  pinQuestion,
  pinQuestions,
  pinnedOrder,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * The add-question dialog adds several questions at once (issue 660).
 *
 * ## Why this is a browser spec and not a unit one
 *
 * The rules themselves are pure and are asserted directly in
 * `lib/forms/picker-selection.test.ts`. What cannot be asserted below the browser is that
 * the component is wired to them: the dialog is a react-aria `Dialog`, so
 * `renderToStaticMarkup` returns the empty string for its whole subtree (issue 628), and
 * this app has no jsdom layer in which to tick a checkbox. Selection is `useState` in a
 * portal, so a real browser is the only place a tick, a tally and a commit exist at once.
 *
 * ADR-23: e2e at the highest layer that exists for the thing under test. That is this.
 *
 * ## The library is authored rather than seeded
 *
 * One question is published TWICE, which is what the sibling-version test needs: a question
 * with v1 and v2 both pinnable, so choosing one can be seen to withdraw the other. The seed
 * carries no question in that shape, and every assertion below names its own run's ids, so
 * what else the library holds never enters into it.
 *
 * This used to say the seeded questions were unpinnable because the seed left every version
 * a DRAFT. That was true and was a bug (issue #275): the seed's own comment said it
 * published them. It publishes them now, so the reason above is the one that survives.
 *
 * ## One form, and the tests read as one author's session
 *
 * Serial, and each test leaves the step as the next expects it. The batch test is the one
 * that adds pins; the tests before it choose and unchoose without committing, which is
 * precisely the state that did not exist before this issue.
 *
 * ## Why the step starts with one pin in it rather than empty
 *
 * A step with no questions is an UNSAVEABLE draft (`unsaveableReason` returns "emptyStep"),
 * so the builder pauses its autosave and the step does not survive a navigation. Every
 * spec in this directory that waits for a save pins something first, and this one has to
 * as well. The anchor earns its place twice over: it is also the "Already in this form"
 * refusal, so each test below opens a picker that is already showing one row it cannot
 * choose.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("picker660");
const RUN = Date.now().toString(36).slice(-5);

const ANCHOR = `ms-anchor-${RUN}`;
const ALPHA = `ms-alpha-${RUN}`;
const BETA = `ms-beta-${RUN}`;
const GAMMA = `ms-gamma-${RUN}`;

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

const ANCHOR_ID = questionIdFor(ANCHOR);
const ALPHA_ID = questionIdFor(ALPHA);
const BETA_ID = questionIdFor(BETA);
const GAMMA_ID = questionIdFor(GAMMA);

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";
/** The builder path of the form the rest of this file edits. */
let builderPath = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("authors a library with a two-version question and a step to add into", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // ALPHA is published twice, so v1 and v2 are both pinnable and the one-pin-per-question
  // rule has something to act on.
  await createDraft(page, ALPHA, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");
  await page.waitForURL(/\?v=2$/);
  await confirmLifecycle(page, /^Publish version 2$/, "Publish");

  await createDraft(page, BETA, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, GAMMA, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, ANCHOR, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createForm(page, `picker-multi-${RUN}`, "Multi select");
  builderPath = new URL(page.url()).pathname;
  await addStep(page, "Only step");
  // The anchor, without which the step is an unsaveable draft and does not survive the
  // navigations the rest of this file makes.
  await pinQuestion(page, ANCHOR_ID, 1);
  await waitForSaved(page);
});

test("counts what is chosen, on the tally and on the button that will commit it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(builderPath);
  await openStep(page, "Only step");
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const tally = dialog.getByTestId("qcms-picker-chosen");

  // Nothing chosen: the pane is already on screen saying so, and the primary states what
  // the dialog is for without claiming a count it does not have.
  await expect(tally).toContainText("Chosen (0)");
  await expect(dialog.getByRole("button", { name: "Add questions to step" })).toBeDisabled();

  // One. The singular is a message of its own, not "1 questions".
  await pickerChoice(dialog, BETA_ID, 1).check();
  await expect(tally).toContainText("Chosen (1)");
  await expect(pickerCommit(dialog, 1)).toBeEnabled();

  // Three, which is the count the POC draws its primary with.
  await pickerChoice(dialog, GAMMA_ID, 1).check();
  await pickerChoice(dialog, ALPHA_ID, 2).check();
  await expect(tally).toContainText("Chosen (3)");
  await expect(pickerCommit(dialog, 3)).toBeEnabled();

  // Each entry names the pin it will create, so the pane is readable without the table.
  await expect(tally.getByRole("listitem")).toHaveCount(3);
  await expect(tally).toContainText(`${ALPHA_ID}@2`);

  // Nothing is committed: the dialog is dismissed, and the step is left holding only
  // the anchor for the next test.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a chosen version withdraws its siblings, and unchoosing gives them back", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(builderPath);
  await openStep(page, "Only step");
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Both versions of ALPHA are pinnable to begin with: the row IS the pin, so the picker
  // lists them separately.
  await expect(pickerChoice(dialog, ALPHA_ID, 1)).toBeVisible();
  await expect(pickerChoice(dialog, ALPHA_ID, 2)).toBeVisible();

  // Choosing v2 takes v1's control away rather than disabling it, and the State cell says
  // which version is holding the place. A form holds one pin per question, so leaving v1
  // tickable would promise a second pin the kernel refuses.
  await pickerChoice(dialog, ALPHA_ID, 2).check();
  await expect(pickerChoice(dialog, ALPHA_ID, 1)).toHaveCount(0);
  await expect(
    dialog.locator(`[data-picker-question="${ALPHA_ID}"][data-picker-version="1"]`),
  ).toContainText("Version 2 of this question is chosen");

  // Removing it from the pane, rather than by unticking the row, because the pane's own
  // control is the way back out of a choice whose row a search has hidden.
  await dialog
    .getByRole("button", { name: `Remove ${ALPHA_ID} version 2 from the chosen list` })
    .click();
  await expect(dialog.getByTestId("qcms-picker-chosen")).toContainText("Chosen (0)");
  await expect(pickerChoice(dialog, ALPHA_ID, 1)).toBeVisible();

  // FOCUS SURVIVES THE REMOVAL. The control that removes an entry lives inside it, so the
  // press destroys the element holding focus; without somewhere to send it, a keyboard
  // author lands on `document.body` and the dialog stops hearing Escape. The search field
  // is where it goes when the pane empties, and the Escape below is what would fail if it
  // did not - which is exactly how this was found.
  await expect(dialog.getByRole("textbox", { name: "Search" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a search that hides a chosen row does not unchoose it", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(builderPath);
  await openStep(page, "Only step");
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await pickerChoice(dialog, BETA_ID, 1).check();
  await dialog.getByRole("textbox", { name: "Search" }).fill(GAMMA);

  // The row is gone from the table and the choice is not gone with it. Without the pane
  // this state would be invisible, which is the pane's whole reason for existing.
  await expect(pickerChoice(dialog, BETA_ID, 1)).toHaveCount(0);
  await expect(dialog.getByTestId("qcms-picker-chosen")).toContainText("Chosen (1)");
  await expect(dialog.getByTestId("qcms-picker-chosen")).toContainText(`${BETA_ID}@1`);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("adds three questions in one trip, in the order they were chosen", async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(builderPath);
  await openStep(page, "Only step");

  // THE POINT OF THE ISSUE. Before this, three questions meant opening the dialog three
  // times. `pinQuestions` opens it once, ticks three boxes and presses one button.
  await pinQuestions(page, [
    { questionId: GAMMA_ID, version: 1 },
    { questionId: ALPHA_ID, version: 2 },
    { questionId: BETA_ID, version: 1 },
  ]);

  // Chosen order, not library order: the batch is folded into the draft from the insert
  // boundary outwards, so the author's sequence is what lands. A handler called once per
  // pin would have folded each one into the same stale draft and kept only the last, so
  // this assertion is also the regression test for that.
  // The anchor first, because the picker appends at the end of the step, then the three
  // in the order they were ticked.
  await expect
    .poll(async () => pinnedOrder(page))
    .toEqual([ANCHOR_ID, GAMMA_ID, ALPHA_ID, BETA_ID]);
  await expect(pinLabel(page, ALPHA_ID, 2)).toBeVisible();
  await waitForSaved(page);

  // A question now in the form is refused for a second pin, exactly as it was before.
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(pickerChoice(dialog, BETA_ID, 1)).toHaveCount(0);
  await expect(
    dialog.locator(`[data-picker-question="${BETA_ID}"][data-picker-version="1"]`),
  ).toContainText("Already in this form");
});
