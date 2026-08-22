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
 * ## The builder's rail carries one group, and that is §7 rather than an exception to it
 *
 * A rail step item is `/forms/{formId}#step-{stepId}`, which is a cross-route link on
 * seven screens and a bare same-page fragment on the builder, and §7 says the rail "never
 * carries same-page section switches". So the builder gets the sibling group and no
 * children, and with one group there is no divider. Asserted here because it looks like an
 * inconsistency and is not one, and because the builder's own step editor has to be left
 * exactly where it is: it is content rather than navigation, which is why §7 never reached
 * it.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("rail561");

/** The seeded insurance fixture: one step, a published v1, four secure links. */
const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const STEP_ID = "stp_history";
const STEP_TITLE = "Driving history";
const ACCIDENT = "q_at_fault_accident";

/** The rail turns into its column at `--bp-sidebar`, which is 64rem at the default root size. */
const SIDEBAR = 1024;

/** Set by the first test; the rest sign in again with it (serial shares no context). */
let totpSecret = "";
/** A submitted response, purely so the response-detail route has a subject. */
let sessionId = "";

/** One screen: the path, the sibling row its rail marks, and which groups it carries. */
interface Screen {
  readonly path: string;
  /** The `data-rail-item` key that should carry `aria-current`. */
  readonly current: string;
  /** Whether §7's children group is present. False only on the builder. */
  readonly children: boolean;
}

/**
 * All eight form-scoped screens, in route order.
 *
 * The two detail routes expect their SECTION rather than themselves, and that is the same
 * answer the app has given on those URLs since task 034: neither a stored version nor one
 * collected response is a row of §7's sibling group, and `components/forms/form-tabs.tsx`
 * resolves `/versions/3` to the version-history section and `/responses/{id}` to Responses.
 */
function screens(): readonly Screen[] {
  return [
    { path: `/forms/${FORM_ID}`, current: "section:builder", children: false },
    { path: `/forms/${FORM_ID}/preview`, current: "section:preview", children: true },
    { path: `/forms/${FORM_ID}/versions`, current: "section:versions", children: true },
    { path: `/forms/${FORM_ID}/versions/1`, current: "section:versions", children: true },
    { path: `/forms/${FORM_ID}/links`, current: "section:links", children: true },
    { path: `/forms/${FORM_ID}/responses`, current: "section:responses", children: true },
    {
      path: `/forms/${FORM_ID}/responses/${sessionId}`,
      current: "section:responses",
      children: true,
    },
    { path: `/forms/${FORM_ID}/webhooks`, current: "section:webhooks", children: true },
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

test("561 puts the rail on all eight form-scoped screens, marking the row the screen is", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  sessionId = await submitResponse(SLUG, [[ACCIDENT, false]]);

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  for (const screen of screens()) {
    await page.goto(screen.path);
    await expect(page.locator("main#main-content"), `${screen.path} is the shell`).toHaveCount(1);

    // Soft throughout, so one sweep reports all eight verdicts rather than stopping at the
    // first screen that disagrees.
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
    // The six sections are one navigation on every screen, never two: the strip that used
    // to render under the heading retired with `form-tabs.tsx` (issue 561), so a second
    // nav to the same six places cannot come back unnoticed.
    await expect
      .soft(page.locator('[data-rail-group="sections"]'), `${screen.path} has the sibling group`)
      .toHaveCount(1);
    await expect
      .soft(
        page.getByRole("navigation", { name: "Form sections" }),
        `${screen.path} has no second section nav`,
      )
      .toHaveCount(0);

    // The builder's children group is absent, and with one group there is no divider.
    const expected = screen.children ? 1 : 0;
    await expect
      .soft(
        page.locator('[data-rail-group="steps"]'),
        `${screen.path} ${screen.children ? "carries" : "omits"} §7's children group`,
      )
      .toHaveCount(expected);
    await expect
      .soft(page.locator("hr.qcms-rail__divider"), `${screen.path} divides only two groups`)
      .toHaveCount(expected);
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
    await page.goto(screen.path);
    await expect(page.getByTestId("qcms-rail")).toBeVisible();
    expect
      .soft(
        await childHrefs(page),
        screen.children
          ? `${screen.path} lists the form's steps as its children`
          : `${screen.path} carries no children group at all`,
      )
      .toEqual(screen.children ? expected : []);
  }

  // The builder keeps its own step list, and that list is the editor rather than a second
  // copy of the rail's group: its rows are buttons and they select a step in the page.
  await page.goto(`/forms/${FORM_ID}`);
  await expect(
    page.getByRole("button", { name: new RegExp(STEP_TITLE) }).first(),
    "the builder's own step list is still an editor of buttons",
  ).toBeVisible();
});

test("561 keeps the two respondent-facing screens on the narrower cap the rail sits beside", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  // The preview and the version detail get LESS than any other screen, because both render
  // what a respondent sees and a wider container makes the preview lie
  // (`plan/admin-ux-audit.md` §3.4). Issue 558 spelled that as 720, derived from the
  // portal's own measure; issue 657 re-read it off the drawing and it stays 720, because
  // `plan/admin-shell-poc/preview-versions-poc.html` draws a 640px `.respondent-frame`
  // inside its `.main` padding while this cap sits on a `<main>` that carries `p-6` - so
  // 45rem renders the 672px column closest to the drawn 640. Two independent routes to the
  // same number. The rail is a sibling of `<main>` rather than a child of it, so it takes
  // nothing off that measure and is no excuse to widen it either.
  for (const path of [`/forms/${FORM_ID}/preview`, `/forms/${FORM_ID}/versions/1`]) {
    await page.goto(path);
    await expect(page.getByTestId("qcms-rail")).toBeVisible();
    const measured = await page.locator("main#main-content").evaluate((element) => ({
      cap: Number.parseFloat(getComputedStyle(element).maxWidth),
      width: element.getBoundingClientRect().width,
    }));
    expect.soft(measured.cap, `${path} caps at the narrow measure`).toBe(720);
    expect.soft(measured.width, `${path} is not widened by having a rail`).toBe(720);
  }
});
