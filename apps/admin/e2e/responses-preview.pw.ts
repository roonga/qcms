import { expect } from "@playwright/test";

import { test } from "../../portal/e2e/support/gates.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openResponses, submitResponse } from "./support/ops.js";

/**
 * The browser table's answer-preview column (issue 515).
 *
 * `docs/wireframes/admin-responses-ops.md` specifies six columns for this table and
 * the shipped one had five: sessionId, formVersion, submittedAt, accessMode and the
 * flagged tag, with no preview. This spec holds the sixth to the two things only a
 * browser can say about it - that it renders the row's real submitted answers, and
 * that it is the column that disappears at compact width.
 *
 * ## A new file rather than a sixth act of `responses-ops.pw.ts`
 *
 * That spec is a single serial arc (browse, export, erase, then the whole webhook
 * delivery story) whose tests hand state to each other, and three open changes are
 * already editing its tail. This asserts one column and needs none of that arc, so it
 * pays for its own two submissions and stays out of the way.
 *
 * ## What is asserted here and what is asserted below
 *
 * The **rule** - how many answers a preview shows, how a value is clipped, what
 * happens to a number, a boolean, an array or an unexpected object, and what an
 * answerless response reads as - is `lib/ops/ops.test.ts`. It lives there because it
 * is pure, and because the answerless case is not reachable from a browser at all:
 * every seeded form's first question is `required`, so a submission holding no answers
 * is a 422 and never becomes a row. What is left for this layer is the wiring and the
 * CSS, which is what is below.
 */

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

/**
 * The compact boundary is `plan/admin-design-contracts.md` §1's `--bp-compact`, 640px.
 * The two widths below bracket it by 40px rather than sitting on it: a viewport set to
 * exactly 640 can resolve to a 625px media width when the browser paints a classic
 * scrollbar, which would make this assertion about the runner's scrollbar rather than
 * about the stylesheet.
 */
const BELOW_COMPACT = 600;
const ABOVE_COMPACT = 680;
/** The width every admin screenshot gate reviews, and the one the drop must hold at. */
const PHONE = 390;

const EMAIL = uniqueAdminEmail("preview");

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";

/** Two answers, so the preview has a pair to compose and a separator to place. */
let both = "";
/** One answer: answering "no" hides the follow-up count, so this row has a single pair. */
let single = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test.describe("the responses table previews its answers", () => {
  test("shows the wireframe's sixth column, carrying the row's own answers", async ({ page }) => {
    totpSecret = await enrollNewAdmin(page, EMAIL);

    both = await submitResponse(SLUG, [
      [ACCIDENT, true],
      [COUNT, 3],
    ]);
    single = await submitResponse(SLUG, [[ACCIDENT, false]]);

    await openResponses(page, FORM_ID);
    const table = page.getByTestId("qcms-responses-table");

    // The header, by its accessible role: this is a column of the table and not a
    // decoration hung off the last cell.
    await expect(table.getByRole("columnheader", { name: "Answer preview" })).toBeVisible();

    // The values are the ones this session actually submitted, captioned by question id
    // (the list payload carries no labels, and one page mixes form versions, so an id is
    // the honest caption - the same rule the detail screen's fallback follows).
    const bothRow = table.locator(`[data-session-id="${both}"]`);
    await expect(bothRow.getByTestId("qcms-answer-preview")).toHaveText(
      `${COUNT}: 3 · ${ACCIDENT}: true`,
    );

    // One answer: no separator and no more-marker, because there is nothing to separate
    // and nothing withheld.
    const singleRow = table.locator(`[data-session-id="${single}"]`);
    await expect(singleRow.getByTestId("qcms-answer-preview")).toHaveText(`${ACCIDENT}: false`);

    // The sixth column must not push the table past its own scroll box at a desk width.
    // It is `overflow-x: auto`, so a preview allowed to grow past the room the five
    // identifying columns leave is CHOPPED at the container edge mid-word, with nothing
    // saying anything was cut - which is what the first capture of this column showed.
    // The cap in the stylesheet is what stops that, and this is what holds it there:
    // contract 2 wants the scroll container to be a fallback, not the default.
    const overflow = await table.evaluate((box) => box.scrollWidth - box.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("never leaves a preview cell blank on a row that has one", async ({ page }) => {
    // Serial ordering does not share a browser context (031's note in `support/flow.ts`),
    // so every test after the first signs in again with the enrolled secret.
    await signInWithTotp(page, EMAIL, totpSecret);
    await openResponses(page, FORM_ID);
    const previews = page.getByTestId("qcms-responses-table").getByTestId("qcms-answer-preview");

    // Every row on the page, not only this spec's two: the table is shared with every
    // other spec's submissions, so this sweeps whatever shapes they left behind. A blank
    // cell reads as a rendering failure and announces as nothing at all.
    const texts = await previews.allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text.trim()).not.toBe("");
  });

  test("drops the preview, and only the preview, at compact width", async ({ page }) => {
    await signInWithTotp(page, EMAIL, totpSecret);
    await openResponses(page, FORM_ID);
    const table = page.getByTestId("qcms-responses-table");
    // The header is located by its class here, not by its role: a `display: none`
    // element is out of the accessibility tree, so a role locator would be asserting
    // "no such column header exists" rather than "this element is hidden", and would
    // pass just as happily if the column were deleted. Test one above already pinned
    // that the visible column IS a `columnheader`.
    // `qcms-cell--drop` is the one table family's droppable-column class (issue 514);
    // it replaced this table's private `qcms-ops-cell--preview` when the three table
    // treatments became one. Scoped to this table's `thead`, it still selects exactly
    // the preview header, because the preview is the only column this table drops.
    const preview = table.locator("thead th.qcms-cell--drop");
    const previewCell = table
      .locator(`[data-session-id="${both}"]`)
      .getByTestId("qcms-answer-preview");

    // `plan/admin-design-contracts.md` §2 makes a table state which columns drop at
    // `--bp-compact`. For this table it is the preview: the widest column, and the only
    // one that describes a row rather than identifying it.
    await page.setViewportSize({ width: PHONE, height: 844 });
    await expect(preview).toBeHidden();
    await expect(previewCell).toBeHidden();

    // Just under the boundary, so the drop is the stylesheet's rule and not something
    // only a phone-sized viewport happens to produce.
    await page.setViewportSize({ width: BELOW_COMPACT, height: 800 });
    await expect(preview).toBeHidden();

    // And ONLY the preview. Version in particular never drops
    // (`plan/admin-mobile-stance.md` item 5: changing a version pin is on the supported
    // narrow-width path), so it is named here rather than left to a count.
    await page.setViewportSize({ width: PHONE, height: 844 });
    for (const name of ["Session", "Version", "Submitted", "Access", "Flag"]) {
      await expect(table.getByRole("columnheader", { name, exact: true })).toBeVisible();
    }

    // With the sixth column gone the table is the five-column table that shipped before
    // this change, so the page still does not scroll sideways at a phone width (WCAG 2.2
    // AA SC 1.4.10 Reflow, which axe does not test).
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(PHONE);

    // Just over the boundary and the column returns.
    await page.setViewportSize({ width: ABOVE_COMPACT, height: 800 });
    await expect(preview).toBeVisible();
    await expect(previewCell).toBeVisible();
  });
});
