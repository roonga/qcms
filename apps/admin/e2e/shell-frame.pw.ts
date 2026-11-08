import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { presetEnvironment } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { waitForHydration } from "./support/hydration.js";

let EMAIL = "";

const FORM_ID = "frm_auto_quote";
const QUESTION_ID = "q_at_fault_accident";
const WORKSPACE_ID = "org_default_workspace";

const WIDE = 1280;
const NARROW = 390;

let secret = "";

// Each test signs in on its own, so one failure cannot skip the rest of the file.
test.beforeAll(async ({ browser }) => {
  EMAIL = uniqueAdminEmail("shellframe");
  await createTestAdmin(EMAIL);
  const page = await browser.newPage({ baseURL: ADMIN_BASE_URL });
  secret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

interface Frame {
  readonly header: number;
  readonly rail: number;
  /** Where the column starts. Every area landing hides its own `h1`, so this is the drawn title row. */
  readonly main: number;
  readonly crumbs: number;
}

async function frame(page: Page): Promise<Frame> {
  await waitForHydration(page);
  await settleTransitions(page);
  return page.evaluate(() => {
    const box = (selector: string): DOMRect | undefined =>
      document.querySelector(selector)?.getBoundingClientRect();
    return {
      header: Math.round(box("header.qcms-topbar")?.height ?? -1),
      rail: Math.round(box("aside.qcms-rail")?.width ?? -1),
      main: Math.round((box("main#main-content")?.top ?? -1) + window.scrollY),
      // Not `nav.qcms-crumbs`: an area that names itself in the bar draws the row without a trail.
      crumbs: Math.round((box(".qcms-crumbs")?.top ?? -1) + window.scrollY),
    };
  });
}

// Only after hydration: a class the server did not render is a hydration mismatch.
async function highContrast(page: Page, on: boolean): Promise<void> {
  await waitForHydration(page);
  await page.evaluate((enable) => {
    document.documentElement.classList.toggle("hc", enable);
  }, on);
}

function railWidth(page: Page): Promise<number> {
  return page
    .locator("aside.qcms-rail")
    .evaluate((rail) => Math.round(rail.getBoundingClientRect().width));
}

test("the rail toggle collapses the rail to a strip from the keyboard, and the choice persists", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, secret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/questions");
  await waitForHydration(page);

  const toggle = page.getByTestId("qcms-rail-toggle");
  const rail = page.locator("aside.qcms-rail");
  // A list rail carries its filters, so the first stop inside it is the search box.
  const first = rail.getByRole("textbox", { name: "Search" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("aria-controls", "qcms-rail-region");
  await expect(toggle).toHaveAccessibleName("Collapse sidebar");
  expect(await railWidth(page)).toBe(240);

  await first.focus();
  await page.keyboard.press("Alt+Shift+S");
  await expect(page.locator("html")).toHaveAttribute("data-sidebar", "hidden");
  await expect(
    toggle,
    "focus leaves the rail it collapsed for the control that undoes it",
  ).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAccessibleName("Expand sidebar");
  await expect.poll(() => railWidth(page), "a strip, not nothing").toBe(56);
  await expect(first, "a collapsed rail's contents leave the page").toBeHidden();

  const response = await page.goto("/forms");
  expect((await response?.text()) ?? "", "the server renders the remembered choice").toContain(
    'data-sidebar="hidden"',
  );
  expect(await railWidth(page)).toBe(56);

  await waitForHydration(page);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-sidebar", "shown");
  await expect.poll(() => railWidth(page)).toBe(240);
  await expect(
    page.locator("aside.qcms-rail").getByRole("textbox", { name: "Search" }),
  ).toBeVisible();
});

test("the collapse animates over 200ms, and not at all under reduced motion", async ({ page }) => {
  await signInWithTotp(page, EMAIL, secret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/questions");
  const duration = () =>
    page.locator(".qcms-shell-body").evaluate((body) => getComputedStyle(body).transitionDuration);
  expect(await duration()).toBe("0.2s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(Number.parseFloat(await duration()), "no visible motion").toBeLessThan(0.001);
});

test("a list screen's page action rides the breadcrumb line rather than a row of its own", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, secret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  for (const path of ["/questions", "/forms"]) {
    await page.goto(path);
    await waitForHydration(page);
    const measured = await page.evaluate(() => {
      const box = (selector: string): DOMRect | undefined =>
        document.querySelector(selector)?.getBoundingClientRect();
      const line = box(".qcms-crumbs__list");
      const action = box(".qcms-page-actionbar");
      const main = box("main#main-content");
      if (line === undefined || action === undefined || main === undefined) return undefined;
      return {
        action: Math.round(action.top),
        line: Math.round(line.top + line.height / 2),
        main: Math.round(main.top),
      };
    });
    expect.soft(measured?.action, `${path} rides the crumb line's centre`).toBe(measured?.line);
    expect
      .soft(measured?.action, `${path} takes no row of its own`)
      .toBeLessThan(measured?.main ?? -1);
  }
});

test("below the sidebar breakpoint the toggle steps aside and the rail stays a disclosure", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, secret);
  await page.setViewportSize({ width: NARROW, height: 844 });
  await page.goto("/questions");
  await expect(page.getByTestId("qcms-rail-toggle")).toBeHidden();
  await expect(page.locator("aside.qcms-rail")).toBeVisible();
  await expect(page.locator("details.qcms-rail__disclosure summary")).toHaveText(/Menu/u);
});

interface FrameCase {
  readonly width: number;
  readonly environment: "test" | "prod";
  readonly hc: boolean;
}

function frameCases(): readonly FrameCase[] {
  return [WIDE, NARROW].flatMap((width) =>
    (["test", "prod"] as const).flatMap((environment) =>
      [false, true].map((hc) => ({ width, environment, hc })),
    ),
  );
}

function caseName({ width, environment, hc }: FrameCase): string {
  return `at ${String(width)} in ${environment}${hc ? ", high contrast" : ""}`;
}

test("one top bar: entering Operations moves neither the bar, the rail nor the heading", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, secret);
  // `/workspaces` lands on the current workspace, so the area's own list is the landing here.
  const areas = ["/questions", "/forms", "/workspaces/all", "/operations"];
  for (const one of frameCases()) {
    await page.setViewportSize({ width: one.width, height: 900 });
    await presetEnvironment(page, one.environment);
    const frames: Frame[] = [];
    for (const path of areas) {
      await page.goto(path);
      await highContrast(page, one.hc);
      frames.push(await frame(page));
    }
    const first = frames[0];
    if (first === undefined) throw new Error("no area was measured");
    for (const [index, path] of areas.entries()) {
      const here = frames[index];
      if (here === undefined) throw new Error(`${path} was not measured`);
      expect.soft(here, `${path} ${caseName(one)}`).toEqual(first);
    }
  }
});

interface CrumbScreen {
  readonly path: string;
  readonly trail: readonly string[];
  /** Only a screen inside one item has the way to its list; an area's rail has none. */
  readonly context?: true;
}

const CRUMB_SCREENS: readonly CrumbScreen[] = [
  { path: "/questions", trail: ["Questions"] },
  { path: "/questions/new", trail: ["Questions", "New question"] },
  { path: `/questions/${QUESTION_ID}`, trail: ["Questions", QUESTION_ID], context: true },
  { path: "/forms", trail: ["Forms"] },
  { path: `/forms/${FORM_ID}/versions`, trail: ["Forms", "", "Versions"], context: true },
  // The top bar's Operations group names the area, so an Operations trail starts below it.
  { path: `/operations/forms/${FORM_ID}/links`, trail: ["", "Links"], context: true },
  { path: "/webhooks", trail: ["Delivery failures"] },
  {
    path: `/workspaces/${WORKSPACE_ID}/members`,
    trail: ["Workspaces", "", "Members"],
    context: true,
  },
  { path: "/settings", trail: ["Settings"] },
];

async function expectTrail(page: Page, screen: CrumbScreen): Promise<void> {
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect.soft(crumbs, `${screen.path} has a breadcrumb`).toBeVisible();
  const items = crumbs.getByRole("listitem");
  await expect.soft(items, `${screen.path} trail length`).toHaveCount(screen.trail.length);
  for (const [index, label] of screen.trail.entries()) {
    if (label !== "") await expect.soft(items.nth(index)).toContainText(label);
  }
  await expect
    .soft(crumbs.locator('[aria-current="page"]'), `${screen.path} marks itself`)
    .toHaveCount(1);
}

async function expectOneTitle(page: Page, screen: CrumbScreen): Promise<void> {
  const headings = page.locator("main#main-content h1");
  await expect.soft(headings, `${screen.path} has one title`).toHaveCount(1);
  const title = ((await headings.first().textContent()) ?? "").trim();
  const label = page.locator(".qcms-rail__summary");
  const shown = (await label.isVisible()) ? ((await label.textContent()) ?? "").trim() : "";
  expect.soft(shown, `${screen.path} rail repeats no title`).not.toBe(title);
  await expect
    .soft(page.getByTestId("qcms-rail-context"), `${screen.path} way to the list`)
    .toHaveCount(screen.context === true ? 1 : 0);
}

test("a breadcrumb heads every screen in one place, and the rail never repeats the title", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, secret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  const positions: number[] = [];
  for (const screen of CRUMB_SCREENS) {
    await page.goto(screen.path);
    await expectTrail(page, screen);
    positions.push((await frame(page)).crumbs);
    await expectOneTitle(page, screen);
  }
  expect(new Set(positions).size, `one breadcrumb position: ${positions.join(", ")}`).toBe(1);
});

async function axeFrame(page: Page, state: string): Promise<void> {
  for (const hc of [false, true]) {
    await highContrast(page, hc);
    await settleTransitions(page);
    const results = await new AxeBuilder({ page })
      .include(".qcms-topbar")
      .include("aside.qcms-rail")
      .include("nav.qcms-crumbs")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect
      .soft(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
        ),
        `${state}${hc ? ", high contrast" : ""}`,
      )
      .toEqual([]);
  }
}

test("the frame passes axe expanded and collapsed, light and high contrast", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, secret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  const toggle = page.getByTestId("qcms-rail-toggle");
  for (const path of ["/questions", `/operations/forms/${FORM_ID}/responses`]) {
    await page.goto(path);
    await waitForHydration(page);
    await axeFrame(page, path);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await axeFrame(page, `${path} collapsed`);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
});
