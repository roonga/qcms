import type { ElementHandle, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { fillStable, enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addStep,
  createForm,
  field,
  issue,
  issueSummary,
  pinQuestion,
  pinQuestions,
  waitForSaved,
} from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";
import { TOPBAR_SELECTOR } from "../lib/topbar.js";

/**
 * WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum, Level AA), at the width where the admin
 * failed it (issue #1011).
 *
 * ## The defect
 *
 * `.qcms-topbar` is `position: sticky`, so anything the browser scrolls INTO view lands at
 * the viewport's top edge and therefore underneath it. `app/globals.css` reserves room for
 * that with `scroll-padding-block-start`, and the number it reserved was
 * `--admin-topbar-h`: a DERIVED token, one control tall plus the row's padding plus its
 * border, resolving to 57px.
 *
 * The bar wraps. It is a `flex-wrap` row whose nav is the elastic member, so at 390 the nav
 * takes three lines and the bar measures 145px while the reservation stayed at 57. A
 * control focused from further down the page therefore came to rest 88px behind the bar:
 * ENTIRELY hidden, which is the Minimum failure rather than only the Enhanced one. It also
 * engages `plan/admin-mobile-stance.md`'s own narrow-width bar, "no interactive element
 * that cannot be reached".
 *
 * ## Why this cannot be an axe sweep
 *
 * axe measures a rendered page. This criterion is about what SCROLLING does to one, and
 * there is no state of the document at rest in which it is visible - which is why
 * `e2e/a11y-axe.pw.ts` was green throughout and why the finding arrived from a measurement
 * rather than from a gate.
 *
 * ## What is asserted, and why both halves
 *
 * The control is focused and then measured two ways:
 *
 * 1. **Its top is at or below the bar's bottom.** This is the criterion's own geometry, and
 *    it is the half that fails today at 390.
 * 2. **`document.elementFromPoint` at its centre is the control or a descendant.** Geometry
 *    alone would accept a control sitting below the bar with something else painted over
 *    it, and "obscured" is about what a reader can see rather than about coordinates.
 *
 * ## Why 1440 as well as 390
 *
 * The wide layout passes today, so it is the regression risk rather than the finding: a fix
 * that reserved the wrong thing, or that published a height only a narrow viewport
 * produces, would show up here and nowhere else.
 *
 * ## The three journeys
 *
 * `/forms/{formId}` and `/questions` are the two the issue measured. The third is the
 * validation-issue link, which is item 2 of `plan/admin-mobile-stance.md`'s supported
 * narrow-width workflow ("follow an issue to the thing that caused it") and travels a
 * different code path to the same place: `components/forms/validation-panel.tsx` calls
 * `scrollIntoView({ block: "nearest" })` and then `focus()` by hand, so a fix that only
 * covered the browser's own focus scrolling would leave the supported path broken.
 */

const EMAIL = uniqueAdminEmail("obscured1011");

/** The seeded insurance fixture, as `reflow.pw.ts` uses it: published v1, four secure links. */
const FORM_ID = "frm_auto_quote";

/** Built once by `beforeAll`. */
let totpSecret = "";

/** The narrow viewport the Code Owner's standing gate uses, and the one the issue measured. */
const NARROW = { width: 390, height: 844 } as const;
/** The wide layout, measured for regression rather than for the finding. */
const WIDE = { width: 1440, height: 900 } as const;

/**
 * Published library questions the third journey pins to give a step screen its height.
 *
 * The seeded corpus, one version each and never two versions of the same question - a
 * second version of one id is `DUPLICATE_QUESTION_IN_FORM`, which would put a second issue
 * in the panel this test reads. They come from `apps/api/e2e/support/seed.ts`, where
 * `seedQuestionVersion` creates and publishes exactly v1 of each; a missing one fails on
 * `pinQuestions`' own assertion, naming the id, rather than here.
 */
const LIBRARY_PINS = [
  { questionId: "q_full_name", version: 1 },
  { questionId: "q_dob", version: 1 },
  { questionId: "q_optional_cover", version: 1 },
  { questionId: "q_extra_detail", version: 1 },
  { questionId: "q_coverage_level", version: 1 },
  { questionId: "q_annual_km", version: 1 },
  { questionId: "q_body_type", version: 1 },
  { questionId: "q_overnight_parking", version: 1 },
  { questionId: "q_accident_count", version: 1 },
] as const;

/** Everything one landing is judged on, read in a single evaluate so nothing moves between. */
interface Landing {
  readonly barBottom: number;
  readonly barHeight: number;
  readonly controlTop: number;
  readonly controlBottom: number;
  readonly focused: boolean;
  readonly hitIsControl: boolean;
  readonly scrollPadding: number;
  readonly describe: string;
}

/**
 * Read where a focused control came to rest, and what is painted over its middle.
 *
 * `elementFromPoint` is asked for the control's own centre and the answer is accepted when
 * it IS the control or lives inside it, because a link's centre is usually a text span
 * rather than the anchor itself. Anything else - the bar, an overlay, the document element -
 * means something is in front of it.
 */
async function landingOf(handle: ElementHandle<HTMLElement | SVGElement>): Promise<Landing> {
  return handle.evaluate((element, selector) => {
    const bar = document.querySelector(selector);
    if (bar === null) throw new Error("the shell's top bar must be on screen");
    const barRect = bar.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.top + rect.height / 2),
    );
    // The reservation, resolved to pixels by the browser rather than read as a string: it
    // is a `var()` with a fallback over a `calc()`, so the declaration proves nothing.
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.blockSize = getComputedStyle(document.documentElement).scrollPaddingTop;
    document.documentElement.append(probe);
    const scrollPadding = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      barBottom: barRect.bottom,
      barHeight: barRect.height,
      controlTop: rect.top,
      controlBottom: rect.bottom,
      focused: document.activeElement === element,
      hitIsControl: hit !== null && (element === hit || element.contains(hit)),
      scrollPadding,
      describe: `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`,
    };
  }, TOPBAR_SELECTOR);
}

/**
 * Scroll to the bottom, then move focus to a control the scroll left ABOVE the viewport -
 * and keep trying candidates until the page actually moves for one.
 *
 * ## Why the search, rather than taking the first one
 *
 * Because a control that needs no scroll proves nothing, and two shapes of those are on
 * these screens. One is a control inside a sticky region, which is on the viewport wherever
 * the page is. The other is a control whose target scroll position clamps to zero. Focus on
 * either leaves the page where it was, the control is wherever it always was - usually well
 * clear of the bar - and a journey that asserted its position would pass whatever the
 * reservation said. That is not hypothetical: the first draft of this file took the first
 * candidate, and the geometry assertion below passed against the unfixed sheet.
 *
 * So the loop keeps a candidate only when `focus()` SCROLLED THE PAGE UP for it. That is
 * the whole mechanism under test - the browser choosing a scroll position for a focused
 * element, and the page's `scroll-padding-block-start` deciding where the top edge is - so
 * a candidate that did not trigger it is not a measurement of anything.
 *
 * ## Why it all happens in one evaluate
 *
 * `focus()` scrolls synchronously, so the before and after scroll positions are readable
 * without waiting for anything, and the page is never left half-scrolled between round
 * trips. Scoped to `<main>` so the bar's own nav, which is never scrolled anywhere, cannot
 * be chosen.
 *
 * It throws rather than skipping when no candidate moves the page: a journey that quietly
 * measured nothing is exactly how this class of defect survives a green suite.
 */
async function focusFromAboveTheFold(
  page: Page,
  where: string,
): Promise<ElementHandle<HTMLElement | SVGElement>> {
  const handle = await page.evaluateHandle((label: string) => {
    const main = document.querySelector("main#main-content");
    if (main === null) throw new Error(`${label}: the shell's main region must be on screen`);
    const candidates = [
      ...main.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
          'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (candidates.length === 0) throw new Error(`${label}: this screen has no focusable control`);

    const bottom = (): void => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    };
    bottom();
    if (window.scrollY <= 0) {
      throw new Error(
        `${label}: the screen does not overflow its viewport, so there is no scroll for a ` +
          `focus to come to rest in. Pick a longer screen.`,
      );
    }

    for (const element of candidates) {
      bottom();
      // Above the viewport, rather than merely elsewhere: scrolling DOWN to a target uses
      // `scroll-padding-block-end`, and the page has no sticky footer, so a target below the
      // fold would land clear of the bar whatever this fix did.
      if (element.getBoundingClientRect().bottom >= 0) continue;
      const before = window.scrollY;
      element.focus();
      if (window.scrollY < before - 1) return element;
    }
    throw new Error(
      `${label}: scrolled to the bottom and no focusable control above the fold made the ` +
        `page scroll when it took focus, so this journey measures nothing.`,
    );
  }, where);
  return handle;
}

/**
 * The whole journey at one width: land on the screen, scroll to its bottom, move focus back
 * up to something the scroll hid, and report where that control came to rest.
 */
async function focusFromBelow(
  page: Page,
  path: string,
  size: { readonly width: number; readonly height: number },
): Promise<Landing> {
  await page.setViewportSize(size);
  await page.goto(path);
  await expect(page.locator("main#main-content"), `${path} renders the shell`).toHaveCount(1);
  // The height is published from a mount effect, and the shell's own effect runs BEFORE the
  // root layout's hydration marker, so observing the marker is enough to know it has run.
  await waitForHydration(page);
  return landingOf(await focusFromAboveTheFold(page, `${path} at ${String(size.width)}`));
}

/** One landing, judged. Soft, so a failing width still reports the other's verdict. */
function expectClearOfTheBar(landing: Landing, where: string): void {
  expect.soft(landing.focused, `${where}: the control took focus`).toBe(true);
  expect
    .soft(
      landing.controlTop,
      `${where}: ${landing.describe} came to rest at ${String(Math.round(landing.controlTop))}, ` +
        `and the ${String(Math.round(landing.barHeight))}px bar ends at ` +
        `${String(Math.round(landing.barBottom))} (scroll padding reserved ` +
        `${String(Math.round(landing.scrollPadding))}) - SC 2.4.11`,
    )
    // Half a pixel of tolerance: the bar's height is fractional at some device pixel
    // ratios, and the published value is rounded UP, so the two meet within a rounding.
    .toBeGreaterThanOrEqual(landing.barBottom - 0.5);
  expect
    .soft(landing.hitIsControl, `${where}: the control's own centre is what is painted there`)
    .toBe(true);
  // THE RESERVATION ITSELF, which is the fix stated as a property of the page rather than of
  // this journey's geometry. `scroll-padding-block-start` has to cover the bar's RENDERED
  // height, not the height a token derives from the control size: at 390 those are 145 and
  // 57, and it is the second number that put a focused control 88px behind the bar. Reading
  // it here means every journey in this file fails on the defect even when its own scroll
  // happened to land somewhere harmless. Reserving MORE than the bar is not a defect, so
  // this is a floor rather than an equality.
  expect
    .soft(
      landing.scrollPadding,
      `${where}: the page reserves the bar's rendered height ` +
        `(${String(Math.round(landing.barHeight))}) when it scrolls something into view`,
    )
    .toBeGreaterThanOrEqual(landing.barHeight - 0.5);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

test("1011 focus reached from below clears the top bar on a form, at 390 and at 1440", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const path = `/forms/${FORM_ID}`;

  expectClearOfTheBar(await focusFromBelow(page, path, NARROW), `${path} at 390`);
  expectClearOfTheBar(await focusFromBelow(page, path, WIDE), `${path} at 1440`);
});

test("1011 focus reached from below clears the top bar on the question library", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  expectClearOfTheBar(await focusFromBelow(page, "/questions", NARROW), "/questions at 390");
  expectClearOfTheBar(await focusFromBelow(page, "/questions", WIDE), "/questions at 1440");
});

/**
 * Item 2 of the supported narrow-width workflow: follow a validation issue to the control
 * that caused it (`plan/admin-mobile-stance.md`).
 *
 * The issue is a `DEPRECATED_PIN`, which is the cheapest way to an anchored pin issue that
 * needs no agent and no hand-written draft: publish a question, pin it into a new form, then
 * deprecate the version underneath the pin. The API's deprecated-pin gate raises it because
 * the placement was never in a previous published version of this form, and its path names
 * the question, so `anchorFor` resolves to the pin row's own DOM id in the step editor.
 *
 * The link's handler is not the browser's focus scrolling: it selects the owning step and
 * then calls `scrollIntoView({ block: "nearest" })` and `focus()` itself. Both honour the
 * page's scroll padding, which is what makes this the same fix and worth asserting
 * separately.
 */
test("1011 following a validation issue lands the pin row clear of the top bar at 390", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const run = Date.now().toString(36);

  // A published question of this run's own, so the pin resolves and the deprecation below
  // touches nothing the rest of the suite reads.
  await createDraft(page, `e2e-obscured-${run}`, "Single choice");
  const questionId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(questionId, "the created question owns the URL").toMatch(/^q_/u);
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  const formId = await createForm(page, `e2e-obscured-${run}`, "Obscured focus");
  await addStep(page, "Details");
  // THE DEPRECATED PIN GOES IN FIRST, so it is row one of the step's grid and therefore the
  // highest thing on that screen an issue can send a reader to. The seeded library follows
  // it, and the length is the point rather than the content: the step's screen has to be at
  // least as tall as the form's, or the browser clamps the scroll position on the way
  // between them and the jump becomes a downward one, which exercises nothing here. The
  // assertion at the end of this test is what would catch that, named.
  await pinQuestion(page, questionId, 1);
  await pinQuestions(page, LIBRARY_PINS);
  await waitForSaved(page);

  // Deprecate the version underneath the first pin. This form has never been published, so
  // the placement was not carried over from a previous published version and the API's
  // deprecated-pin gate raises the issue.
  await page.goto(`/questions/${questionId}`);
  await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");

  await page.setViewportSize(NARROW);
  await page.goto(`/forms/${formId}`);
  await waitForHydration(page);
  // The builder does not seed a verdict on mount (`lib/server/form-verdict.ts`), so an edit
  // is what asks the server. Retyping the title is the smallest one that changes the draft.
  await fillStable(field(page, "Form title"), "Obscured focus, checked");
  await expect(issueSummary(page)).toContainText("would block a publish", { timeout: 30_000 });

  const link = issue(page, "DEPRECATED_PIN").filter({ hasText: questionId }).first();
  await expect(link).toBeVisible();

  // Scrolled so the link sits just UNDER the bar: as deep into the form's screen as it can
  // go while the link is still fully visible, so Playwright's own click needs no scroll of
  // its own and the destination is left above the fold. Every screen of this route shares
  // the bar, the breadcrumb and the rail, and the validation panel is below the title field
  // and the rules lens, so a pin row on the step screen is always higher up the document
  // than the link that names it.
  await link.evaluate((element, selector) => {
    const bar = document.querySelector(selector);
    if (bar === null) throw new Error("the shell's top bar must be on screen");
    window.scrollBy(
      0,
      element.getBoundingClientRect().top - bar.getBoundingClientRect().bottom - 4,
    );
  }, TOPBAR_SELECTOR);
  await link.click();

  const row = page.locator(`#pin-${questionId}`);
  await expect(row).toBeFocused();
  const handle = await row.elementHandle();
  // `elementHandle()` resolves once the locator matches, and it has above, so this is a
  // type narrowing rather than a wait: a null here would mean the row left the document
  // between the focus assertion and this line.
  expect(handle, "the pin row the issue names is on screen").toBeTruthy();
  if (!handle) return;

  const landing = await landingOf(handle);
  // The geometry of the landing is judged exactly as the other two journeys are. What is
  // deliberately NOT pinned here is where the step's screen comes to rest underneath it: a
  // soft screen switch clamps the scroll position to the new screen's height, so whether
  // the jump ends up scrolling up, down or not at all is a property of how tall this
  // fixture's step editor happens to be rather than of the fix. The reservation assertion
  // inside `expectClearOfTheBar` is what makes this journey fail without the fix, and it
  // is a fact about the page rather than about the fixture.
  expectClearOfTheBar(landing, "the pin row reached from its issue at 390");
});
