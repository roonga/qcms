import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { field, openPanel, setNumericConstraint } from "./support/questions.js";
import { createQuestionRailFixture, type QuestionRailFixture } from "./support/question-rail.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("qrail650");
const RUN = Date.now().toString(36);

const SIDEBAR = 1024;

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

  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toContainText(
    `Version ${String(fixture.publishedVersion)}`,
  );

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

  // Scope current marks to version rows: panel rows and the top bar carry their own current state.
  const marked = page.locator('[data-rail-version][aria-current="page"]');
  await expect(marked, "exactly one version row is current").toHaveCount(1);
  await expect(marked).toHaveAttribute("data-rail-version", String(fixture.draftVersion));

  await page.locator(`[data-rail-version="${String(fixture.publishedVersion)}"]`).click();
  await page.waitForURL(new RegExp(`\\?v=${String(fixture.publishedVersion)}$`, "u"));
  await expect(
    page.locator('[data-rail-version][aria-current="page"]'),
    "the rail follows the address",
  ).toHaveAttribute("data-rail-version", String(fixture.publishedVersion));

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
  await expect(rail.locator(".qcms-rail__digest")).toHaveText(
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

  await expect(
    page.getByRole("navigation", { name: `${fixture.questionId} sections` }),
    "one version navigation on the screen",
  ).toHaveCount(1);
  await expect(
    page.locator(`main#main-content a[href*="?v="]`),
    "and no second copy of its rows in the content column",
  ).toHaveCount(0);
});

test("1116 keeps New version in the rail's Actions part, under the list", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");

  const actionsTop = await rail
    .locator(".qcms-rail__actions")
    .evaluate((element) => element.getBoundingClientRect().top);
  const listBottom = await rail
    // The selected version nests a panel group; the first group is the version list itself.
    .locator(".qcms-rail__group")
    .first()
    .evaluate((element) => element.getBoundingClientRect().bottom);
  expect(actionsTop).toBeGreaterThanOrEqual(listBottom);
  await expect(rail.getByRole("button", { name: "New version" })).toBeVisible();

  await expect(
    rail.getByRole("button", { name: `Publish version ${String(fixture.draftVersion)}` }),
  ).toHaveCount(0);
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));
  await expect(
    rail.getByRole("button", { name: `Deprecate version ${String(fixture.publishedVersion)}` }),
  ).toHaveCount(0);
});

test("1116 offers Publish and Deprecate from the screen's heading row, beside Save", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const head = page.locator(".qcms-question-head");
  await expect(
    head.getByRole("button", { name: `Publish version ${String(fixture.draftVersion)}` }),
  ).toBeVisible();
  await expect(head.getByRole("button", { name: "Save draft" })).toBeVisible();

  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));
  await expect(
    head.getByRole("button", { name: `Deprecate version ${String(fixture.publishedVersion)}` }),
  ).toBeVisible();

  await expect(head.getByRole("button", { name: "Save draft" })).toHaveCount(0);
});

test("2026-09-27 nests the editor's panels under the selected version, and switches the column", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");

  await expect(rail.locator("[data-rail-panel]")).toHaveCount(3);
  const selectedRow = rail.locator(`[data-rail-version="${String(fixture.draftVersion)}"]`);
  await expect(
    selectedRow.locator('xpath=following-sibling::ul[@data-rail-group="panels"]'),
    "the panels are the selected row's own children",
  ).toHaveCount(1);

  await expect(rail.locator('[data-rail-panel="content"]')).toBeVisible();
  await expect(rail.locator('[data-rail-panel="constraints"]')).toBeVisible();
  await expect(rail.locator('[data-rail-panel="preview"]')).toBeVisible();
  await expect(rail.locator('[data-rail-panel="options"]')).toHaveCount(0);
  await expect(rail.locator('[data-rail-panel="messages"]')).toHaveCount(0);
  await expect(rail.locator("[data-rail-panel]").last()).toHaveAttribute(
    "data-rail-panel",
    "preview",
  );

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

  await expect(page).toHaveURL(/panel=constraints/u);
  await page.reload();
  await expect(field(page, "Shortest answer")).toBeVisible();

  await setNumericConstraint(page, "Shortest answer", "4");
  await expect(rail.locator('[data-rail-panel="messages"]')).toBeVisible();
  await expect(rail.locator('[data-rail-panel="constraints"]')).toContainText("min 4");
});

test("2026-09-27 switches a panel while the rail is a shut disclosure at 390px", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(detailPath());
  await expect(page.locator("details.qcms-rail__disclosure")).not.toHaveAttribute("open", "");

  await openPanel(page, "constraints");
  await expect(field(page, "Shortest answer")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("2026-09-27 states the question's details in the rail and the way to all questions above them", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  const details = rail.locator(".qcms-rail__facts");
  await expect(details).toContainText("Slug");
  await expect(details).toContainText(`e2e-qrail-${RUN}`);
  await expect(details).toContainText("Created");

  await expect(details).toContainText("Short text (locked)");
  await expect(page.getByRole("main")).not.toContainText("Type is locked to");

  await expect(page.getByRole("main")).not.toContainText("Slug:");

  const back = rail.getByRole("link", { name: "All questions", exact: true });
  await expect(back).toBeVisible();
  const backBottom = await back.evaluate((element) => element.getBoundingClientRect().bottom);
  const disclosureTop = await page
    .locator("details.qcms-rail__disclosure")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(backBottom).toBeLessThanOrEqual(disclosureTop);
  await expect(
    page.getByRole("main").getByRole("link", { name: "Questions", exact: true }),
  ).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 900 });
  await expect(back, "still the first thing on screen with the rail shut").toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("2026-09-28 keeps Save in the screen's heading row, in one place on every panel", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

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

  await expect(field(page, "Shortest answer")).toBeFocused();
  await expect(field(page, "Shortest answer")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/panel=constraints/u);
});

test("2026-09-27 opens the same panels on a frozen version, read-only", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}&panel=constraints`));

  await expect(
    page.getByTestId("qcms-question-rail").locator('[data-rail-panel="constraints"]'),
  ).toHaveAttribute("aria-current", "page");
  await expect(field(page, "Shortest answer")).toBeDisabled();

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

  await expect(page.locator(".qcms-preview")).toHaveCount(0);

  await openPanel(page, "preview");
  await expect(page.locator(".qcms-preview")).toBeVisible();

  await expect(page.getByTestId("qcms-preview-switcher")).toBeVisible();
  await expect(field(page, "Label")).toHaveCount(0);

  await expect(
    page.getByRole("main").getByRole("button", { name: "Save draft" }),
    "the preview panel is still a draft's screen, and a draft can be saved from it",
  ).toBeVisible();

  await expect(page.getByText(/last saved/u)).toHaveCount(0);
  await openPanel(page, "content");
  await field(page, "Label").fill("Edited but not saved");
  await openPanel(page, "preview");
  await expect(page.getByText(/last saved/u)).toBeVisible();

  await openPanel(page, "content");
  await expect(field(page, "Label")).toHaveValue("Edited but not saved");
});

test("1116 gives the parent of the current row no fill, so one row reads as selected", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  const marked = rail.locator('.qcms-rail__link[aria-current="page"]');
  await expect(marked, "the selected version and the open panel under it").toHaveCount(2);

  const painted = await marked.evaluateAll((nodes: readonly Element[]) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        item: node.getAttribute("data-rail-item") ?? "a row",
        weight: style.fontWeight,

        filled:
          style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent",
        edge: style.borderInlineStartWidth,
      };
    }),
  );

  const filled = painted.filter((row) => row.filled);
  expect(filled, "exactly one row carries the full current mark").toHaveLength(1);
  expect(filled[0]?.item, "and it is the panel, which is what the column is showing").toMatch(
    /^panel:/u,
  );
  expect(filled[0]?.weight, "the selected row is at the title weight").toBe("600");
  expect(filled[0]?.edge, "and carries the 2px accent edge").toBe("2px");
  for (const parent of painted.filter((row) => !row.filled)) {
    expect(parent.weight, `${parent.item} is a parent, at weight 600`).toBe("600");
    expect(parent.edge, `${parent.item} keeps the edge transparent`).toBe("2px");
  }
});

test("1116 opens a panel from the keyboard, which is what an anchor row owes", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  const constraints = rail.locator('[data-rail-panel="constraints"]');
  const content = rail.locator('[data-rail-panel="content"]');
  await waitForHydration(page);
  await expect(content).toHaveAttribute("aria-current", "page");

  await constraints.focus();
  await expect(constraints).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(constraints).toHaveAttribute("aria-current", "page");
  await expect(content).not.toHaveAttribute("aria-current", "page");
  await expect(field(page, "Shortest answer")).toBeVisible();
  await expect(field(page, "Label"), "one panel at a time").toHaveCount(0);
  // Native fragment navigation can focus the panel destination; keyboard switching must retain focus on the rail row.
  await expect(constraints).toBeFocused();

  await expect(page).toHaveURL(/#panel-constraints$/u);
  await expect(page).toHaveURL(/panel=constraints/u);
});

test("1117 leaves a modified click to the browser, so a panel row opens in a new tab", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  const constraints = rail.locator('[data-rail-panel="constraints"]');
  const content = rail.locator('[data-rail-panel="content"]');
  await waitForHydration(page);
  await expect(content).toHaveAttribute("aria-current", "page");

  const opened = page.context().waitForEvent("page");

  await constraints.click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await tab.close();

  await expect(content, "the original tab keeps its panel").toHaveAttribute("aria-current", "page");
  await expect(constraints).not.toHaveAttribute("aria-current", "page");
  await expect(page).not.toHaveURL(/panel=constraints/u);
});

test("1117 states the live document's issue total in the rail's Header, and nowhere else", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  const count = rail.getByTestId("qcms-rail-summary-count");

  await waitForHydration(page);
  await expect(count, "no count on a document with no issues").toHaveCount(0);

  await openPanel(page, "constraints");
  await setNumericConstraint(page, "Shortest answer", "3");
  await page.getByRole("main").getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("main").getByText("Draft saved.")).toBeVisible();
  await expect(count, "an accepted save leaves no count behind").toHaveCount(0);

  await setNumericConstraint(page, "Longest answer", "2");
  await page.getByRole("main").getByRole("button", { name: "Save draft" }).click();

  await expect(count, "a refused save states the total in the Header").toHaveText("1 issue");

  await expect(rail.locator('[data-rail-panel="constraints"] [data-rail-issues]')).toHaveText(
    "1 issue",
  );

  await page.goto(detailPath());
  await waitForHydration(page);
  await expect(count, "and nothing here remembers it").toHaveCount(0);
  await expect(rail.locator("[data-rail-issues]"), "nor does any row").toHaveCount(0);
});
