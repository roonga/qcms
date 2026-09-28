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

test("2026-09-29 collapses to the question id alone, with the version on the heading", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  /*
   * The retirement of issue 650's collapsed-only "/ Version 2" indicator (Code Owner,
   * 2026-09-29).
   *
   * That indicator earned its place while this line was the whole rail at 390 and the selected
   * version was the one thing a reader could not otherwise get. The screen's `<h1>` names the
   * version since 2026-09-28, directly under the summary, so at 390 the two sat stacked saying
   * the same thing. The summary shows what the rail belongs to and nothing else, the way the form
   * rail's does.
   *
   * Both halves are asserted, because deleting the indicator is only right while the heading
   * carries the version: a later change that took it out of the `<h1>` would leave a shut rail at
   * 390 naming no version at all, and this is where that would be caught.
   */
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));

  const disclosure = page.locator("details.qcms-rail__disclosure");
  await expect(disclosure, "a narrow viewport opens on the summary alone").not.toHaveAttribute(
    "open",
    "",
  );

  const summary = page.locator("summary.qcms-rail__summary");
  await expect(summary, "the summary is the question id").toContainText(fixture.questionId);
  await expect(
    summary,
    "and says nothing about the version, which the heading below it carries",
  ).not.toContainText("Version");

  // The heading is where the version is read at this width, and it is one row above.
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toContainText(
    `Version ${String(fixture.publishedVersion)}`,
  );

  // Above the boundary nothing about the summary changes: it was never the version's home there
  // either, because the marked row is on screen.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));
  await expect(summary).not.toContainText("Version");
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
  // The screen's ONE heading names the question and the version together (Code Owner,
  // 2026-09-28). The card's own "Version N" `<h2>` is gone: it was the third place that number
  // appeared, under a rail row and a collapsed summary that had each said it already.
  await expect(
    page.getByRole("heading", { level: 1 }),
    "and so does the screen's heading",
  ).toContainText(`Version ${String(fixture.publishedVersion)}`);
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

test("2026-09-28 keeps Save in the screen's heading row, in one place on every panel", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  /*
   * The reason the button is in the header at all (Code Owner, 2026-09-28).
   *
   * It was the last thing in the column, then a sticky bar at its foot, then the version card's
   * own header. The first two put it where the PANEL decided: measured at 1440 before this moved,
   * y=481 on Validation messages, 565 on Content, 848 on Options, and no button at all on
   * Preview. A control that travels 367px when a reader switches panels is one they have to find
   * again each time. The third stopped it moving but repeated "Version 2" under a rail row and a
   * collapsed summary that had each said it already.
   *
   * So what is asserted is the property rather than a coordinate: the same box on every panel, at
   * both widths the mobile stance names, Preview included - and the heading it sits beside not
   * moving between a draft and a frozen version, which is the other way this row could jump.
   */
  const panels = ["content", "constraints", "preview"] as const;
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    const boxes: Record<string, string> = {};
    for (const panel of panels) {
      await page.goto(detailPath(`?v=${String(fixture.draftVersion)}&panel=${panel}`));
      const save = page.getByRole("main").getByRole("button", { name: "Save draft" });
      await expect(save, `Save is on the ${panel} panel too`).toBeVisible();
      const box = await save.boundingBox();
      boxes[panel] = JSON.stringify(box);
    }
    expect(
      new Set(Object.values(boxes)).size,
      `Save must not move between panels at ${String(width)}: ${JSON.stringify(boxes)}`,
    ).toBe(1);

    // NOT STICKY, and nothing overflows the width the mobile stance measures.
    const layout = await page.evaluate(() => {
      const button = [...document.querySelectorAll("main button")].find(
        (candidate) => candidate.textContent?.trim() === "Save draft",
      );
      return {
        position: button === undefined ? "" : getComputedStyle(button).position,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(layout.position).toBe("static");
    expect(layout.overflowX, `nothing overflows at ${String(width)}`).toBeLessThanOrEqual(0);
  }

  // THE HEADING DOES NOT MOVE WHEN THE BUTTON IS NOT THERE. A frozen version publishes no save
  // state, so the row renders neither control nor note; without a minimum on the row the heading
  // rose as a reader walked from a draft to a published version, by 5px at 390.
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    const headingTop = async (version: number): Promise<number | undefined> => {
      await page.goto(detailPath(`?v=${String(version)}&panel=content`));
      const heading = page.getByRole("main").getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();
      return (await heading.boundingBox())?.y;
    };
    const draft = await headingTop(fixture.draftVersion);
    const frozen = await headingTop(fixture.publishedVersion);
    await expect(
      page.getByRole("main").getByRole("button", { name: "Save draft" }),
      "a frozen version has nothing to save, so it says nothing (contract 6)",
    ).toHaveCount(0);
    expect(frozen, `the heading must not move between versions at ${String(width)}`).toBe(draft);
  }

  await page.goto(detailPath(`?v=${String(fixture.draftVersion)}&panel=content`));
  // The manual save model travels with the button and stays before it (issue 518, contract §6).
  const note = page.getByTestId("qcms-manual-save-note");
  await expect(note).toBeVisible();
  const order = await page.evaluate(() => {
    const noteElement = document.querySelector('[data-testid="qcms-manual-save-note"]');
    const button = [...document.querySelectorAll("main button")].find(
      (candidate) => candidate.textContent?.trim() === "Save draft",
    );
    if (noteElement === null || button === undefined) return 0;
    // eslint-disable-next-line no-bitwise
    return noteElement.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order, "the save note reads before the button").toBeGreaterThan(0);

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
  // And nothing to save, so contract §6's read-only clause applies: no button and no note.
  await expect(page.getByRole("main").getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(page.getByTestId("qcms-manual-save-note")).toHaveCount(0);
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
  // SAVE IS STILL THERE (Code Owner, 2026-09-28). This assertion read the other way round while
  // the button lived inside the editor's column, where the preview panel replaced it and left the
  // screen with no way to save what was typed on another panel. The button is in the screen's
  // heading row now, above the card rather than inside it, so it is on every panel - which is the
  // whole point of moving it, and what the position test next door pins.
  await expect(
    page.getByRole("main").getByRole("button", { name: "Save draft" }),
    "the preview panel is still a draft's screen, and a draft can be saved from it",
  ).toBeVisible();

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
