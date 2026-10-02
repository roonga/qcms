import { expect, test } from "./support/gates.js";
import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * The **table presentation** in a browser (task 077, ADR-43, Q10 and Q12, plan section
 * 4.5).
 *
 * The fixture is `repeat-table` (`apps/api/e2e/support/fixtures/repeat-table-form.json`):
 * one step with a required plain question and one `open` group, `min: 1`, `max: 3`,
 * presented as a table whose five columns are exactly the five allowed cell types.
 *
 * Acceptance cases owned here: **41** (the 390px reflow to one card per row, every input
 * keeping its accessible name, and no horizontal page scroll), **43** (the column total
 * is drawn, is not an input, and reaches no answer row) and **44** (a focused cell in the
 * first row is not obscured by the pinned header). Case **45** - axe on a filled table at
 * every viewport project - lives in `a11y-axe.pw.ts`, which the config already runs on
 * all three projects, so it is asserted where that property is already expressed rather
 * than by widening this file's project list. Cases 39 and 40 are proved in jsdom
 * (`packages/ui/src/repeat-table.test.tsx`) and their DOM half is re-asserted here, since
 * "no `role="grid"` anywhere" is a claim about what reaches a respondent.
 *
 * ## Why this file sets its own viewport, twice
 *
 * The suite runs every spec on the Pixel 7 project (412px), which is **below** the card
 * reflow, so a run that only took the project's width would never see the table layout at
 * all. Each test here states the width its property is about: a wide one for the table,
 * 390px for the reflow. That is the plan's own design width, and it is narrower than the
 * phone project, so the measurement is the tighter of the two rather than the one the
 * harness happens to give.
 */

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
  // The first serve mints `min: 1`, so the respondent meets one row rather than an empty
  // table with a button (ADR-42's minting rule).
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

/** Fill one cell by its own accessible name and wait for the answer it commits. */
async function fillCell(
  page: import("@playwright/test").Page,
  ordinal: number,
  questionId: string,
  label: string,
  value: string,
): Promise<void> {
  const posted = answerPosted(page, questionId);
  const cell = row(page, ordinal).locator(`td[data-qcms-column="${questionId}"]`);
  await cell.getByLabel(`Vehicle ${String(ordinal)}, ${label}`).fill(value);
  await cell.getByLabel(`Vehicle ${String(ordinal)}, ${label}`).blur();
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

  // Searched in the SERVED DOM rather than read off the source: the refusal is about
  // what reaches a respondent, and the vendored `Table` this layout was built from is a
  // react-aria `Table`, which renders exactly this role.
  await expect(page.locator('[role="grid"]')).toHaveCount(0);
  await expect(page.locator('[role="gridcell"]')).toHaveCount(0);

  const table = page.locator("table[class*='qcms-repeat-table']");
  await expect(table.locator("caption")).toHaveText("Vehicles");
  // The corner names the row-header column for ONE instance ("Vehicle"), not for the
  // collection ("Vehicles") - that is the caption's job.
  await expect(table.locator('thead th[scope="col"]').first()).toHaveText("Vehicle");
  await expect(table.locator('thead th[scope="col"]')).toHaveCount(7);
  await expect(table.locator('tbody th[scope="row"]')).toHaveCount(2);
  await expect(row(page, 2).locator('th[scope="row"]')).toHaveText("Vehicle 2");

  // And every cell input is named from the ACCESSIBILITY TREE: `getByRole` with a name
  // resolves the computed accessible name, so this is what assistive technology speaks.
  for (const ordinal of [1, 2]) {
    await expect(
      page.getByRole("textbox", { name: `Vehicle ${String(ordinal)}, Registration plate` }),
    ).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: `Vehicle ${String(ordinal)}, Main use` }),
    ).toBeVisible();
  }
  // A column's help text is on its header, once, rather than in each of its cells.
  await expect(table.locator(".qcms-repeat-table__colhint")).toHaveCount(1);

  // The scroll box is the only element on a portal page permitted to scroll sideways,
  // and the page itself still does not.
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
});

test("case 41: at 390px the table reflows to one card per row and the page does not scroll", async ({
  page,
}) => {
  await page.setViewportSize(CARD_VIEWPORT);
  await startTableFlow(page);
  await rosterPress(page, ADD);
  await expect(page.locator("tbody tr[data-qcms-instance]")).toHaveCount(2);

  // MEASURED FIRST, because a table is the most likely place on this surface to break
  // 1.4.10, and because task 073 found that a layout whose min-content width exceeds the
  // device makes Chromium zoom the whole page out - at which point every later
  // measurement and every click point is wrong by the scale factor and the failure names
  // something else entirely.
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scale: window.visualViewport?.scale ?? 1,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(metrics.innerWidth, "the layout viewport is the device width, unzoomed").toBe(390);
  expect(metrics.scale, "Chromium zoomed the page out to fit, which is a 1.4.10 failure").toBe(1);
  expect(metrics.overflow, "the portal page may never scroll horizontally").toBeLessThanOrEqual(0);

  // One card per row: the header row is gone and each row's cells stack, so no two cells
  // of a row share a horizontal band.
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

  // EVERY INPUT KEEPS THE SAME ACCESSIBLE NAME, which is the whole reason the label is a
  // real element clipped by CSS rather than a header relationship: at this width the
  // header cells are not headers any more, so a name that came from them would be gone.
  for (const ordinal of [1, 2]) {
    await expect(
      page.getByRole("textbox", { name: `Vehicle ${String(ordinal)}, Registration plate` }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: `Vehicle ${String(ordinal)}, Last service date` }),
    ).toBeVisible();
  }
  // And here the label is PAINTED, because the card layout is where it has to be read.
  const plateLabel = row(page, 1)
    .locator('td[data-qcms-column="q_rt_plate"] label')
    .filter({ hasText: "Vehicle 1, Registration plate" });
  await expect(plateLabel).toBeVisible();
});

test("case 44: a focused cell in the first row is not obscured by the pinned header", async ({
  page,
}) => {
  await page.setViewportSize(TABLE_VIEWPORT);
  await startTableFlow(page);
  await rosterPress(page, ADD);

  // 2.4.11 Focus Not Obscured, new at 2.2, whose Understanding names "sticky footers,
  // sticky headers" in terms. The header row and the total footer are both pinned, so
  // the criterion is asserted as the property rather than as the declaration: whatever
  // the browser paints at the focused cell's own corners has to be the focused control
  // and not a header or a footer cell.
  const plate = page.getByRole("textbox", { name: "Vehicle 1, Registration plate" });
  await plate.focus();
  await expect(plate).toBeFocused();

  const covered = await plate.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const inset = 2;
    const points = [
      { x: box.left + inset, y: box.top + inset },
      { x: box.right - inset, y: box.top + inset },
      { x: box.left + inset, y: box.bottom - inset },
      { x: box.right - inset, y: box.bottom - inset },
      { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    ];
    return points
      .map((point) => document.elementFromPoint(point.x, point.y))
      .filter((hit) => hit !== element && !element.contains(hit))
      .map((hit) => (hit === null ? "nothing" : `${hit.tagName}.${hit.className}`));
  });
  expect(covered, "something is painted over the focused cell").toEqual([]);

  // The same for the landing an Add produces, which is the row header rather than a cell:
  // a focus destination the pinned header covers is the same failure one element over.
  const added = await row(page, 2).getAttribute("data-qcms-instance");
  await rosterPress(page, ADD);
  await expect(page.locator(":focus")).toHaveAttribute("id", /^ins_/);
  const landed = page.locator(":focus");
  await expect(landed).toHaveText("Vehicle 3");
  expect(added).toMatch(/^ins_/);
  const headingCovered = await landed.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 4, box.top + box.height / 2);
    return hit === element || element.contains(hit) ? null : (hit?.tagName ?? "nothing");
  });
  expect(headingCovered, "the pinned header covers the row the Add landed on").toBeNull();
});

test("a per-row Remove clears the 44px target floor (2.5.8)", async ({ page }) => {
  await page.setViewportSize(TABLE_VIEWPORT);
  await startTableFlow(page);
  await rosterPress(page, ADD);

  // A per-row Remove is the control most likely to fall below the portal's
  // `--space-control-h` floor, because it is one control in one cell of a table that
  // wants to be narrow. 2.5.8's minimum is 24px; the portal's own floor is 44.
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

  // Drawn, and summed over the column's own cells.
  const total = page.locator('tfoot td[data-qcms-column="q_rt_odometer"]');
  await expect(total).toContainText("1,540");
  await expect(page.locator("tfoot th")).toHaveText("Total");
  // And presentation only: no control inside the footer at all, so there is nothing for
  // the respondent to type into and nothing for the form to serialize.
  await expect(page.locator("tfoot input, tfoot select, tfoot textarea")).toHaveCount(0);
  await expect(page.locator("tfoot [data-qcms-field]")).toHaveCount(0);

  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);

  const db = await openDb(databaseUrl);
  try {
    // The locked set holds the questions the author asked and nothing computed: a total
    // is never an answer, so no row of any grain carries one (ADR-43's out-of-scope list
    // - an author who needs it stored asks for it as a question).
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
    // The mechanism is task 073's, unchanged (Q28): a named `__qop` submit button on the
    // step's own form, whose action is a Next Server Action that applies the roster
    // operation and re-renders the step in the same 200. What is new here is that the
    // landing is a table ROW's header rather than an instance card's heading, and that
    // the table above the reflow is where it has to work too - so this one sets a wide
    // viewport rather than taking the phone project's, which is in card layout.
    await page.setViewportSize(TABLE_VIEWPORT);
    await page.goto(`/f/${repeatTableSlug}`);
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForURL(/\/s\/ses_/);
    await expect(page.locator("tbody tr[data-qcms-instance]")).toHaveCount(1);

    // The row's Remove is a submit button carrying the roster operation in its value,
    // and `formnovalidate`, which is safe only because that post writes no answer.
    const remove = page.getByRole("button", { name: removeName(1) });
    await expect(remove).toHaveAttribute("name", "__qop");
    await expect(remove).toHaveAttribute("value", /^remove:grp_vehicles:ins_/);
    await expect(remove).toHaveAttribute("formnovalidate", "");

    // The press is a POST whose own response is the page, which is the ruled shape. The
    // timeout is generous because the FIRST `__qop` post in a run pays for the dev server
    // compiling the Server Action route.
    const served = page.waitForResponse((response) => response.request().isNavigationRequest(), {
      timeout: 120_000,
    });
    await page.getByRole("button", { name: ADD }).click();
    expect((await served).status(), "the Add post's own response").toBe(200);
    await expect(page.locator("tbody tr[data-qcms-instance]")).toHaveCount(2);

    // Focus lands by `autofocus` on the new row's header: a 200 answering a POST leaves
    // the browser on the POST's own URL, which carries no fragment, so a fragment could
    // never have been the landing (Q28). Exactly one claim on the page, because the flush
    // algorithm picks one.
    await expect(page.locator("[autofocus]")).toHaveCount(1);
    const landing = page.locator('tbody th[scope="row"][autofocus]');
    await expect(landing).toHaveText("Vehicle 2");
    await expect(landing).toHaveAttribute("tabindex", "-1");

    // And the page still does not scroll sideways with a hidden label in every cell,
    // which is the trap this layout's `position: relative` declarations exist for.
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });
});
