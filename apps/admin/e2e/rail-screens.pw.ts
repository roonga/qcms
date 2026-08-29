import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openRail } from "./support/forms.js";
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
    { path: `/forms/${FORM_ID}`, current: "section:builder", children: true },
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

    // EVERY form screen carries the steps now, the builder included (Code Owner,
    // 2026-08-25), and they are nested inside the Form row rather than stacked above the
    // sections. The builder used to be the exception here, on a §7 clause that is retired.
    await expect
      .soft(page.locator('[data-rail-group="steps"]'), `${screen.path} carries the form's steps`)
      .toHaveCount(screen.children ? 1 : 0);
    await expect
      .soft(
        page.locator(
          '[data-rail-item="section:builder"] ~ [data-rail-group="steps"], li:has(> [data-rail-item="section:builder"]) [data-rail-group="steps"]',
        ),
        `${screen.path} nests them inside the Form row`,
      )
      .toHaveCount(1);
    // One tree means no divider: §7's "one divider between two groups" described two
    // groups, and the amendment of 2026-08-25 leaves one.
    await expect
      .soft(page.locator("hr.qcms-rail__divider"), `${screen.path} draws no divider`)
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

  // THE BUILDER HAS ONE STEP LIST NOW, and it is in the rail (Code Owner, 2026-08-25).
  // It used to have two: an editor of buttons inside the page, beside a rail that carried
  // no steps at all. This asserts the merge from both directions - the rail's rows are the
  // interactive ones, and nothing outside the rail is offering a second copy of them.
  await page.goto(`/forms/${FORM_ID}`);
  const railStep = page
    .getByTestId("qcms-rail")
    .getByRole("button", { name: new RegExp(STEP_TITLE) });
  await expect(railStep.first(), "the rail's step row is a button that selects").toBeVisible();
  await expect(
    page.locator(`main#main-content [data-rail-step-select]`),
    "and the page carries no second step list",
  ).toHaveCount(0);

  // AND THE LIST IS STILL THE PLACE THOSE SEVEN HREFS LAND. Every step row above points at
  // `#step-{stepId}`, and so does the validation panel's link to an offending step; the
  // element answering to that id lived in the in-page list, so deleting that list took the
  // destination with it and left both sets of links pointing at nothing. No assertion in
  // this suite noticed, because a fragment that matches nothing fails silently.
  await expect(
    page.locator(`#step-${STEP_ID}`),
    "the step the seven rails link to is present to be linked to",
  ).toHaveCount(1);
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

test("561 puts every shared rail row in the same box on all three builder-family screens", async ({
  page,
}) => {
  // THE SHIFT THIS EXISTS FOR (Code Owner, 2026-08-30). The rail is rendered twice - a
  // server-rendered version for the six routes and a client-rendered one for the builder's
  // two screens - and the two disagreed in ways that only showed as movement when you
  // walked between them:
  //
  //   - a row with a `⋮` trigger gave up 30px to it, so the form row and every step row
  //     was a 193px box on the builder and a 223px box everywhere else;
  //   - the 8px under Rules came from a wrapper that only the builder renders, so all six
  //     route rows below it sat 8px lower there than on the other screens.
  //
  // Neither was visible from inside one screen, which is why nothing caught them. What
  // catches them is comparing the SAME row across a navigation, so that is what this does:
  // every row's box, keyed by row, on each of the three screens, compared as a whole.
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  const boxes = async (): Promise<Record<string, string>> =>
    page.locator("[data-rail-item]").evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return [
            node.getAttribute("data-rail-item") ?? "",
            // Rounded, because a fractional layout difference is not what this is about
            // and sub-pixel noise would make it flake.
            `left=${String(Math.round(box.left))} width=${String(Math.round(box.width))} top=${String(Math.round(box.top))} height=${String(Math.round(box.height))}`,
          ];
        }),
      ),
    );

  await page.goto(`/forms/${FORM_ID}`);
  await expect(page.getByTestId("qcms-rail")).toBeVisible();
  await openRail(page);
  const onBuilder = await boxes();

  await page.locator('[data-rail-item="rules"]').click();
  await expect(page.locator("#qcms-rules-heading")).toBeAttached();
  const onRules = await boxes();

  await page.goto(`/forms/${FORM_ID}/preview`);
  await expect(page.getByTestId("qcms-rail")).toBeVisible();
  await openRail(page);
  const onPreview = await boxes();

  // Only the rows all three screens have. The builder's step rows are chosen rather than
  // navigated to, so they carry `data-rail-step-select` instead and are not in this set;
  // `rail.pw.ts` is where the step rows themselves are measured.
  const shared = Object.keys(onBuilder).filter((key) => key in onRules && key in onPreview);
  expect(shared.length, "the three screens share rows to compare").toBeGreaterThan(4);

  for (const key of shared) {
    expect
      .soft(onRules[key], `${key} does not move between the builder and the rules screen`)
      .toBe(onBuilder[key]);
    expect
      .soft(onPreview[key], `${key} does not move between the builder and preview`)
      .toBe(onBuilder[key]);
  }

  // ONE RHYTHM (Code Owner, 2026-08-30). Every gap in the column is either the 2px between
  // rows of one group or the 8px between groups, and nothing in between: the rail carried
  // 0px, 2px, 8px and 10px gaps at once, which reads as a column that cannot decide.
  //
  // Measured on the rendered boxes rather than read off the sheet, because the values that
  // produced the irregularity were each individually reasonable - a padding here, a margin
  // there - and only the sum on screen showed it.
  for (const [screen, path] of [
    ["builder", `/forms/${FORM_ID}`],
    ["preview", `/forms/${FORM_ID}/preview`],
  ] as const) {
    await page.goto(path);
    await expect(page.getByTestId("qcms-rail")).toBeVisible();
    await openRail(page);
    const measured = await page
      .locator("[data-rail-item], [data-rail-step-select], .qcms-rail-steps__add")
      .evaluateAll((nodes) =>
        nodes.map((node, index) => {
          const box = node.getBoundingClientRect();
          const previous = index === 0 ? undefined : nodes[index - 1]?.getBoundingClientRect();
          return {
            gap: previous === undefined ? null : Math.round(box.top - previous.bottom),
            height: Math.round(box.height),
          };
        }),
      );
    expect(measured.length, `${screen} renders rail rows to measure`).toBeGreaterThan(6);
    for (const [index, row] of measured.entries()) {
      if (row.gap !== null) {
        expect
          .soft([2, 8], `${screen} row ${String(index)} sits on the rail's rhythm`)
          .toContain(row.gap);
      }
      // The add control was a 52px box among 40px rows, from padding it carried itself.
      expect.soft(row.height, `${screen} row ${String(index)} is one row tall`).toBe(40);
    }
  }
});
