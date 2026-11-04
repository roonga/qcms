import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("raileveryscreen1117");

const SIDEBAR = 1024;

const WIDE = 1440;

const FORM_ID = "frm_auto_quote";

const WORKSPACE_ID = "org_default_workspace";

let totpSecret = "";

function screens(): readonly { readonly path: string; readonly testId: string }[] {
  return [
    { path: "/questions", testId: "qcms-questions-rail" },
    { path: "/questions/new", testId: "qcms-new-question-rail" },
    { path: "/forms", testId: "qcms-forms-rail" },
    { path: "/forms/new", testId: "qcms-new-form-rail" },
    { path: `/forms/${FORM_ID}`, testId: "qcms-rail" },
    { path: "/me/access", testId: "qcms-my-access-rail" },
    { path: "/operations", testId: "qcms-operations-rail" },
    // One operational screen of a form stands for the five its own sweep walks: they carry
    // the other rail a form has.
    { path: `/operations/forms/${FORM_ID}/responses`, testId: "qcms-operations-form-rail" },
    { path: "/responses", testId: "qcms-operations-rail" },
    { path: "/responses/erasures", testId: "qcms-erasures-rail" },
    { path: "/webhooks", testId: "qcms-webhooks-rail" },
    { path: "/workspaces", testId: "qcms-workspaces-rail" },
    { path: `/workspaces/${WORKSPACE_ID}`, testId: "qcms-workspace-rail" },
    { path: "/settings", testId: "qcms-settings-rail" },
  ];
}

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

  await expect(page).toHaveURL(/[?&]q=smoking/u);
  await expect(
    page.getByTestId("qcms-rail-summary-count"),
    "and the Header states how many filters are in force",
  ).toHaveText("1 active");

  const url = page.url();
  await page.goto(url);
  await expect(page.getByTestId("qcms-rail-filters").getByLabel("Search")).toHaveValue("smoking");
  await expect(page.getByTestId("qcms-rail-summary-count")).toHaveText("1 active");

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

  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto("/questions?status=draft&q=smoking");

  // Wait for data-ready without opening the rail: server open state precedes the client media-query decision.
  const disclosure = page.locator("details.qcms-rail__disclosure");
  await expect(disclosure).toHaveAttribute("data-ready", "");
  expect(
    await disclosure.evaluate((element) => (element as HTMLDetailsElement).open),
    "the rail is shut below the boundary",
  ).toBe(false);

  const summary = page.locator("summary.qcms-rail__summary");
  await expect(summary).toContainText("Questions");
  await expect(summary.getByTestId("qcms-rail-summary-count")).toHaveText("2 active");

  await summary.click();
  await expect(page.getByTestId("qcms-rail-filters").getByLabel("Search")).toHaveValue("smoking");

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto("/questions?status=draft&q=smoking");
  await expect(disclosure).toHaveAttribute("data-ready", "");
  expect(
    await disclosure.evaluate((element) => (element as HTMLDetailsElement).open),
    "and open at and above it",
  ).toBe(true);
});

function screenRail(path: string): string {
  if (path === "/questions") return "qcms-questions-rail";
  if (path === "/forms") return "qcms-forms-rail";
  if (path === "/operations") return "qcms-operations-rail";
  return "qcms-webhooks-rail";
}
