import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { field, openPanel, setNumericConstraint } from "./support/questions.js";
import { createQuestionRailFixture, type QuestionRailFixture } from "./support/question-rail.js";

/**
 * The question detail screen's rail in a browser (issue 650, built to
 * `plan/admin-shell-poc/question-editor-poc.html`).
 *
 * The markup and the contents are pinned without a browser
 * (`components/questions/question-versions-rail.test.tsx`,
 * `lib/questions/version-rail.test.ts`). What is left is everything that is a computed
 * style, a measured box, a navigation or a thing rendered by two React trees at once, and
 * that is what this file is: the 240px track appearing at `--bp-sidebar` and not one pixel
 * below it, the collapsed-only version indicator, the marked row agreeing with the editor
 * beside it, the version list no longer being on this screen twice, and the lifecycle
 * actions still working from where the POC puts them.
 *
 * ## The panel rows, the details group and the back link (Code Owner, 2026-09-27)
 *
 * The rail also switches which panel of the editor the column shows, states the question's own
 * details, and carries the way back. `lib/questions/panels.test.ts` pins which panels a document
 * has and `components/questions/question-versions-rail.test.tsx` pins the markup;
 * `components/questions/question-editor-panels.test.tsx` drives the switch and the refused-save
 * focus in jsdom. What is left for a browser is what those three cannot see: the row and the
 * column being **two server-rendered trees agreeing on first paint**, a reload landing back on
 * the panel the address names, and the switch working while the rail is a shut disclosure at
 * 390px.
 *
 * ## The 1023 / 1024 pair
 *
 * Same shape `rail.pw.ts` takes and for the same reason: a boundary is only pinned by
 * measuring both sides of it, so a rail that collapsed at 1000 or at 1100 would be a third
 * breakpoint nobody wrote down.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("qrail650");
const RUN = Date.now().toString(36);

/** `--bp-sidebar` is 64rem, and the browser's default root size makes that 1024px. */
const SIDEBAR = 1024;

/** Set by the first test; every later one signs in and reuses the fixture it built. */
let totpSecret = "";
let fixture: QuestionRailFixture = {
  questionId: "",
  draftVersion: 0,
  publishedVersion: 0,
  deprecatedVersion: 0,
};

function detailPath(query = ""): string {
  return `/questions/${fixture.questionId}${query}`;
}

/** The boxes the geometry assertions are about, read in one round trip. */
async function boxes(page: Page): Promise<{
  readonly railWidth: number;
  readonly railRight: number;
  readonly mainLeft: number;
  readonly mainTop: number;
}> {
  return page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-question-rail"]');
    const main = document.querySelector("main#main-content");
    if (rail === null || main === null) throw new Error("the rail and the column must both exist");
    const railBox = rail.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    return {
      railWidth: railBox.width,
      railRight: railBox.right,
      mainLeft: mainBox.left,
      mainTop: mainBox.top,
    };
  });
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("650 puts a 240px version rail beside the column at --bp-sidebar, and above it below", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  fixture = await createQuestionRailFixture(page, RUN);

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto(detailPath());
  await expect(page.getByTestId("qcms-question-rail")).toBeVisible();
  const at = await boxes(page);
  expect(at.railWidth, "the rail is the same 240px track the other two rails take").toBe(240);
  expect(at.railRight, "the rail is beside the content column, not over it").toBeLessThanOrEqual(
    at.mainLeft,
  );

  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto(detailPath());
  const below = await boxes(page);
  expect(below.railWidth, "one pixel below the boundary it is full width").toBe(SIDEBAR - 1);
  expect(below.mainTop, "and the column is stacked under it rather than beside it").toBeGreaterThan(
    0,
  );
});

test("650 shows which version is selected in the summary only while the rail is shut and narrow", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  const indicator = page.locator(".qcms-question-rail__summary-version");

  // SHUT ON ARRIVAL at this width since 2026-08-23, which is why this reads the other way
  // round from the order the POC's own description implies: the indicator is the first
  // thing on screen rather than something a reader has to collapse the rail to see. That
  // makes it carry more weight than it used to, not less.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));
  const disclosure = page.locator("details.qcms-rail__disclosure");
  await expect(disclosure, "a narrow viewport opens on the summary alone").not.toHaveAttribute(
    "open",
    "",
  );
  await expect(indicator, "shut, this line is the whole rail").toBeVisible();
  await expect(indicator).toHaveText(`/Version ${String(fixture.publishedVersion)}`);

  await page.locator("summary.qcms-rail__summary").click();
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(indicator, "open, the list below already says which row is current").toBeHidden();

  // Above the boundary the rail is a permanent sidebar, so the same indicator would only
  // repeat the marked row that is already on screen.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));
  await expect(indicator).toBeHidden();
});

test("650 marks the row the address selects, and the editor beside it shows that version", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  // Scoped to the version rows: the rail marks a PANEL row current too, and the topbar marks
  // the area's nav link, so an unscoped `[aria-current]` is three different statements.
  const marked = page.locator('[data-rail-version][aria-current="page"]');
  await expect(marked, "exactly one version row is current").toHaveCount(1);
  await expect(marked).toHaveAttribute("data-rail-version", String(fixture.draftVersion));

  // The rail and the screen are two React trees rendered from one URL. This is the assertion
  // that they read it through the same function: a click on a row moves both.
  await page.locator(`[data-rail-version="${String(fixture.publishedVersion)}"]`).click();
  await page.waitForURL(new RegExp(`\\?v=${String(fixture.publishedVersion)}$`, "u"));
  await expect(
    page.locator('[data-rail-version][aria-current="page"]'),
    "the rail follows the address",
  ).toHaveAttribute("data-rail-version", String(fixture.publishedVersion));
  await expect(
    page.getByRole("heading", {
      name: `Version ${String(fixture.publishedVersion)}`,
      exact: true,
    }),
    "and so does the editor",
  ).toBeVisible();
});

test("650 spells out each version's status and digests the group above them", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  await expect(rail.locator(".qcms-question-rail__digest")).toHaveText(
    `3 versions, v${String(fixture.publishedVersion)} published`,
  );
  const row = (version: number) => rail.locator(`[data-rail-version="${String(version)}"]`);
  await expect(row(fixture.draftVersion).locator(".qcms-tag")).toHaveAttribute(
    "data-status",
    "draft",
  );
  await expect(row(fixture.publishedVersion).locator(".qcms-tag")).toHaveAttribute(
    "data-status",
    "published",
  );
  await expect(row(fixture.deprecatedVersion).locator(".qcms-tag")).toHaveAttribute(
    "data-status",
    "deprecated",
  );
});

test("650 leaves the version list on this screen exactly once", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  // The regression this guards is the one the rail was built to avoid: a navigation rendered
  // twice on one screen is two lists that can disagree and two sets of links to walk. The
  // card this replaced lived in the content column, so the column is where it is looked for.
  await expect(
    page.getByRole("navigation", { name: `Versions of ${fixture.questionId}` }),
    "one version navigation on the screen",
  ).toHaveCount(1);
  await expect(
    page.locator(`main#main-content a[href*="?v="]`),
    "and no second copy of its rows in the content column",
  ).toHaveCount(0);
});

test("650 keeps the lifecycle actions working from the rail the POC puts them in", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  // Pinned ABOVE the list, which is the POC's own reason for putting them there: the list is
  // the one thing on this screen that grows without bound.
  const actionsBottom = await rail
    .locator(".qcms-question-rail__lifecycle")
    .evaluate((element) => element.getBoundingClientRect().bottom);
  const listTop = await rail
    // `.first()` because the rail now nests a second group inside the selected version's row -
    // the editor's panels - and the one this is about is the version list itself.
    .locator(".qcms-rail__group")
    .first()
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(actionsBottom).toBeLessThanOrEqual(listTop);

  // The buttons are the version's, not the question's: the draft offers Publish, and the
  // published version offers Deprecate instead.
  await expect(
    rail.getByRole("button", { name: `Publish version ${String(fixture.draftVersion)}` }),
  ).toBeVisible();
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));
  await expect(
    rail.getByRole("button", { name: `Deprecate version ${String(fixture.publishedVersion)}` }),
  ).toBeVisible();
  await expect(rail.getByRole("button", { name: "New version" })).toBeVisible();
});

test("2026-09-27 nests the editor's panels under the selected version, and switches the column", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  // ONE SET OF ROWS, UNDER THE SELECTED VERSION. The editor shows one version, so rows under
  // every version would be rows that cannot do what they say.
  await expect(rail.locator("[data-rail-panel]")).toHaveCount(3);
  const selectedRow = rail.locator(`[data-rail-version="${String(fixture.draftVersion)}"]`);
  await expect(
    // `data-rail-group="panels"` is the builder's own group attribute, which this list took
    // with the rest of that rail's styling on 2026-09-27.
    selectedRow.locator('xpath=following-sibling::ul[@data-rail-group="panels"]'),
    "the panels are the selected row's own children",
  ).toHaveCount(1);

  // The fixture is a short-text question, so Content, Constraints and Preview and nothing
  // else: no options to list, and no message key until a constraint or `required` gives it
  // one. Preview is LAST, after everything the author can edit.
  await expect(rail.locator('[data-rail-panel="content"]')).toBeVisible();
  await expect(rail.locator('[data-rail-panel="constraints"]')).toBeVisible();
  await expect(rail.locator('[data-rail-panel="preview"]')).toBeVisible();
  await expect(rail.locator('[data-rail-panel="options"]')).toHaveCount(0);
  await expect(rail.locator('[data-rail-panel="messages"]')).toHaveCount(0);
  await expect(rail.locator("[data-rail-panel]").last()).toHaveAttribute(
    "data-rail-panel",
    "preview",
  );

  // FIRST PAINT, BEFORE ANY PRESS: the marked row and the rendered panel are two trees reading
  // one address through one function, so they agree with nothing having hydrated.
  await expect(rail.locator('[data-rail-panel="content"]')).toHaveAttribute("aria-current", "page");
  await expect(field(page, "Label")).toBeVisible();
  await expect(field(page, "Shortest answer")).toHaveCount(0);

  await openPanel(page, "constraints");
  await expect(field(page, "Shortest answer")).toBeVisible();
  await expect(field(page, "Label"), "one panel at a time").toHaveCount(0);
  await expect(rail.locator('[data-rail-panel="content"]')).not.toHaveAttribute(
    "aria-current",
    "page",
  );

  // THE ADDRESS FOLLOWED, so a reload keeps the panel rather than dropping the author back on
  // Content. Replaced rather than pushed: the panels are one screen's worth of one question.
  await expect(page).toHaveURL(/panel=constraints/u);
  await page.reload();
  await expect(field(page, "Shortest answer")).toBeVisible();

  // And a digest that follows the live document: setting a bound grows a Validation messages
  // row without a save or a round trip.
  await setNumericConstraint(page, "Shortest answer", "4");
  await expect(rail.locator('[data-rail-panel="messages"]')).toBeVisible();
  await expect(rail.locator('[data-rail-panel="constraints"]')).toContainText("min 4");
});

test("2026-09-27 switches a panel while the rail is a shut disclosure at 390px", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Below `--bp-sidebar` the rail opens shut, so the rows are behind a summary. This is the
  // width at which "the rail carries the panel switch" is most easily got wrong, and the
  // editor's own refused-save path is written not to depend on the rail for exactly this
  // reason.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(detailPath());
  await expect(page.locator("details.qcms-rail__disclosure")).not.toHaveAttribute("open", "");

  await openPanel(page, "constraints");
  await expect(field(page, "Shortest answer")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("2026-09-27 states the question's details in the rail and the way back above them", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  const details = rail.locator(".qcms-question-rail__details");
  await expect(details).toContainText("Slug");
  await expect(details).toContainText(`e2e-qrail-${RUN}`);
  await expect(details).toContainText("Created");
  // Stated once, with its locked status, and never inside the editor it constrains (R6).
  await expect(details).toContainText("Short text (locked)");
  await expect(page.getByRole("main")).not.toContainText("Type is locked to");
  // And not left behind in the column either: a fact rendered twice is two surfaces to keep
  // equal, which is the rule that kept the version list out of this column in issue 650.
  await expect(page.getByRole("main")).not.toContainText("Slug:");

  // The way back is in the rail and ABOVE the disclosure, so it survives the collapse: inside
  // the body it would be reachable only by expanding a navigation first.
  const back = rail.getByRole("link", { name: "Back to questions" });
  await expect(back).toBeVisible();
  const backBottom = await back.evaluate((element) => element.getBoundingClientRect().bottom);
  const disclosureTop = await page
    .locator("details.qcms-rail__disclosure")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(backBottom).toBeLessThanOrEqual(disclosureTop);
  await expect(page.getByRole("main").getByRole("link", { name: "Back to questions" })).toHaveCount(
    0,
  );

  await page.setViewportSize({ width: 390, height: 900 });
  await expect(back, "still the first thing on screen with the rail shut").toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("2026-09-27 keeps Save in the column, reachable without scrolling to the end", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto(detailPath());

  // NOT IN THE RAIL, deliberately: the rail collapses to a shut disclosure below
  // `--bp-sidebar`, so a Save button inside it would be a save an author has to expand a
  // navigation to reach. It is the version card's sticky footer instead.
  await expect(
    page.getByTestId("qcms-question-rail").getByRole("button", { name: "Save draft" }),
  ).toHaveCount(0);
  const save = page.getByRole("main").getByRole("button", { name: "Save draft" });
  await expect(save).toBeVisible();
  // The manual save model travels with it (issue 518, contract §6).
  await expect(page.getByTestId("qcms-manual-save-note")).toBeVisible();

  const stuck = await page
    .locator(".qcms-question-editor__footer")
    .evaluate((element) => getComputedStyle(element).position);
  expect(stuck, "sticky rather than the last thing in a tall form").toBe("sticky");

  // Still on screen from the top of the form, which is the whole point of the move.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await expect(save).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("2026-09-27 badges the panel a refused save names, and lands focus in it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  // A refusal the kernel addresses by path: shortest above longest is
  // MIN_LENGTH_ABOVE_MAX_LENGTH at ["constraints","minLength"]. Written from the CONTENT panel,
  // so the interesting half is reachable - the editor has to move the author to a panel they
  // were not looking at.
  await openPanel(page, "constraints");
  await setNumericConstraint(page, "Shortest answer", "10");
  await setNumericConstraint(page, "Longest answer", "5");
  await openPanel(page, "content");

  await page.getByRole("main").getByRole("button", { name: "Save draft" }).click();

  const rail = page.getByTestId("qcms-question-rail");
  await expect(rail.locator('[data-rail-panel="constraints"] [data-rail-issues]')).toHaveText(
    "1 issue",
  );
  await expect(
    rail.locator('[data-rail-panel="content"] [data-rail-issues]'),
    "a panel with nothing refused carries no all-clear either",
  ).toHaveCount(0);
  // The author was moved to the panel that has to be fixed, and focus is on the field rather
  // than merely an error beside it.
  await expect(field(page, "Shortest answer")).toBeFocused();
  await expect(field(page, "Shortest answer")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/panel=constraints/u);
});

test("2026-09-27 opens the same panels on a frozen version, read-only", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}&panel=constraints`));

  // The same rows and the same panels, which is the rule this screen has applied to the editor
  // since task 032: an author sees the identical layout whether or not they can type in it.
  await expect(
    page.getByTestId("qcms-question-rail").locator('[data-rail-panel="constraints"]'),
  ).toHaveAttribute("aria-current", "page");
  await expect(field(page, "Shortest answer")).toBeDisabled();
  // And nothing to save, so contract §6's read-only clause applies: no footer at all.
  await expect(page.locator(".qcms-question-editor__footer")).toHaveCount(0);
});

test("2026-09-27 makes the preview the last panel, showing what was last saved", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  // NOT ON SCREEN UNTIL IT IS ASKED FOR. The preview was a card above the editor whatever the
  // author was doing; it is a panel like the others now, so the column shows one thing.
  await expect(page.locator(".qcms-preview")).toHaveCount(0);

  await openPanel(page, "preview");
  await expect(page.locator(".qcms-preview")).toBeVisible();
  // Its own theme and mode controls come with it (task 058's island), and the editing fields
  // do not: the column shows the selected panel and nothing else.
  await expect(page.getByTestId("qcms-preview-switcher")).toBeVisible();
  await expect(field(page, "Label")).toHaveCount(0);
  await expect(
    page.getByRole("main").getByRole("button", { name: "Save draft" }),
    "a panel with nothing to save says nothing (contract 6)",
  ).toHaveCount(0);

  // IT SHOWS WHAT WAS SAVED, AND SAYS SO WHEN THAT IS BEHIND. The preview is compiled by the
  // API from the stored version, so an edit that has not been saved cannot be in it - which
  // is a sentence the panel only carries while it is true.
  await expect(page.getByText(/last saved/u)).toHaveCount(0);
  await openPanel(page, "content");
  await field(page, "Label").fill("Edited but not saved");
  await openPanel(page, "preview");
  await expect(page.getByText(/last saved/u)).toBeVisible();
  // And the document survived the walk between panels: it lives in the editor's state rather
  // than in the DOM the panel switch replaced.
  await openPanel(page, "content");
  await expect(field(page, "Label")).toHaveValue("Edited but not saved");
});
