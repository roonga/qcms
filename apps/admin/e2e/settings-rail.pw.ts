import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * The Settings rail in a browser (`plan/admin-design-contracts.md` §7a, issue 562).
 *
 * The markup and the section list are pinned without a browser
 * (`components/settings-section-rail.test.tsx`, `lib/settings-sections.test.ts`). What is
 * left is everything that is a computed style, a measured box or a navigation, and that is
 * what this file is: the 240px track turning on at `--bp-sidebar` and not one pixel below
 * it, a fragment anchor actually moving the reader to the section it names, `:target`
 * marking exactly one row and naming it in the collapsed summary, and the whole rail
 * working with no JavaScript at all.
 *
 * ## The one question §7's rail never had to answer
 *
 * On a form-subtree screen the active item is the route, and the server knows it. Here the
 * active section is a URL fragment, which no server is ever sent. It is decided by `:target`
 * in `app/globals.css`, which is why nearly every assertion below is about what the browser
 * did with the URL rather than about what was rendered.
 *
 * ## The 1023 / 1024 pair
 *
 * Same shape issues 557 and 559 take, for the same reason: a boundary is only pinned by
 * measuring both sides of it. §1 gives the app two breakpoints, and a rail that collapsed
 * at 1000 or at 1100 would be a third boundary nobody wrote down.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("settingsrail562");

/** `--bp-sidebar` is 64rem, and the browser's default root size makes that 1024px. */
const SIDEBAR = 1024;

/** Set by the first test; every later one signs in and reuses the account it enrolled. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("562 turns the Settings rail into a 240px column at --bp-sidebar, and not one below", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto("/settings");
  await expect(page.getByTestId("qcms-settings-rail")).toBeVisible();

  const at = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-settings-rail"]');
    const main = document.querySelector("main#main-content");
    if (rail === null || main === null) throw new Error("the rail and the column must both exist");
    return {
      railWidth: rail.getBoundingClientRect().width,
      railRight: rail.getBoundingClientRect().right,
      mainLeft: main.getBoundingClientRect().left,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(at.railWidth, "the 240px track §7a shares with §7").toBe(240);
  // The consequence #623 settled: a rail nested inside `<main>` would take 240px off the
  // measure issue 558 assigned this route. Beside it, the cap keeps measuring the content.
  expect(at.railRight, "the rail is beside the content column, not inside it").toBeLessThanOrEqual(
    at.mainLeft,
  );

  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto("/settings");
  const below = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-settings-rail"]');
    const main = document.querySelector("main#main-content");
    if (rail === null || main === null) throw new Error("the rail and the column must both exist");
    return {
      railWidth: rail.getBoundingClientRect().width,
      railBottom: rail.getBoundingClientRect().bottom,
      mainTop: main.getBoundingClientRect().top,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(below.railWidth, "one pixel below the boundary it is the full width").toBe(
    below.viewportWidth,
  );
  expect(
    below.railBottom,
    "and stacked above the column rather than beside it",
  ).toBeLessThanOrEqual(below.mainTop);
});

test("562 names no section until the URL does, then names exactly that one", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 900 });

  // The decision this change makes, asserted: before a section is chosen there is no active
  // section, and the summary says so with its own name rather than guessing at the topmost.
  await page.goto("/settings");
  await expect(page.locator(".qcms-rail__summary-text")).toHaveText("Sections");
  await expect(page.locator(".qcms-settings-rail__current")).toBeHidden();

  // Then the fragment, which is the only statement of "which section" that exists.
  await page.goto("/settings#two-factor");
  await expect(page.locator(".qcms-rail__summary-text")).toHaveText("Two-factor authentication");

  // Exactly one row marked, and the mark is not colour alone: the visually-hidden phrase
  // that replaces `aria-current` is in the accessibility tree for that row and no other.
  const current = page.locator(".qcms-settings-rail__current");
  await expect(current).toHaveCount(3);
  const announced = await current.evaluateAll((spans) =>
    spans
      .filter((span) => getComputedStyle(span).display !== "none")
      .map((span) => span.closest("a")?.getAttribute("href") ?? ""),
  );
  expect(announced, "one row announces itself current, and it is the one the URL names").toEqual([
    "#two-factor",
  ]);
});

test("562 follows a section anchor to the section it names, clear of the sticky topbar", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto("/settings");

  await page.locator('.qcms-settings-rail__link[href="#two-factor"]').click();
  await expect(page).toHaveURL(/#two-factor$/u);

  const landed = await page.evaluate(() => {
    const section = document.querySelector("#two-factor");
    const topbar = document.querySelector(".qcms-topbar");
    if (section === null || topbar === null) throw new Error("the section and topbar must exist");
    return {
      sectionTop: section.getBoundingClientRect().top,
      topbarBottom: topbar.getBoundingClientRect().bottom,
      focusedId: document.activeElement?.id ?? "",
    };
  });
  // `scroll-margin-block-start` earning its place: without it the heading parks underneath
  // the sticky topbar, which is a jump that lands on the wrong thing.
  expect(landed.sectionTop, "the section clears the sticky topbar").toBeGreaterThanOrEqual(
    landed.topbarBottom,
  );
  // And focus moved into the section, so the next Tab continues from where the reader chose
  // rather than from the rail.
  expect(landed.focusedId, "following the anchor moves focus into the section").toBe("two-factor");
});

test("562 keeps every rail row pointing at a section that exists and is named the same", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");

  // A rail row whose fragment nothing carries scrolls nowhere and marks nothing, silently.
  // Checked against the live DOM as well as against the list, because the page renders its
  // three cards by hand rather than by mapping.
  const rows = await page.locator(".qcms-settings-rail__link").evaluateAll((links) =>
    links.map((link) => {
      const href = link.getAttribute("href") ?? "";
      const section = document.querySelector(href);
      return {
        href,
        rowText: link.textContent?.trim() ?? "",
        headingText: section?.querySelector("h2")?.textContent?.trim() ?? null,
      };
    }),
  );
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row.headingText, `${row.href} lands on a section`).not.toBeNull();
    // The row's own name is the section's `<h2>`, so the rail is not a second opinion about
    // what the screen calls its parts. The row also carries the hidden "current" phrase, so
    // the comparison is on the prefix rather than on equality.
    expect(row.rowText.startsWith(row.headingText ?? ""), `${row.href} is named for it`).toBe(true);
  }
});

test("562 leaves every other screen without a Settings rail", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  // §7a: "Settings is now the single named exception, not the first of a series." The slot's
  // `default.tsx` is what enforces it, and it is also what stops a soft navigation away from
  // Settings leaving this rail standing beside a screen it says nothing about.
  await page.goto("/settings");
  await expect(page.getByTestId("qcms-settings-rail")).toBeVisible();
  await page.getByRole("link", { name: "Questions" }).first().click();
  await expect(page).toHaveURL(/\/questions$/u);
  await expect(page.getByTestId("qcms-settings-rail")).toHaveCount(0);
  await expect(page.getByTestId("qcms-rail")).toHaveCount(0);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("562 leaves the rail, its disclosure and its active mark all working", async ({ page }) => {
    test.setTimeout(300_000);
    await signInWithTotp(page, EMAIL, totpSecret);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/settings");

    // Every row is a bare fragment anchor, so middle-click, open-in-new-tab and a scriptless
    // browser all work. A rail built out of buttons would be inert here, and one built out
    // of `next/link` would be a page load for an in-page jump.
    const hrefs = await page
      .locator(".qcms-settings-rail__link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs).toStrictEqual(["#account", "#change-password", "#two-factor"]);

    // The disclosure is the browser's own.
    const disclosure = page.locator("details.qcms-rail__disclosure");
    await page.locator("summary.qcms-rail__summary").click();
    await expect(disclosure).not.toHaveAttribute("open", "");
    await page.locator("summary.qcms-rail__summary").click();
    await expect(disclosure).toHaveAttribute("open", "");

    // And the active mark is a stylesheet rule, so it survives with nothing loaded. This is
    // the whole reason `:target` was chosen over a scroll spy.
    await page.locator('.qcms-settings-rail__link[href="#change-password"]').click();
    await expect(page.locator(".qcms-rail__summary-text")).toHaveText("Change password");
  });
});
