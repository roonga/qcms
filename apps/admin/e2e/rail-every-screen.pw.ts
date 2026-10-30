import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * A rail on every authenticated screen, and the list filters inside it (§7.0 of
 * `plan/admin-design-contracts.md`).
 *
 * The column's x is measured rather than the rail's presence asserted, because a rail
 * rendered with no width would pass the weaker claim. The filter round trip is here because
 * it is three documents and a navigation. `rail.pw.ts`, `rail-screens.pw.ts` and
 * `settings-rail.pw.ts` cover the rail itself.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("raileveryscreen1117");

/** `--bp-sidebar` is 64rem, which the browser's default root size makes 1024px. */
const SIDEBAR = 1024;

/** The width the column's left edge is compared at. */
const WIDE = 1440;

/** The seeded insurance fixture, as every form-scoped spec in this suite uses it. */
const FORM_ID = "frm_auto_quote";

/** The workspace a bootstrapped installation is seeded with. */
const WORKSPACE_ID = "org_default_workspace";

/** Set by the first test; the rest sign in again with it. */
let totpSecret = "";

/**
 * Every authenticated screen, with the `data-testid` its own rail carries. One form-scoped
 * screen stands for the ten `rail-screens.pw.ts` walks; the question detail screen needs an
 * id and has its own spec. `lib/rail-routes.test.ts` is the gate that no screen is missing.
 */
function screens(): readonly { readonly path: string; readonly testId: string }[] {
  return [
    { path: "/questions", testId: "qcms-questions-rail" },
    { path: "/questions/new", testId: "qcms-new-question-rail" },
    { path: "/forms", testId: "qcms-forms-rail" },
    { path: "/forms/new", testId: "qcms-new-form-rail" },
    { path: `/forms/${FORM_ID}`, testId: "qcms-rail" },
    { path: "/me/access", testId: "qcms-my-access-rail" },
    { path: "/operations", testId: "qcms-operations-rail" },
    { path: "/responses", testId: "qcms-operations-rail" },
    { path: "/responses/erasures", testId: "qcms-erasures-rail" },
    { path: "/webhooks", testId: "qcms-webhooks-rail" },
    { path: "/workspaces", testId: "qcms-workspaces-rail" },
    { path: `/workspaces/${WORKSPACE_ID}`, testId: "qcms-workspace-rail" },
    { path: "/settings", testId: "qcms-settings-rail" },
  ];
}

/**
 * Where the content column starts, and the rail s width beside it. Both, so a wrong x with no
 * rail (a missing slot page) is distinguishable from one with a zero-width rail (a missing
 * grid branch).
 */
async function columnStart(page: Page): Promise<{ readonly left: number; readonly rail: number }> {
  return page.evaluate(() => {
    const main = document.querySelector("main#main-content")?.getBoundingClientRect();
    const rail = document.querySelector("aside.qcms-rail")?.getBoundingClientRect();
    return {
      left: Math.round(main?.left ?? -1),
      rail: Math.round(rail?.width ?? 0),
    };
  });
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("1117 gives every shell screen one rail, and the content column the same left edge at 1440", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.setViewportSize({ width: WIDE, height: 900 });

  const measured: Record<string, { readonly left: number; readonly rail: number }> = {};
  for (const screen of screens()) {
    await page.goto(screen.path);
    // By its own handle: `aside.qcms-rail` alone would pass on a stale rail left in the slot
    // by the previous screen.
    await expect(
      page.getByTestId(screen.testId),
      `${screen.path} renders its own rail`,
    ).toBeVisible();
    await expect
      .soft(page.locator("aside.qcms-rail"), `${screen.path} renders exactly one rail`)
      .toHaveCount(1);
    measured[screen.path] = await columnStart(page);
  }

  const edges = new Set(Object.values(measured).map((one) => one.left));
  expect(
    [...edges],
    `the content column starts at one x on every screen: ${JSON.stringify(measured)}`,
  ).toHaveLength(1);
  for (const [path, one] of Object.entries(measured)) {
    expect.soft(one.rail, `${path} gives the rail its own track`).toBeGreaterThan(200);
  }
});

test("1117 puts the list filters in the rail and nowhere else", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });

  for (const path of ["/questions", "/forms", "/operations", "/webhooks"]) {
    await page.goto(path);
    const filters = page.getByTestId("qcms-rail-filters");
    await expect(filters, `${path} has the Filters part`).toBeVisible();
    // Inside the rail, and gone from the content column: moved rather than duplicated.
    await expect
      .soft(
        page.getByTestId(screenRail(path)).getByTestId("qcms-rail-filters"),
        `${path} puts them in its own rail`,
      )
      .toHaveCount(1);
    await expect
      .soft(
        page.locator("main#main-content form.qcms-filters"),
        `${path} leaves no filter form in the content column`,
      )
      .toHaveCount(0);
    await expect.soft(filters, `${path} is a search region`).toHaveAttribute("role", "search");
    await expect
      .soft(filters.getByTestId("qcms-rail-filters-title"), `${path} names the part`)
      .toContainText("Filters");
  }
});

test("1117 applies a filter from the rail into the URL, and reloads the URL back into it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });

  await page.goto("/questions");
  const filters = page.getByTestId("qcms-rail-filters");
  await filters.getByLabel("Search").fill("smoking");
  await filters.getByRole("button", { name: "Apply" }).click();

  // Apply is a native GET submission, so this is a real navigation and the URL carries it.
  await expect(page).toHaveURL(/[?&]q=smoking/u);
  await expect(
    page.getByTestId("qcms-rail-summary-count"),
    "and the Header states how many filters are in force",
  ).toHaveText("1 active");

  // A fresh document, which is the only way to tell the state from what the first render held.
  const url = page.url();
  await page.goto(url);
  await expect(page.getByTestId("qcms-rail-filters").getByLabel("Search")).toHaveValue("smoking");
  await expect(page.getByTestId("qcms-rail-summary-count")).toHaveText("1 active");

  // Scoped to the rail: the filtered-empty panel carries §3's CTA under the same name.
  const clear = page.getByTestId("qcms-rail-filters").getByRole("link", { name: "Clear filters" });
  await expect(clear).toHaveCount(1);
  await clear.click();
  await expect(page).not.toHaveURL(/[?&]q=/u);
  await expect(page.getByTestId("qcms-rail-summary-count")).toHaveCount(0);
});

test("1117 shuts the rail below --bp-sidebar into a summary naming the subject and the count", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // One pixel under the boundary, so a collapse anywhere else is a third breakpoint.
  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto("/questions?status=draft&q=smoking");

  // `data-ready` rather than `openRail`, which would open it. The server ships the rail open,
  // so reading `open` before the media query has been read races hydration.
  const disclosure = page.locator("details.qcms-rail__disclosure");
  await expect(disclosure).toHaveAttribute("data-ready", "");
  expect(
    await disclosure.evaluate((element) => (element as HTMLDetailsElement).open),
    "the rail is shut below the boundary",
  ).toBe(false);

  // The summary is the whole rail here: the subject plus at most one count.
  const summary = page.locator("summary.qcms-rail__summary");
  await expect(summary).toContainText("Questions");
  await expect(summary.getByTestId("qcms-rail-summary-count")).toHaveText("2 active");

  await summary.click();
  await expect(page.getByTestId("qcms-rail-filters").getByLabel("Search")).toHaveValue("smoking");

  // And above the boundary the body is open (ruling 2.1).
  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto("/questions?status=draft&q=smoking");
  await expect(disclosure).toHaveAttribute("data-ready", "");
  expect(
    await disclosure.evaluate((element) => (element as HTMLDetailsElement).open),
    "and open at and above it",
  ).toBe(true);
});

/** Which rail handle a list screen carries, so the loop above can scope into it. */
function screenRail(path: string): string {
  if (path === "/questions") return "qcms-questions-rail";
  if (path === "/forms") return "qcms-forms-rail";
  if (path === "/operations") return "qcms-operations-rail";
  return "qcms-webhooks-rail";
}
