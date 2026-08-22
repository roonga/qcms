import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

/**
 * The width cap is set by the route (issue 558).
 *
 * `plan/admin-ux-audit.md` §6 answers the width question with three values across sixteen
 * screens: five earn width, two must have LESS than the app default because they render
 * respondent-facing content, and nine keep the readable measure. `lib/measure.ts` holds
 * that as one table and `measure.test.ts` proves the table covers exactly the route tree.
 * Neither of those checks that the cap reaches the browser, which is what this spec is
 * for: it opens all sixteen screens and measures the shell's content column.
 *
 * ## What is asserted, and why it is three things rather than one
 *
 * - The **computed cap** on `<main>` is the value the route's row asks for. This is the
 *   check that the utility class actually compiled: `max-w-measure-wide` comes from a
 *   theme token added in `app/globals.css`, and a token Tailwind never emitted produces a
 *   `max-width: none` that looks like "wide" on a narrow viewport and is nothing of the
 *   kind.
 * - At **1280** the measured box is the cap or the viewport, whichever is smaller. That is
 *   the acceptance criterion in the only terms a reviewer can check: five screens wider
 *   than they were, two narrower, nine the same 1024px.
 * - At **390** every one of the sixteen measures the SAME width. This is the other half of
 *   the acceptance - nine screens unchanged, and the seven changed ones unchanged on a
 *   phone - and it is a property of the mechanism rather than of the values: a cap is
 *   fluid below itself, so no breakpoint is involved at any width.
 *
 * The expected assignment below is restated from the issue rather than imported from
 * `lib/measure.ts`. Importing it would make this spec agree with the table by
 * construction; written out, a table row that says the wrong thing fails here.
 *
 * ## Why every frame starts from its own load
 *
 * Same reason `gate-557.pw.ts` gives: the builder's rules pane sits in a `container-type:
 * inline-size` context, and a container query resolves on the layout after a resize rather
 * than during it. Measuring `<main>` is not itself sensitive to that, but reloading costs
 * nothing here and removes the whole class of question.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("measure558");

/** The seeded insurance fixture: published v1, four secure links, no webhook endpoint. */
const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const QUESTION_ID = "q_at_fault_accident";
/** Answering the accident question `true` reveals this one, which is then required. */
const COUNT_ID = "q_accident_count";

/** The three caps, in the CSS pixels `getComputedStyle` reports them as. */
const CAP_PX = { default: 1024, wide: 1600, narrow: 720 } as const;

type Cap = keyof typeof CAP_PX;

/** One screen: the path to open, and the cap §6 assigns the route behind it. */
type Screen = { readonly path: string; readonly cap: Cap };

/**
 * All sixteen authenticated screens, in route order.
 *
 * The response detail path is filled in once a response exists; everything else is
 * reachable from the seed. The screens are opened by URL rather than by clicking through,
 * because what is under test is the route-to-cap mapping and a URL is the shortest
 * statement of a route.
 */
function screens(sessionId: string): readonly Screen[] {
  return [
    { path: "/forms", cap: "default" },
    { path: `/forms/${FORM_ID}`, cap: "wide" },
    { path: `/forms/${FORM_ID}/links`, cap: "wide" },
    { path: `/forms/${FORM_ID}/preview`, cap: "narrow" },
    { path: `/forms/${FORM_ID}/responses`, cap: "default" },
    { path: `/forms/${FORM_ID}/responses/${sessionId}`, cap: "default" },
    { path: `/forms/${FORM_ID}/versions`, cap: "wide" },
    { path: `/forms/${FORM_ID}/versions/1`, cap: "narrow" },
    { path: `/forms/${FORM_ID}/webhooks`, cap: "wide" },
    { path: "/questions", cap: "default" },
    { path: `/questions/${QUESTION_ID}`, cap: "default" },
    { path: "/questions/new", cap: "default" },
    { path: "/responses", cap: "default" },
    { path: "/responses/erasures", cap: "default" },
    { path: "/settings", cap: "default" },
    { path: "/webhooks", cap: "wide" },
  ];
}

/**
 * The exact class attribute the shell's content column carried before issue 558.
 *
 * The nine unchanged screens have to render byte-identically, and their `<main>` keeping
 * this attribute character for character is the strongest form of that claim available in
 * a test: nothing downstream of the element can differ if the element itself does not.
 */
const UNCHANGED_MAIN_CLASS = "mx-auto w-full max-w-5xl flex-1 p-6";

/** What one screen's content column measures, and how much room it had to do it in. */
type Measured = {
  readonly cap: number;
  readonly width: number;
  readonly available: number;
  readonly className: string;
};

/**
 * Open a screen and measure its content column.
 *
 * `<main id="main-content">` exists only inside the authenticated shell, so requiring
 * exactly one of them also rules out the two ways this sweep could measure the wrong page:
 * a `notFound()` renders Next's built-in 404 under the root layout, which has no `<main>`
 * at all, and a lost session renders the auth screen, whose `<main>` carries no id.
 */
async function measure(page: Page, path: string): Promise<Measured> {
  await page.goto(path);
  const main = page.locator("main#main-content");
  await expect(main, `${path} renders the authenticated shell`).toHaveCount(1);
  return main.evaluate((element) => {
    const box = element.getBoundingClientRect();
    // The room the column actually had. Until issue 559 that was simply the viewport
    // minus whatever the scrollbar takes; a screen carrying the §7 rail spends 240px of
    // it on the rail's track, so the ceiling on a `w-full` column is the viewport minus
    // that track. Measured from the rail's own box rather than from the number in the
    // stylesheet, and only when the rail is genuinely BESIDE the column: below
    // `--bp-sidebar` the same element is a disclosure stacked above `<main>` and takes no
    // width from it at all.
    const rail = document.querySelector('[data-testid="qcms-rail"]')?.getBoundingClientRect();
    const besideTheColumn = rail !== undefined && rail.right <= box.left;
    return {
      cap: Number.parseFloat(getComputedStyle(element).maxWidth),
      width: box.width,
      available: document.documentElement.clientWidth - (besideTheColumn ? rail.width : 0),
      // Read as an attribute rather than through `className`, which is a string on an
      // HTML element and an `SVGAnimatedString` on an SVG one, so the union is untyped.
      className: element.getAttribute("class") ?? "",
    };
  });
}

/** Set by the first test, which enrolls the account and creates the response subject. */
let totpSecret = "";
let sessionId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("558 caps each screen at the width its route asks for, at 1280", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  // One submitted response, purely so the response-detail route has a subject. It is one
  // of the nine that must not move, and a route that 404s cannot demonstrate that.
  sessionId = await submitResponse(SLUG, [
    [QUESTION_ID, true],
    [COUNT_ID, 3],
  ]);

  await page.setViewportSize({ width: 1280, height: 900 });
  for (const screen of screens(sessionId)) {
    const measured = await measure(page, screen.path);
    // Soft, so one sweep reports all sixteen verdicts instead of stopping at the first
    // screen that disagrees. The test still fails on any of them; what changes is that a
    // reviewer reading the failure sees the whole table rather than its first row.
    expect
      .soft(measured.cap, `${screen.path} caps at the ${screen.cap} measure`)
      .toBe(CAP_PX[screen.cap]);
    expect
      .soft(measured.width, `${screen.path} fills the smaller of cap and viewport`)
      .toBe(Math.min(CAP_PX[screen.cap], measured.available));
    if (screen.cap === "default") {
      expect
        .soft(
          measured.className,
          `${screen.path} is one of the nine and keeps its exact class attribute`,
        )
        .toBe(UNCHANGED_MAIN_CLASS);
    }
  }
});

test("558 leaves every screen the same width at 390, because a cap is fluid below itself", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 900 });

  const widths = new Map<string, number>();
  for (const screen of screens(sessionId)) {
    const measured = await measure(page, screen.path);
    expect.soft(measured.width, `${screen.path} is fluid at 390`).toBe(measured.available);
    widths.set(screen.path, measured.width);
  }
  expect(new Set(widths.values()).size, "all sixteen screens measure one width at 390").toBe(1);
});
