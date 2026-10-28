import { expect, test } from "./support/gates.js";
import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";

const { repeatTableSlug, databaseUrl } = readFixtures();

/** Above the reflow: a width with room for five columns and a Remove. */
const TABLE_VIEWPORT = { width: 1280, height: 900 };
/** The reflow width the plan designs for, narrower than the phone project's 412. */
const CARD_VIEWPORT = { width: 390, height: 844 };

const ADD = "Add Vehicle";
const removeName = (ordinal: number): string => `Remove Vehicle ${String(ordinal)}`;

/** One table row, by the ordinal its row header reads. */
function row(page: import("@playwright/test").Page, ordinal: number) {
  return page.locator("tbody tr[data-qcms-instance]").nth(ordinal - 1);
}

async function startTableFlow(page: import("@playwright/test").Page): Promise<string> {
  await page.goto(`/f/${repeatTableSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(row(page, 1)).toBeVisible();
  await waitForHydration(page);
  return new URL(page.url()).pathname.split("/")[2]!;
}

/** Press Add or Remove and wait for the roster write the API answers. */
async function rosterPress(page: import("@playwright/test").Page, name: string): Promise<void> {
  const written = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/roster$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name }).click();
  const response = await written;
  expect(response.status(), `POST /roster for "${name}"`).toBe(200);
}

/** Wait for the answer post for one question, by the question in its body. */
function answerPosted(page: import("@playwright/test").Page, questionId: string): Promise<unknown> {
  return page.waitForResponse((response) => {
    if (response.request().method() !== "POST" || response.status() !== 200) return false;
    if (!/\/answers$/.test(new URL(response.url()).pathname)) return false;
    const body = response.request().postDataJSON() as { questionId?: unknown } | null;
    const posted = typeof body?.questionId === "string" ? body.questionId : "";
    return posted === questionId || posted.endsWith(`/${questionId}`);
  });
}

async function fillCell(
  page: import("@playwright/test").Page,
  ordinal: number,
  questionId: string,
  label: string,
  value: string,
): Promise<void> {
  const posted = answerPosted(page, questionId);
  const field = row(page, ordinal)
    .locator(`td[data-qcms-column="${questionId}"]`)
    .getByRole("textbox", { name: `Vehicle ${String(ordinal)}, ${label}` });
  await field.fill(value);
  await field.blur();
  await posted;
}

/** The page's own horizontal overflow: the one number the portal's claim is about. */
function pageOverflow(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("the table is a native table with real headers, and no role=grid anywhere", async ({
  page,
}) => {
  await page.setViewportSize(TABLE_VIEWPORT);
  await startTableFlow(page);
  await rosterPress(page, ADD);
  await expect(page.locator("tbody tr[data-qcms-instance]")).toHaveCount(2);

  await expect(page.locator('[role="grid"]')).toHaveCount(0);
  await expect(page.locator('[role="gridcell"]')).toHaveCount(0);

  const table = page.locator("table[class*='qcms-repeat-table']");
  await expect(table.locator("caption")).toHaveText("Vehicles");
  await expect(table.locator('thead th[scope="col"]').first()).toHaveText("Vehicle");
  await expect(table.locator('thead th[scope="col"]')).toHaveCount(7);
  await expect(table.locator('tbody th[scope="row"]')).toHaveCount(2);
  await expect(row(page, 2).locator('th[scope="row"]')).toHaveText("Vehicle 2");

  for (const ordinal of [1, 2]) {
    await expect(
      page.getByRole("textbox", { name: `Vehicle ${String(ordinal)}, Registration plate` }),
    ).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: `Vehicle ${String(ordinal)}, Main use` }),
    ).toBeVisible();
  }
  await expect(table.locator(".qcms-repeat-table__colhint")).toHaveCount(1);

  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
});

test("case 41: at 390px the table reflows to one card per row and the page does not scroll", async ({
  page,
}) => {
  await page.setViewportSize(CARD_VIEWPORT);
  await startTableFlow(page);
  await rosterPress(page, ADD);
  await expect(page.locator("tbody tr[data-qcms-instance]")).toHaveCount(2);

  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scale: window.visualViewport?.scale ?? 1,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(metrics.innerWidth, "the layout viewport is the device width, unzoomed").toBe(390);
  expect(metrics.scale, "Chromium zoomed the page out to fit, which is a 1.4.10 failure").toBe(1);
  expect(metrics.overflow, "the portal page may never scroll horizontally").toBeLessThanOrEqual(0);

  await expect(page.locator("table[class*='qcms-repeat-table'] thead")).toBeHidden();
  const bands = await row(page, 1)
    .locator("td[data-qcms-column]")
    .evaluateAll((cells) =>
      cells.map((cell) => {
        const box = cell.getBoundingClientRect();
        return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
      }),
    );
  expect(bands.length).toBe(5);
  const stacked = [...bands].sort((a, b) => a.top - b.top);
  for (let index = 1; index < stacked.length; index += 1) {
    expect(
      stacked[index]!.top,
      "a card is one column: no two cells may share a horizontal band",
    ).toBeGreaterThanOrEqual(stacked[index - 1]!.bottom);
  }

  for (const ordinal of [1, 2]) {
    await expect(
      page.getByRole("textbox", { name: `Vehicle ${String(ordinal)}, Registration plate` }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: `Vehicle ${String(ordinal)}, Last service date` }),
    ).toBeVisible();
  }
  const plateLabel = row(page, 1)
    .locator('td[data-qcms-column="q_rt_plate"] label')
    .filter({ hasText: "Vehicle 1, Registration plate" });
  await expect(plateLabel).toBeVisible();
});

test("case 44: nothing is pinned, so no focused cell can be obscured (2.4.11)", async ({
  page,
}) => {
  await page.setViewportSize(TABLE_VIEWPORT);
  await startTableFlow(page);
  await rosterPress(page, ADD);

  const plate = page.getByRole("textbox", { name: "Vehicle 1, Registration plate" });
  await plate.focus();
  await expect(plate).toBeFocused();

  const OUT_OF_FLOW = ["sticky", "absolute", "fixed"];
  const positions = await page
    .locator("thead th, thead td, tfoot th, tfoot td")
    .evaluateAll((cells) => cells.map((cell) => globalThis.getComputedStyle(cell).position));
  expect(positions.length).toBeGreaterThan(0);
  expect(
    positions.filter((position) => OUT_OF_FLOW.includes(position)),
    "a header or footer cell is out of flow: read the 2.4.11 note",
  ).toEqual([]);

  const report = await plate.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const chrome = [...document.querySelectorAll("thead th, thead td, tfoot th, tfoot td")];
    const overlapping = chrome
      .map((cell) => cell.getBoundingClientRect())
      .filter(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left < box.right &&
          rect.right > box.left &&
          rect.top < box.bottom &&
          rect.bottom > box.top,
      ).length;
    const points = [
      { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      { x: box.left + box.width * 0.25, y: box.top + box.height / 2 },
      { x: box.left + box.width * 0.75, y: box.top + box.height / 2 },
      { x: box.left + box.width / 2, y: box.top + box.height * 0.3 },
      { x: box.left + box.width / 2, y: box.top + box.height * 0.7 },
    ];
    const covered = points
      .map((point) => document.elementFromPoint(point.x, point.y))
      .filter(
        (hit) => hit !== element && !element.contains(hit) && !(hit?.contains(element) ?? false),
      )
      .map((hit) => (hit === null ? "nothing" : `${hit.tagName}.${hit.className}`));
    return { overlapping, covered };
  });
  expect(report.overlapping, "a header or footer cell overlaps the focused cell").toBe(0);
  expect(report.covered, "something is painted over the focused cell").toEqual([]);

  await rosterPress(page, ADD);
  const landed = page.locator(":focus");
  await expect(landed).toHaveAttribute("id", /^ins_/);
  await expect(landed).toHaveText("Vehicle 3");
  const landingReport = await landed.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const chrome = [...document.querySelectorAll("thead th, thead td, tfoot th, tfoot td")];
    const overlapping = chrome
      .map((cell) => cell.getBoundingClientRect())
      .filter(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left < box.right &&
          rect.right > box.left &&
          rect.top < box.bottom &&
          rect.bottom > box.top,
      ).length;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const covered =
      hit === element || element.contains(hit) || (hit?.contains(element) ?? false)
        ? null
        : (hit?.tagName ?? "nothing");
    return { overlapping, covered };
  });
  expect(landingReport.overlapping, "table chrome overlaps the row the Add landed on").toBe(0);
  expect(landingReport.covered, "something covers the row the Add landed on").toBeNull();
});

test("a per-row Remove clears the 44px target floor (2.5.8)", async ({ page }) => {
  await page.setViewportSize(TABLE_VIEWPORT);
  await startTableFlow(page);
  await rosterPress(page, ADD);

  const box = await page.getByRole("button", { name: removeName(2) }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(24);
});

test("case 43: the column total is drawn, is no input, and reaches no answer row", async ({
  page,
}) => {
  await page.setViewportSize(TABLE_VIEWPORT);
  const sessionId = await startTableFlow(page);

  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await page.getByLabel("Fleet reference").blur();
  await fillCell(page, 1, "q_rt_plate", "Registration plate", "AAA111");
  await fillCell(page, 1, "q_rt_odometer", "Odometer reading", "1200");
  await rosterPress(page, ADD);
  await fillCell(page, 2, "q_rt_plate", "Registration plate", "BBB222");
  await fillCell(page, 2, "q_rt_odometer", "Odometer reading", "340");

  const total = page.locator('tfoot td[data-qcms-column="q_rt_odometer"]');
  await expect(total).toContainText("1,540");
  await expect(page.locator("tfoot th")).toHaveText("Total");
  await expect(page.locator("tfoot input, tfoot select, tfoot textarea")).toHaveCount(0);
  await expect(page.locator("tfoot [data-qcms-field]")).toHaveCount(0);

  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);

  const db = await openDb(databaseUrl);
  try {
    const answers = await db.lockedAnswers(sessionId);
    const asked = new Set(answers.map((answer) => answer.questionId));
    expect([...asked].sort()).toEqual(["q_rt_fleet_ref", "q_rt_odometer", "q_rt_plate"]);
    const odometers = answers
      .filter((answer) => answer.questionId === "q_rt_odometer")
      .map((answer) => answer.value);
    expect(odometers).toEqual([1200, 340]);
    expect(odometers).not.toContain(1540);
    const ledger = await db.instanceAnswerRows(sessionId);
    expect(ledger.map((entry) => entry.questionId)).not.toContain("total");
    for (const entry of ledger) expect(entry.value).not.toBe(1540);
  } finally {
    await db.close();
  }
});

test.describe("without scripting", () => {
  test.use({ javaScriptEnabled: false });

  test("a row's Add and Remove ride the __qop Server Action and land focus by autofocus", async ({
    page,
  }) => {
    await page.setViewportSize(TABLE_VIEWPORT);
    await page.goto(`/f/${repeatTableSlug}`);
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForURL(/\/s\/ses_/);
    await expect(page.locator("tbody tr[data-qcms-instance]")).toHaveCount(1);

    const remove = page.getByRole("button", { name: removeName(1) });
    await expect(remove).toHaveAttribute("name", "__qop");
    await expect(remove).toHaveAttribute("value", /^remove:grp_vehicles:ins_/);
    await expect(remove).toHaveAttribute("formnovalidate", "");

    const served = page.waitForResponse((response) => response.request().isNavigationRequest(), {
      timeout: 120_000,
    });
    await page.getByRole("button", { name: ADD }).click();
    expect((await served).status(), "the Add post's own response").toBe(200);
    await expect(page.locator("tbody tr[data-qcms-instance]")).toHaveCount(2);

    await expect(page.locator("[autofocus]")).toHaveCount(1);
    const landing = page.locator('tbody th[scope="row"][autofocus]');
    await expect(landing).toHaveText("Vehicle 2");
    await expect(landing).toHaveAttribute("tabindex", "-1");

    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });
});
