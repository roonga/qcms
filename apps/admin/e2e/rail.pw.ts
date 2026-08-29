import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  createRailFixture,
  RAIL_FORM_TITLE,
  RAIL_LONG_STEP_TITLE,
  RAIL_SHORT_STEP_TITLE,
} from "./support/rail.js";

/**
 * The form-subtree rail in a browser (`plan/admin-design-contracts.md` §7, issue 559).
 *
 * The markup and the contents are pinned without a browser
 * (`components/forms/form-subtree-rail.test.tsx`, `lib/forms/subtree-rail.test.ts`). What
 * is left is everything that is a computed style, a measured box or an interaction, and
 * that is what this file is: the 240px track appearing at `--bp-sidebar` and not one pixel
 * below it, the disclosure being operable from the keyboard, a long title behaving the way
 * this change says it behaves, the badge arriving from a real API verdict, N2's
 * viewport-fill, and the whole thing working with no JavaScript at all.
 *
 * ## The 1023 / 1024 pair
 *
 * Same shape issue 557's pair takes, and for the same reason: a boundary is only pinned by
 * measuring both sides of it. §1 gives the app two breakpoints and `--bp-sidebar` is the
 * one the rail turns at, so a rail that collapsed at 1000 or at 1100 would be a third
 * boundary nobody wrote down.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("rail559");
const RUN = Date.now().toString(36);

/** `--bp-sidebar` is 64rem, and the browser's default root size makes that 1024px. */
const SIDEBAR = 1024;

/** Set by the first test; every later one signs in and reuses the fixture it built. */
let totpSecret = "";
let formId = "";
/** The fixture form's slug, which is what the collapsed summary names (issue 693). */
let railSlug = "";

/** The reference screen: the rail is wired on the secure-links route (issue 559). */
function linksPath(): string {
  return `/forms/${formId}/links`;
}

/** The boxes the geometry assertions are about, read in one round trip. */
async function boxes(page: Page): Promise<{
  readonly railWidth: number;
  readonly railRight: number;
  readonly railBottom: number;
  readonly mainLeft: number;
  readonly mainTop: number;
  readonly mainBottom: number;
  readonly viewportWidth: number;
}> {
  return page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-rail"]');
    const main = document.querySelector("main#main-content");
    if (rail === null || main === null) throw new Error("the rail and the column must both exist");
    const railBox = rail.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    return {
      railWidth: railBox.width,
      railRight: railBox.right,
      railBottom: railBox.bottom,
      mainLeft: mainBox.left,
      mainTop: mainBox.top,
      mainBottom: mainBox.bottom,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("559 turns the rail into a 240px column at --bp-sidebar, and not one pixel below", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  const fixture = await createRailFixture(page, RUN);
  formId = fixture.formId;
  railSlug = fixture.slug;

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto(linksPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();
  const at = await boxes(page);
  expect(at.railWidth, "the rail is the 240px track §7 asks for").toBe(240);
  expect(at.railRight, "the rail is beside the content column, not over it").toBeLessThanOrEqual(
    at.mainLeft,
  );
  expect(at.railBottom, "the two tracks share a row, so they end together").toBeCloseTo(
    at.mainBottom,
    0,
  );

  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto(linksPath());
  const below = await boxes(page);
  expect(below.railWidth, "one pixel below the boundary the rail is the full width").toBe(
    below.viewportWidth,
  );
  expect(
    below.railBottom,
    "and it is stacked above the column rather than beside it",
  ).toBeLessThanOrEqual(below.mainTop);
});

test("559 collapses into a disclosure that works from the keyboard and says which state it is in", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(linksPath());

  const disclosure = page.locator("details.qcms-rail__disclosure");
  const summary = page.locator("summary.qcms-rail__summary");

  // SHUT BY DEFAULT HERE (Code Owner decision, 2026-08-23). A narrow viewport opens on the
  // one summary line rather than on a rail pushing the screen's own content down, and the
  // state is real rather than painted: the attribute is what the browser announces, so a
  // rail that merely LOOKED shut would tell a screen reader the opposite of the picture.
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeHidden();

  // Focusable by construction rather than by a tabindex we added: `focus()` moves nothing
  // if the element cannot take focus, so this is the check and not a formality.
  await summary.focus();
  expect(
    await page.evaluate(() => document.activeElement?.tagName.toLowerCase()),
    "the summary takes keyboard focus",
  ).toBe("summary");

  // A native `<details>` is what carries the announced state, so Enter is the browser's
  // own toggle and there is no `aria-expanded` of ours that could drift from it.
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeHidden();
});

test("the rail opens by default at --bp-sidebar and stays shut one pixel below it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const disclosure = page.locator("details.qcms-rail__disclosure");

  // The pair, because a default that flipped at 900 or at 1200 would be a third boundary
  // nobody wrote down. `open` is an attribute and no media query sets one, so this is the
  // assertion that the browser-side decision agrees with the stylesheet's boundary.
  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto(linksPath());
  await expect(disclosure, "at the boundary the sidebar is open").toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeVisible();

  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto(linksPath());
  await expect(disclosure, "one pixel below it the band is shut").not.toHaveAttribute("open", "");

  // Resizing across the boundary re-decides it, which is the half a reload cannot show.
  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await expect(disclosure).toHaveAttribute("open", "");
});

test("559 names the form in the summary and keeps it on one line at 390", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(linksPath());

  // The FORM, not the section this screen is (issue 693). Shut, at this width, that one
  // line is the whole rail, and what it owes a reader is the scope the rail belongs to: the
  // section is named by the row inside the rail and by the screen's own `<h1>`, which since
  // issue 692 reads "Links: <slug>" and would otherwise have the summary as its first half.
  // WHAT THE AUTHOR CALLED IT, not how it is addressed (Code Owner, 2026-08-26). The
  // summary named the slug; it names the form's title now, falling back to the slug only
  // for a form nobody has titled. `createRailFixture` gives this one "Household cover",
  // and the slug is asserted absent so the fallback cannot pass this by accident.
  await expect(page.locator(".qcms-rail__summary-text")).toHaveText(RAIL_FORM_TITLE);
  await expect(page.locator(".qcms-rail__summary-text")).not.toHaveText(railSlug);

  const summary = await page.locator(".qcms-rail__summary-text").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      textOverflow: style.textOverflow,
      overflow: style.overflowX,
      whiteSpace: style.whiteSpace,
      overflows: element.scrollWidth > element.clientWidth,
    };
  });
  expect(summary.textOverflow, "§7's ellipsis").toBe("ellipsis");
  expect(summary.overflow).toBe("hidden");
  expect(summary.whiteSpace).toBe("nowrap");
  // The slug is short, so the row it sits in must not be scrolling sideways at 390 either.
  expect(summary.overflows).toBe(false);
  const row = page.locator("summary.qcms-rail__summary");
  const fits = await row.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits, "the summary row fits the 390px viewport").toBe(true);
});

test("559 wraps a long step title inside the column rather than hiding its end", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(linksPath());

  const long = page
    .locator('[data-rail-group="steps"] a')
    .filter({ hasText: RAIL_LONG_STEP_TITLE });
  const short = page
    .locator('[data-rail-group="steps"] a')
    .filter({ hasText: RAIL_SHORT_STEP_TITLE });
  const longBox = await long.boundingBox();
  const shortBox = await short.boundingBox();
  expect(longBox, "the long-titled step renders").not.toBeNull();
  expect(shortBox, "the short-titled step renders").not.toBeNull();
  // The decision this change makes, measured: in a permanent 240px sidebar a long title
  // takes more lines rather than losing its end, because the end is often the only thing
  // that tells two steps apart and nothing here carries the untruncated text.
  expect(longBox?.width ?? 0, "the row stays inside the 240px track").toBeLessThanOrEqual(240);
  expect(longBox?.height ?? 0, "and it wraps rather than truncating").toBeGreaterThan(
    shortBox?.height ?? 0,
  );
});

test("559 badges the step whose pin the library deprecated, from the API's own verdict", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(linksPath());

  const badged = page
    .locator('[data-rail-group="steps"] a')
    .filter({ hasText: RAIL_LONG_STEP_TITLE })
    .locator("[data-rail-issues]");
  await expect(badged, "the step holding the deprecated pin carries its count").toBeVisible();
  await expect(badged).toHaveText(/^\d+ issues?$/u);
  // The other step's pin is untouched, so it carries nothing: a badge on every row would
  // mean the count was decoration rather than a verdict.
  await expect(
    page
      .locator('[data-rail-group="steps"] a')
      .filter({ hasText: RAIL_SHORT_STEP_TITLE })
      .locator(".qcms-tag"),
  ).toHaveCount(0);
});

test("559 lets a short screen's rail reach the bottom of the shell (N2)", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Taller than this screen's content on purpose: N2 is invisible at a viewport the
  // content already fills, which is why `plan/admin-redesign-implementation-plan.md` §1
  // records it as a thing to verify at a viewport taller than the content.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(linksPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();

  const filled = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-rail"]');
    const main = document.querySelector("main#main-content");
    const body = rail?.querySelector(".qcms-rail__body");
    const shell = main?.parentElement?.parentElement;
    if (rail == null || main == null || body == null || shell == null) {
      throw new Error("the shell, the rail, its body and the column must all exist");
    }
    return {
      contentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      shellBottom: shell.getBoundingClientRect().bottom,
      railBottom: rail.getBoundingClientRect().bottom,
      mainBottom: main.getBoundingClientRect().bottom,
      railContentBottom: body.getBoundingClientRect().bottom,
    };
  });

  expect(
    filled.contentHeight,
    "the fixture screen has to be shorter than the viewport for this to mean anything",
  ).toBeLessThanOrEqual(filled.viewportHeight);
  // The property issue 522 found untested, stated the way its own comment asks for.
  expect(filled.shellBottom, "the shell fills the viewport").toBeCloseTo(filled.viewportHeight, 0);
  expect(filled.railBottom, "and the rail's own surface ends where the column does").toBeCloseTo(
    filled.mainBottom,
    0,
  );
  expect(
    filled.railBottom - filled.railContentBottom,
    "which is well below where the rail's own content stops",
  ).toBeGreaterThan(100);
  // THE HALF THIS TEST DID NOT CATCH, and the Code Owner reported it against the running
  // stack: the rail reached the bottom of the SHELL BODY, which is what the two assertions
  // above measure, and stopped short of the SCREEN. A `Signed in as ...` footer spanned
  // both tracks underneath it, so the rail's surface and its border ended a footer's height
  // above the viewport's bottom edge on every screen that had a rail. The footer is gone
  // and the account menu carries the email instead.
  expect(
    filled.railBottom,
    "and it reaches the bottom of the screen, not just the body",
  ).toBeCloseTo(filled.viewportHeight, 0);
  expect(filled.mainBottom, "with nothing left below either track").toBeCloseTo(
    filled.viewportHeight,
    0,
  );
});

test("559 leaves a screen with no rail exactly as wide as it was", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/questions");

  await expect(page.locator(".qcms-rail")).toHaveCount(0);
  // The regression this guards is specific: a grid that declared its 240px track
  // unconditionally would leave an empty one here and push the column right by 240px.
  //
  // ISSUE 648 CHANGED WHAT "AS IT WAS" MEANS, and this test is the place that says so. It
  // asserted equal gutters either side, because the column was centred; the column is now
  // left-anchored on every screen, so equal gutters is exactly the thing that must NOT be
  // true. The claim this test exists to make is untouched: no phantom track pushes a
  // railless column right. Stated as "the column starts at the viewport's origin", which
  // fails on a 240px phantom track just as loudly as the old assertion did and does not
  // also re-assert a layout the app no longer has.
  const offset = await page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    if (main === null) throw new Error("the authenticated shell must be on screen");
    const box = main.getBoundingClientRect();
    return { left: box.left, right: document.documentElement.clientWidth - box.right };
  });
  expect(offset.left, "no phantom rail track pushes the column right").toBe(0);
  expect(offset.right, "and the column is left-anchored rather than centred").toBeGreaterThan(0);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("559 leaves the whole rail working, which is what anchors-not-buttons buys", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await signInWithTotp(page, EMAIL, totpSecret);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(linksPath());

    // Every row is a real anchor with a real destination, so middle-click, open-in-new-tab
    // and a scriptless browser all work. A rail built out of buttons would be inert here.
    const hrefs = await page
      .locator(".qcms-rail__link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    // NINE since 2026-08-26: the form's own row, its steps, the Rules row and the six
    // sibling screens. The Rules row is an anchor here for the same reason every other row
    // is - without JavaScript there is no builder to select anything in, so it navigates.
    expect(hrefs).toHaveLength(9);
    expect(
      hrefs.filter((href) => href.endsWith("#rules")),
      "the rules row is one of them",
    ).toHaveLength(1);
    expect(hrefs.every((href) => href.startsWith("/forms/"))).toBe(true);

    // And the disclosure is the browser's own, so it opens and closes with nothing loaded.
    const disclosure = page.locator("details.qcms-rail__disclosure");
    await page.locator("summary.qcms-rail__summary").click();
    await expect(disclosure).not.toHaveAttribute("open", "");
    await page.locator("summary.qcms-rail__summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
  });
});

const scrollState = async (
  page: Page,
): Promise<{
  readonly pageOverflows: boolean;
  readonly railOverflows: boolean;
  readonly railScrollTop: number;
  readonly railTop: number;
  readonly railBottom: number;
  readonly pageScrollY: number;
  readonly barHeight: number;
  readonly barToken: number;
}> =>
  page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-rail"]');
    const header = document.querySelector("header");
    if (rail === null || header === null) throw new Error("the shell must be on screen");
    const root = document.documentElement;
    // The token resolved to pixels, by letting the browser resolve it: it is a `calc`
    // over another custom property, so reading the string would prove nothing.
    const probe = document.createElement("div");
    probe.style.blockSize = getComputedStyle(root).getPropertyValue("--admin-topbar-h");
    probe.style.position = "absolute";
    root.append(probe);
    const barToken = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      pageOverflows: root.scrollHeight > root.clientHeight,
      railOverflows: rail.scrollHeight > rail.clientHeight,
      railScrollTop: rail.scrollTop,
      railTop: rail.getBoundingClientRect().top,
      railBottom: rail.getBoundingClientRect().bottom,
      pageScrollY: window.scrollY,
      barHeight: header.getBoundingClientRect().height,
      barToken,
    };
  });

test("pins the rail to the viewport below the bar, at the height the token claims", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(linksPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();

  const at = await scrollState(page);
  // THE ONE NUMBER THIS DESIGN DEPENDS ON. The rail's sticky offset and its height are
  // both `--admin-topbar-h`, which is derived from `--admin-control-h` rather than
  // measured off the bar. If the two ever disagree the rail slides under the bar or
  // leaves a gap below it, and neither is loud - so the drift fails here instead.
  expect(at.barHeight, "the bar is exactly what the token derives").toBeCloseTo(at.barToken, 0);
  expect(at.railTop, "the rail starts where the bar ends").toBeCloseTo(at.barHeight, 0);
  expect(at.railBottom, "and ends on the bottom of the screen").toBeCloseTo(900, 0);
});

test("gives neither the rail nor the page a scrollbar when both fit", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Tall enough that this screen and the rail both fit, which is the only viewport at
  // which "only if required" says anything: `overflow-y: auto` offers nothing here,
  // where `scroll` would reserve a gutter in the rail on every screen.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(linksPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();

  const at = await scrollState(page);
  expect(at.pageOverflows, "the screen fits, so the page offers no scrollbar").toBe(false);
  expect(at.railOverflows, "and the rail's rows fit, so neither does it").toBe(false);
});

test("leaves the rail where it is while the screen beside it is scrolled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Short enough that this screen overflows the viewport. The rail may overflow here
  // too - it has nine rows and this is 400px - and that is fine: what is asserted is
  // that moving one does not move the other.
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(linksPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();

  const at = await scrollState(page);
  expect(at.pageOverflows, "this screen is taller than 400px, so the page scrolls").toBe(true);
  expect(at.railScrollTop).toBe(0);

  await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await scrollState(page)).pageScrollY).toBeGreaterThan(0);
  const scrolled = await scrollState(page);
  // PINNED, which is the property the old layout could not give: the rail's rows used
  // to leave the screen as soon as the reader went down the page.
  expect(scrolled.railTop, "the rail stayed under the bar").toBeCloseTo(at.railTop, 0);
  expect(scrolled.railScrollTop, "and its own rows did not move with the page").toBe(0);
});
