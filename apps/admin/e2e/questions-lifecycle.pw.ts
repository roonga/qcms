import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addOption,
  chooseType,
  confirmLifecycle,
  createDraft,
  field,
  fillDate,
  optionIds,
} from "./support/questions.js";

/**
 * The question library, driven through the browser (task 032, exit criteria 1 and 2).
 *
 * The centrepiece is a full lifecycle walk over **all seven question types**: create a
 * draft, publish it, open version 2, deprecate version 1. Seven types is not thoroughness
 * for its own sake - each renders a different constraint panel and compiles to a different
 * A2UI control, so a type-specific break (a panel that throws, a definition shape the
 * kernel refuses) is invisible to a walk that only exercises short text. It has to be a
 * browser test rather than a slice test because what is under examination is the assembly:
 * an editor holding a document, a server action forwarding it, the kernel judging it, and
 * the answer landing back on the right field.
 *
 * Everything runs in one signed-in session rather than one per type. Enforced 2FA makes a
 * sign-in three navigations plus a TOTP generation, so seven of them would cost more wall
 * clock than the assertions they carry.
 *
 * `fillStable` everywhere rather than `fill`, for the reason issue #210 records: under
 * `next dev` a route compiled on demand can replace the document after Playwright has
 * typed into it, and the empty required field that results fails a silent browser
 * constraint check much later, as a timeout on a screen the test thought it had left.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("questions");

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/**
 * A per-run slug suffix.
 *
 * Question ids are never reused (R6) and the harness database can be reused across local
 * runs, so a fixed slug would make the second run fail with `QUESTION_ID_REUSED` on a
 * screen that is working perfectly. This makes each run's ids its own.
 */
const RUN = Date.now().toString(36);

/** The seven types, by the label the picker shows. */
const TYPES = [
  { slug: "short-text", label: "Short text" },
  { slug: "long-text", label: "Long text" },
  { slug: "number", label: "Number" },
  { slug: "date", label: "Date" },
  { slug: "boolean", label: "Yes or no" },
  { slug: "single-choice", label: "Single choice" },
  { slug: "multi-choice", label: "Multiple choice" },
] as const;

function slugFor(name: string): string {
  return `e2e-${name}-${RUN}`;
}

function questionIdFor(name: string): string {
  return `q_${slugFor(name).replaceAll("-", "_")}`;
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** Create, publish, branch a new version, and deprecate one question of a given type. */
async function walkLifecycle(page: Page, types: readonly { slug: string; label: string }[]) {
  for (const type of types) {
    await createDraft(page, slugFor(type.slug), type.label);
    await expect(page.getByRole("heading", { name: questionIdFor(type.slug) })).toBeVisible();
    // A brand-new question is a draft, and the badge says so in words rather than in
    // colour (the a11y requirement, asserted rather than assumed).
    await expect(page.locator(".qcms-tag").first()).toHaveText("Draft");

    await confirmLifecycle(page, /^Publish version 1$/, "Publish");
    await expect(page.getByRole("link", { name: /Version 1/ })).toContainText("Published");

    await confirmLifecycle(page, /^New version$/, "Create draft");
    await page.waitForURL(/\?v=2$/);
    await expect(page.getByRole("link", { name: /Version 2/ })).toContainText("Draft");

    // Deprecation is a property of the published version, so it happens on v1's screen.
    await page.goto(`/questions/${questionIdFor(type.slug)}?v=1`);
    await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");
    await expect(page.getByRole("link", { name: /Version 1/ })).toContainText("Deprecated");
    // Nothing was deleted: v2 is still there, still a draft (R6).
    await expect(page.getByRole("link", { name: /Version 2/ })).toContainText("Draft");
  }
}

test("the whole lifecycle works for the text, number and date types", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await walkLifecycle(page, TYPES.slice(0, 4));
});

test("the whole lifecycle works for the boolean and choice types", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await walkLifecycle(page, TYPES.slice(4));
});

test("option ids survive a relabel and a reorder (exit criterion 2)", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("options"), "Single choice");
  await addOption(page, "Green");

  // The ids as minted, and they are minted from the labels the options were added with.
  // Everything after this asserts they are still exactly these, in whatever order the
  // options have been moved into.
  const minted = await optionIds(page);
  expect(minted).toEqual(["opt_yes_always", "opt_no_never", "opt_green"]);

  await fillStable(field(page, "Label for option 1"), "Crimson");
  expect(await optionIds(page)).toEqual(minted);

  await page.getByRole("button", { name: "Move option 1 down" }).click();
  expect(await optionIds(page)).toEqual([minted[1], minted[0], minted[2]]);

  await page.getByRole("button", { name: "Move option 3 up" }).click();
  expect(await optionIds(page)).toEqual([minted[1], minted[2], minted[0]]);

  // The label that travelled with the first minted id is the assertion that catches a
  // reorder implemented over labels rather than over whole options.
  await expect(field(page, "Label for option 3")).toHaveValue("Crimson");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // And they are still the same ids after a round trip through the API and the database,
  // which is the property every rule and every stored answer depends on.
  await page.reload();
  expect(await optionIds(page)).toEqual([minted[1], minted[2], minted[0]]);
  await expect(field(page, "Label for option 3")).toHaveValue("Crimson");
});

test("the version preview renders the real control for the type", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, slugFor("preview"), "Long text");

  // The preview is compiled by the API and drawn by the shared renderer, so what appears
  // here is literally the control a respondent gets: a long-text question compiles to a
  // TextArea, which is a textbox carrying the question's label.
  const preview = page.locator(".qcms-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("textbox", { name: "E2E Long text question" })).toBeVisible();
  // No abuse decoy in a preview: the honeypot belongs to a respondent-facing step.
  await expect(preview.locator("[name^=qcms_]")).toHaveCount(0);
});

test("errors from the API are readable, and land on the field that caused them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Scoped to the page content: Next renders its own empty `role="alert"` route announcer
  // outside `<main>`, so an unscoped `getByRole("alert")` is a strict-mode violation on
  // every screen in the app.
  const alert = page.getByRole("main").getByRole("alert");

  // 1. A kernel rejection, addressed by path: shortest above longest is
  //    MIN_LENGTH_ABOVE_MAX_LENGTH at ["constraints","minLength"], so it has to appear on
  //    the "Shortest answer" field rather than as a banner with no home.
  await createDraft(page, slugFor("invalid"), "Short text");
  await fillStable(field(page, "Shortest answer"), "10");
  await fillStable(field(page, "Longest answer"), "5");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(alert).toContainText("The engine rejected this draft");
  await expect(field(page, "Shortest answer")).toHaveAttribute("aria-invalid", "true");

  // 2. R6 in the one place an author meets it: a slug that resolves to an id already used.
  //    The two slugs differ, the ids do not.
  await page.goto("/questions/new");
  await fillStable(field(page, "Slug"), slugFor("invalid").replaceAll("-", "_"));
  await fillStable(field(page, "Label"), "Duplicate id");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(alert).toContainText("never reused");

  // 3. VERSION_IMMUTABLE, reached the way an author actually reaches it: two tabs on the
  //    same draft, one of which publishes it. The stale tab still shows a live editor, and
  //    its save has to explain the rule rather than fail silently.
  await createDraft(page, slugFor("immutable"), "Short text");
  const stale = page.url();
  const other = await page.context().newPage();
  await other.goto(stale);
  await confirmLifecycle(other, /^Publish version 1$/, "Publish");
  await other.close();

  await fillStable(field(page, "Label"), "Edited after publish");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(alert).toContainText("frozen");
  await expect(alert).toContainText("new version");
});

test("the list filters, and says something useful when it finds nothing", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/questions");
  await expect(page.getByRole("heading", { name: "Questions", level: 1 })).toBeVisible();
  await expect(page.getByRole("grid", { name: "Question library" })).toBeVisible();

  // A search that matches nothing is a different state from an empty library, and says so:
  // suggesting the seed command to someone whose library is full would be noise.
  await fillStable(field(page, "Search"), `no-such-question-${RUN}`);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No question matches this search.")).toBeVisible();

  // The filter lives in the URL, so it is a place an author can link to.
  await expect(page).toHaveURL(/[?&]q=no-such-question/);

  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByRole("grid", { name: "Question library" })).toBeVisible();
});

test("the type column and the type filter narrow the library (issue #218)", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  // Scoped to this run's questions, so the assertions do not depend on what else the
  // harness database happens to hold.
  await page.goto(`/questions?q=e2e-number-${RUN}`);
  const numberRow = page.getByRole("row").filter({ hasText: questionIdFor("number") });
  await expect(numberRow).toContainText("Number");

  // The filter is the API's, so it has to survive the round trip rather than hide rows
  // client-side: the date question exists and matches the search, and must still be gone.
  await page.goto(`/questions?q=e2e-&type=date`);
  await expect(page.getByRole("row").filter({ hasText: questionIdFor("date") })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: questionIdFor("number") })).toHaveCount(0);

  // And it is reachable from the toolbar, not just from a hand-written URL.
  await page.goto("/questions");
  const picker = page.getByRole("button", { name: /Type$/ });
  await picker.click();
  await page.getByRole("option", { name: "Yes or no", exact: true }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/[?&]type=boolean/);
  await expect(page.getByRole("row").filter({ hasText: questionIdFor("number") })).toHaveCount(0);
});

test("a row opens its question from the keyboard alone", async ({ page }) => {
  // Not an axe check: axe cannot tell whether a row is *reachable*. The vendored table's
  // rows are the navigation, so if they are not keyboard-operable the library has no
  // keyboard-accessible way in at all.
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/questions?q=${slugFor("preview")}`);

  const row = page.getByRole("row").nth(1);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(questionIdFor("preview")));
});

/*
 * The coverage gap behind issue #220, in two halves.
 *
 * The lifecycle walk above publishes every type with an *empty* constraint panel, so no
 * spec ever rendered a frozen version whose constraint controls carry saved values - and a
 * frozen panel is the one place those controls are disabled. A fault that needs both
 * (disabled *and* valued) was invisible to the whole suite while being reproducible by
 * hand. The two halves are separate tests rather than one so a failure names the control
 * that produced it: the numeric panel and the date panel are different vendored components
 * with different controlled-state behaviour.
 */

test("a frozen number version renders cleanly with its bounds saved", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await createDraft(page, slugFor("frozen-number"), "Number");
  await fillStable(field(page, "Smallest value"), "1");
  await fillStable(field(page, "Largest value"), "10");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // The bounds are still on screen after the save. React 19 resets a form once its action
  // resolves, and this editor is controlled, so an un-prevented reset used to hand every
  // constraint control back its mount-time value here - silently for a NumberField, whose
  // empty state is a number (`NaN`) rather than an absent value. The author saw "Draft
  // saved." over an editor that had quietly emptied itself, and the next save would have
  // written that emptiness over the stored document.
  await expect(field(page, "Smallest value")).toHaveValue("1");
  await expect(field(page, "Largest value")).toHaveValue("10");

  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  // The hard navigation is the point: a client-side link would never server-render this
  // screen, so only `goto` puts the frozen panel through hydration.
  await page.goto(`/questions/${questionIdFor("frozen-number")}?v=1`);
  await expect(field(page, "Smallest value")).toHaveValue("1");
  await expect(field(page, "Smallest value")).toBeDisabled();
});

test("a frozen date version renders cleanly with its bounds saved", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await createDraft(page, slugFor("frozen-date"), "Date");
  await fillDate(page, "Earliest date", "01012030");
  await fillDate(page, "Latest date", "12312030");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  // Both dates survive the save. This is the loud half of the same fault: a DatePicker's
  // empty state is an absent value, so the reset also flipped it from controlled to
  // uncontrolled and react-stately said so on the console - which is how issue #220's
  // console fault was reachable at all.
  await expect(page.getByRole("group", { name: "Earliest date" })).toContainText("1/1/2030");
  await expect(page.getByRole("group", { name: "Latest date" })).toContainText("12/31/2030");

  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await page.goto(`/questions/${questionIdFor("frozen-date")}?v=1`);
  await expect(page.getByRole("group", { name: "Earliest date" })).toContainText("2030");
});

test("the type picker is locked once the question exists", async ({ page }) => {
  // R6 made visible: after creation the picker is gone entirely, replaced by a sentence
  // that says why. A screen that merely disabled it would leave an author waiting for it
  // to become enabled.
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/questions/${questionIdFor("preview")}`);
  await expect(page.getByRole("button", { name: /Type$/ })).toHaveCount(0);
  await expect(page.getByText("Type is locked to Long text.")).toBeVisible();

  // And the creation screen still offers it, so the assertion above is about this screen
  // rather than about a picker that stopped rendering everywhere.
  await page.goto("/questions/new");
  await chooseType(page, "Date");
});
