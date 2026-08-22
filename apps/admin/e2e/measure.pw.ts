import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

/**
 * The width cap is set by the route, and every route's column is left-anchored.
 * Issues 558, 648 and 657.
 *
 * Each of the sixteen authenticated screens takes the cap its own POC draws.
 * `lib/measure.ts` holds that as one table and `measure.test.ts` proves the table covers
 * exactly the route tree. Neither of those checks that the cap reaches the browser, which
 * is what this spec is for: it opens all sixteen screens and measures the shell's content
 * column.
 *
 * ## What is asserted, and why it is four things rather than one
 *
 * - The **computed cap** on `<main>` is the value the route's row asks for. This is the
 *   check that the utility class actually compiled: `max-w-measure-*` classes come from
 *   theme tokens in `app/globals.css`, and a token Tailwind never emitted produces a
 *   `max-width: none` that looks like "wide" on a narrow viewport and is nothing of the
 *   kind. Seven of the eight names are tokens, so this is seven separate chances to ship
 *   a cap that silently does not exist.
 * - At **1280** the measured box is the cap or the room available, whichever is smaller.
 *   That is issue 657's acceptance in the only terms a reviewer can check.
 * - At **1280** the column's left edge is the **left of the space it has**: the rail's
 *   right edge where a rail is beside it, and the viewport's origin where there is none.
 *   That is issue 648's acceptance, and it is asserted on all sixteen rather than sampled
 *   because a single `mx-auto` reintroduced anywhere puts one screen back.
 * - At **390** every one of the sixteen measures the SAME width. It is a property of the
 *   mechanism rather than of the values: a cap is fluid below itself, so no breakpoint is
 *   involved at any width, and a phone sees none of this change.
 *
 * The expected assignment below is restated from the POCs rather than imported from
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

/**
 * The caps, in the CSS pixels `getComputedStyle` reports them as, each with the POC that
 * draws it. `default` (1024) is absent on purpose: since issue 657 no route takes it, and a
 * screen that measures 1024 here is a screen that has fallen off the table.
 */
const CAP_PX = {
  /** `settings-newquestion-poc.html` `.page-main`, on both of that file's screens. */
  prose: 640,
  /**
   * The narrow measure. `question-editor-poc.html` draws a 720px `.editor-column` and
   * `preview-versions-poc.html` a 640px `.respondent-frame`, both INSIDE their POC's
   * `.main` padding; this cap sits on a `<main>` that carries `p-6`, so 45rem renders a
   * 672px column, which is the closest available token to both.
   */
  narrow: 720,
  /** `deployment-ops-poc.html` `.ops-inner--responses`. */
  ops: 900,
  /** `library-lists-poc.html` `.main`. */
  list: 1080,
  /** `deployment-ops-poc.html` `.ops-inner--erasures`. */
  log: 1180,
  /**
   * The `.main` of every POC that caps it and draws nothing narrower inside - and, for
   * `/webhooks`, the cap that route keeps because its drawing (1820,
   * `deployment-ops-poc.html` `.ops-inner--webhooks`) is wider than any token here.
   */
  wide: 1600,
} as const;

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
    { path: "/forms", cap: "list" },
    { path: `/forms/${FORM_ID}`, cap: "wide" },
    { path: `/forms/${FORM_ID}/links`, cap: "wide" },
    { path: `/forms/${FORM_ID}/preview`, cap: "narrow" },
    { path: `/forms/${FORM_ID}/responses`, cap: "wide" },
    { path: `/forms/${FORM_ID}/responses/${sessionId}`, cap: "wide" },
    { path: `/forms/${FORM_ID}/versions`, cap: "wide" },
    { path: `/forms/${FORM_ID}/versions/1`, cap: "narrow" },
    { path: `/forms/${FORM_ID}/webhooks`, cap: "wide" },
    { path: "/questions", cap: "list" },
    { path: `/questions/${QUESTION_ID}`, cap: "narrow" },
    { path: "/questions/new", cap: "prose" },
    { path: "/responses", cap: "ops" },
    { path: "/responses/erasures", cap: "log" },
    { path: "/settings", cap: "prose" },
    { path: "/webhooks", cap: "wide" },
  ];
}

/** What one screen's content column measures, and how much room it had to do it in. */
type Measured = {
  readonly cap: number;
  readonly width: number;
  readonly available: number;
  /** The column's left edge, and the left edge of the space it was given. */
  readonly left: number;
  readonly spaceStartsAt: number;
  readonly className: string;
};

/**
 * Open a screen and measure its content column.
 *
 * Requiring exactly one `<main id="main-content">` rules out a `notFound()`, which renders
 * Next's built-in 404 under the root layout and has no `<main>` at all.
 *
 * IT DOES NOT RULE OUT A LOST SESSION, which a comment here used to claim it did on the
 * grounds that the auth screen's `<main>` carries no id. It does:
 * `components/auth-screen.tsx` renders `<main id="main-content">` too. What actually
 * catches a lost session is the measurement rather than the locator - the auth card is
 * capped at `max-w-md`, 448px, which matches no row in the table - so the cap assertion
 * fails loudly instead of silently measuring the sign-in screen. Recorded accurately here
 * rather than left as a guard that does not guard.
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
    // `.qcms-rail` rather than a testid, because there are three rail COMPONENTS and they
    // do not share one: `qcms-rail` (the form subtree, issue 559), `qcms-settings-rail`
    // (issue 562) and `qcms-question-rail` (issue 650). What they do share is the class,
    // which is also what `app/globals.css` keys the two-track grid off
    // (`.qcms-shell-body:has(> .qcms-rail)`), so it is the selector that means "a rail is
    // occupying the first track" rather than "a particular rail is on screen".
    const rail = document.querySelector(".qcms-rail")?.getBoundingClientRect();
    const besideTheColumn = rail !== undefined && rail.right <= box.left;
    return {
      cap: Number.parseFloat(getComputedStyle(element).maxWidth),
      width: box.width,
      available: document.documentElement.clientWidth - (besideTheColumn ? rail.width : 0),
      left: box.left,
      // Where the column's available space begins (issue 648): the rail's right edge when
      // the rail is genuinely beside it, and the viewport origin otherwise. Below
      // `--bp-sidebar` the rail stacks ABOVE `<main>` and takes no inline space, which is
      // why this reads the measured box rather than the presence of the element.
      spaceStartsAt: besideTheColumn ? rail.right : 0,
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

test("657 caps each screen at the width its own POC draws, at 1280", async ({ page }) => {
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
    // Issue 648, on every screen rather than a sample: the column starts at the left of
    // the space it has. Where a rail is beside it that is the rail's edge, so the two
    // systems share one edge down the page instead of reading as two layouts.
    expect
      .soft(measured.left, `${screen.path} is left-anchored in the space it has`)
      .toBe(measured.spaceStartsAt);
    expect
      .soft(measured.className, `${screen.path} carries no centring utility`)
      .not.toContain("mx-auto");
  }
});

test("648 puts the wordmark, the nav and the content column on one left edge, at 1280", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  // The bar itself takes no cap: the `.topbar__inner` of every POC that draws the shell
  // has no `max-width` and no
  // auto margin, so it spans the viewport and its first item starts at the bar's own
  // inline padding. It carried `mx-auto max-w-5xl` until issue 648, which put the wordmark
  // ~145px in from the page edge at 1280 while the content column started at 24px.
  //
  // A screen with NO rail is the one where the three edges must coincide exactly; on a
  // railed screen the column deliberately starts at the rail's edge instead, which is
  // asserted in the sweep above.
  await page.goto("/webhooks");
  // Same reason as the sweep's helper: three rail components, one shared class. Asserting
  // the class is absent is the claim "no rail occupies the first track here", which is what
  // makes the three edges below comparable to the viewport's origin.
  await expect(page.locator(".qcms-rail"), "a screen with no rail").toHaveCount(0);

  const edges = await page.evaluate(() => {
    // THE EDGE IS THE CONTENT EDGE, NOT THE BORDER EDGE, and the distinction is the whole
    // measurement. `<main>` and `<footer>` are full-width boxes whose padding holds their
    // text in; the wordmark is a span sitting inside the bar's padding. Comparing
    // `getBoundingClientRect().left` across the three compares 24 against 0 and says
    // nothing about alignment. What an operator sees line up is where the TEXT starts.
    const contentLeft = (selector: string) => {
      const element = document.querySelector(selector);
      if (element === null) return Number.NaN;
      const pad = Number.parseFloat(getComputedStyle(element).paddingInlineStart);
      return element.getBoundingClientRect().left + (Number.isNaN(pad) ? 0 : pad);
    };
    const header = document.querySelector("header");
    const trailing = document.querySelector("header nav")?.parentElement?.nextElementSibling;
    const nav = document.querySelector("header nav")?.parentElement?.getBoundingClientRect();
    return {
      wordmark: contentLeft(".qcms-wordmark"),
      main: contentLeft("main#main-content"),
      footer: contentLeft("footer"),
      wordmarkRight:
        document.querySelector(".qcms-wordmark")?.getBoundingClientRect().right ?? Number.NaN,
      navLeft: nav?.left ?? Number.NaN,
      navRight: nav?.right ?? Number.NaN,
      trailingLeft:
        trailing === null || trailing === undefined
          ? Number.NaN
          : trailing.getBoundingClientRect().left,
      // The bar spans, and its contents span with it: the box reaches both edges of the
      // viewport, and the trailing controls sit against the far edge inside the same
      // padding. Together those rule out the shape this issue reported - a centred 1024px
      // box whose contents merely happen to start on its left.
      barWidth: header === null ? Number.NaN : header.getBoundingClientRect().width,
      trailingRight:
        trailing === null || trailing === undefined
          ? Number.NaN
          : trailing.getBoundingClientRect().right,
      viewport: document.documentElement.clientWidth,
    };
  });

  expect(edges.barWidth, "the bar spans the viewport rather than being capped").toBe(
    edges.viewport,
  );
  expect(edges.wordmark, "the wordmark starts at the shared edge").toBe(edges.main);
  expect(edges.footer, "and so does the footer").toBe(edges.main);
  // The bar's own inline padding, read off the shared edge rather than hard-coded, so this
  // still holds if the shell's padding is ever retuned.
  expect(
    edges.trailingRight,
    "and the trailing controls reach the far edge, so the bar is not a centred box",
  ).toBe(edges.viewport - edges.wordmark);

  // THE NAV, which the acceptance names alongside the wordmark. It cannot literally share
  // the wordmark's left edge: both POC and app put it on the same row, immediately after
  // the mark (`.topbar__nav { flex: 1 1 160px }`). What the acceptance is about is that
  // the bar's members are laid out from the PAGE's edges rather than from a centred
  // 1024px box, and these three orderings say exactly that - mark, then nav, then trailing
  // controls, spanning between the two edges asserted above.
  expect(edges.navLeft, "the nav follows the mark on the same row").toBeGreaterThan(
    edges.wordmarkRight,
  );
  expect(edges.navRight, "and runs up to the trailing controls").toBeLessThanOrEqual(
    edges.trailingLeft,
  );
  expect(
    edges.trailingLeft - edges.navLeft,
    "so the nav spans the bar rather than sitting inside a capped box",
  ).toBeGreaterThan(edges.viewport / 2);
});

test("648 leaves the auth screens centred, because their own POC centres them", async ({
  page,
}) => {
  // THE GUARD AGAINST THE OBVIOUS SWEEP. `mx-auto` is exactly what someone implementing
  // "left-anchor the admin" would grep for and delete, and `components/auth-screen.tsx` is
  // one component behind five routes an operator meets before anything else in the app
  // works. Nothing else in the suite would notice: no assertion anywhere says a sign-in
  // card is centred, so the deletion would ship green.
  //
  // It must not be swept, because `plan/admin-shell-poc/auth-poc.html` centres it on
  // purpose and does so in a spelling no `mx-auto` grep can see - `.auth-shell { display:
  // flex; align-items: center; justify-content: center; }` over a 26rem `.auth-main`,
  // centred on both axes because it is a sign-in card. The shipped component agrees with
  // its drawing already. Left-anchoring is the SHELL's rule; these routes are not in it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/sign-in");

  const card = page.locator("main#main-content");
  await expect(card, "the sign-in screen renders").toHaveCount(1);
  const box = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewport: document.documentElement.clientWidth,
    };
  });
  // Equal gutters either side, which is what an auto margin produces and what the POC's
  // flex centring produces. Asserted as the symmetry rather than as a class name, so it
  // holds whichever of the two spellings the component uses.
  expect(box.left, "the auth card is centred horizontally").toBeCloseTo(
    box.viewport - box.right,
    0,
  );
  expect(box.left, "and is genuinely inset rather than full width").toBeGreaterThan(0);
});

test("657 leaves every screen the same width at 390, because a cap is fluid below itself", async ({
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
