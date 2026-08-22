import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

/**
 * The §7 rail across the form subtree (issue 561; issue 559 built it and wired one screen).
 *
 * `rail.pw.ts` measures the rail itself - the 240px track at `--bp-sidebar`, the
 * disclosure, the wrap, the badge, N2's viewport fill. None of that is repeated here. What
 * this spec is for is the thing that only exists once the rail is on more than one screen:
 * that every form-scoped screen has one, that each marks the row it actually is, that no
 * screen ends up with two navigations to the same six places, and that the children group
 * is the form's STEPS on every one of them rather than whatever list the screen happens to
 * be showing in its own column.
 *
 * ## Why the children assertion is the important one
 *
 * `plan/admin-ux-audit.md` §3.2 is where the word "children" gets dangerous: on the
 * question detail screen a rail's children would be that question's VERSIONS, and the
 * audit says two meanings for the same furniture is the drift a design language exists to
 * stop. The two screens where a wrong answer would look most plausible are the ones
 * checked below by their hrefs: a rail on the history screen listing versions, or a rail
 * on the responses screen listing responses, would also be the rail §5.4 rejects outright
 * for repeating the page's own body "and now there are two of them and they can disagree".
 *
 * ## The builder is deliberately the one screen without a rail
 *
 * It is asserted here rather than left as an absence, because the absence is a decision:
 * the builder already carries a step list that is an EDITOR, and reconciling that with
 * §7's read-only step group is an open layout question (`lib/rail-routes.test.ts` records
 * it with the exception that keeps it that way). A rail appearing there without that
 * ruling should fail something, so it fails this.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("rail561");

/** The seeded insurance fixture: one step, a published v1, four secure links. */
const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const STEP_ID = "stp_history";
const ACCIDENT = "q_at_fault_accident";

/** The rail turns into its column at `--bp-sidebar`, which is 64rem at the default root size. */
const SIDEBAR = 1024;

/** Set by the first test; the rest sign in again with it (serial shares no context). */
let totpSecret = "";
/** A submitted response, purely so the response-detail route has a subject. */
let sessionId = "";

/** One screen: the path, and the sibling row its rail is expected to mark. */
interface Screen {
  readonly path: string;
  /** The rail row that should carry `aria-current`, or `null` when the screen has no rail. */
  readonly current: string | null;
}

/**
 * All eight form-scoped screens, in route order.
 *
 * The two detail routes expect their SECTION rather than themselves, and that is the same
 * answer the app has given on those URLs since task 034: neither a stored version nor one
 * collected response is a row of §7's sibling group, and `components/forms/form-tabs.tsx`
 * resolves `/versions/3` to History and `/responses/{id}` to Responses.
 */
function screens(): readonly Screen[] {
  return [
    { path: `/forms/${FORM_ID}`, current: null },
    { path: `/forms/${FORM_ID}/preview`, current: "section:preview" },
    { path: `/forms/${FORM_ID}/versions`, current: "section:versions" },
    { path: `/forms/${FORM_ID}/versions/1`, current: "section:versions" },
    { path: `/forms/${FORM_ID}/links`, current: "section:links" },
    { path: `/forms/${FORM_ID}/responses`, current: "section:responses" },
    { path: `/forms/${FORM_ID}/responses/${sessionId}`, current: "section:responses" },
    { path: `/forms/${FORM_ID}/webhooks`, current: "section:webhooks" },
  ];
}

/** The hrefs of one screen's children group, in order. */
async function childHrefs(page: Page): Promise<string[]> {
  return page
    .locator('[data-rail-group="steps"] a')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("561 puts the rail on every form-scoped screen but the builder, marking the row the screen is", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  sessionId = await submitResponse(SLUG, [[ACCIDENT, false]]);

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  for (const screen of screens()) {
    await page.goto(screen.path);
    await expect(page.locator("main#main-content"), `${screen.path} is the shell`).toHaveCount(1);

    if (screen.current === null) {
      // Soft throughout, so one sweep reports all eight verdicts rather than stopping at
      // the first screen that disagrees.
      await expect
        .soft(page.getByTestId("qcms-rail"), `${screen.path} is the written exception`)
        .toHaveCount(0);
      await expect
        .soft(page.getByTestId("qcms-form-tabs"), `${screen.path} keeps the section strip`)
        .toHaveCount(1);
      continue;
    }

    await expect
      .soft(page.getByTestId("qcms-rail"), `${screen.path} carries the rail`)
      .toBeVisible();
    await expect
      .soft(
        page.locator(`.qcms-rail__link[data-rail-item="${screen.current}"]`),
        `${screen.path} marks ${screen.current} as the current row`,
      )
      .toHaveAttribute("aria-current", "page");
    await expect
      .soft(
        page.locator('.qcms-rail__link[aria-current="page"]'),
        `${screen.path} marks exactly one row`,
      )
      .toHaveCount(1);
    // One navigation to the six sections, not two. `FormPageHeader` dropped the strip when
    // every screen it serves gained a rail (issue 561).
    await expect
      .soft(page.getByTestId("qcms-form-tabs"), `${screen.path} has no second section nav`)
      .toHaveCount(0);
  }
});

test("561 gives every screen the form's steps as its children, never the list it is showing", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: SIDEBAR, height: 900 });

  // The seeded form has one step, so the whole children group is one known href: the
  // builder's URL with that step's anchor. `lib/forms/issues.ts` mints the same id the
  // validation panel's focus links use, which is the property issue 559 chose deliberately
  // and this keeps true across seven screens.
  const expected = [`/forms/${FORM_ID}#step-${STEP_ID}`];

  for (const screen of screens()) {
    if (screen.current === null) continue;
    await page.goto(screen.path);
    await expect(page.getByTestId("qcms-rail")).toBeVisible();
    expect
      .soft(await childHrefs(page), `${screen.path} lists the form's steps as its children`)
      .toEqual(expected);
  }
});

test("561 keeps the two respondent-facing screens on the narrow cap the rail sits beside", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Issue 558 gives the preview and the version detail LESS than the app default, because
  // both render what a respondent sees and a wider container makes the preview lie
  // (`plan/admin-ux-audit.md` §3.4). The rail is a sibling of `<main>` rather than a child
  // of it, so it takes nothing off that measure and is no excuse to widen it either.
  for (const path of [`/forms/${FORM_ID}/preview`, `/forms/${FORM_ID}/versions/1`]) {
    await page.goto(path);
    await expect(page.getByTestId("qcms-rail")).toBeVisible();
    const measured = await page.locator("main#main-content").evaluate((element) => ({
      cap: Number.parseFloat(getComputedStyle(element).maxWidth),
      width: element.getBoundingClientRect().width,
    }));
    expect.soft(measured.cap, `${path} still caps at the narrow measure`).toBe(720);
    expect.soft(measured.width, `${path} is not widened by having a rail`).toBe(720);
  }
});
