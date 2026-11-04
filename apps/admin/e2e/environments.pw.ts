import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { MODE_COOKIE } from "../lib/appearance.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { chooseEnvironment, environmentChip, OPERATIONS_PATH } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createForm } from "./support/forms.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("environments");
const RUN = Date.now().toString(36);
const FORM_SLUG = `e2e-env-form-${RUN}`;

let totpSecret = "";
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

function normalScreens(): readonly string[] {
  return ["/questions", "/forms", "/settings"];
}

const chipState = (page: Page) =>
  page.evaluate(() => {
    const chip = document.querySelector('[data-testid="qcms-environment-switcher"]');
    const bar = document.querySelector("header.qcms-topbar");
    if (bar === null) throw new Error("no topbar");
    const barStyle = getComputedStyle(bar);
    const trigger = chip?.querySelector(".qcms-envtrigger") ?? null;
    const triggerStyle = trigger === null ? null : getComputedStyle(trigger);
    const main = document.querySelector("main");
    return {
      kind: chip?.getAttribute("data-kind") ?? "",
      text: (trigger?.textContent ?? "").trim(),
      fill: triggerStyle?.backgroundColor ?? "",
      borderStyle: triggerStyle?.borderTopStyle ?? "",
      borderWidth: triggerStyle?.borderTopWidth ?? "",
      edgeWidth: barStyle.borderTopWidth,
      edgeColour: barStyle.borderTopColor,
      barHeight: bar.getBoundingClientRect().height,
      mainTop: main?.getBoundingClientRect().top ?? 0,
    };
  });

test("the chip is in the Operations header and on no normal screen", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page.goto(OPERATIONS_PATH);
  const chip = environmentChip(page);
  await expect(chip, "Operations carries the chip").toBeVisible();
  await expect(chip).toHaveAttribute("data-environment", "prod");
  await expect(chip).toHaveAttribute("data-kind", "prod");

  await expect(
    page.getByTestId("qcms-mode-header").getByTestId("qcms-environment-switcher"),
  ).toBeVisible();
  const operations = await chipState(page);
  expect(operations.text, "the name is always written").toBe("prod");
  expect(operations.edgeWidth, "the bar carries the environment edge").toBe("3px");

  for (const area of normalScreens()) {
    await page.goto(area);
    await expect(chip, `${area} has no environment context`).toHaveCount(0);
    const normal = await chipState(page);
    expect(normal.edgeWidth, `${area} draws no environment edge`).toBe("0px");
  }
});

test("draws prod and a non-prod environment differently, and announces the switch", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(OPERATIONS_PATH);
  const production = await chipState(page);
  expect(production.borderWidth, "2px in every state, so no state is wider").toBe("2px");
  expect(production.borderStyle).toBe("solid");

  await chooseEnvironment(page, "test");
  const nonProd = await chipState(page);
  expect(nonProd.kind).toBe("nonprod");
  expect(nonProd.text, "the environment is named in words (WCAG 1.4.1)").toBe("test");
  expect(nonProd.borderWidth).toBe("2px");

  expect(nonProd.fill).not.toBe(production.fill);
  expect(nonProd.edgeColour).not.toBe(production.edgeColour);

  await expect(page.getByTestId("qcms-environment-status")).toHaveText(/Now working in test/u);

  await page.goto("/forms");
  await page.goto(OPERATIONS_PATH);
  await expect(environmentChip(page)).toHaveAttribute("data-environment", "test");
  await page.reload();
  await expect(environmentChip(page)).toHaveAttribute("data-environment", "test");
  await chooseEnvironment(page, "prod");
});

test("switching environments moves neither the bar nor the content column", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(OPERATIONS_PATH);
    await chooseEnvironment(page, "test");
    const inTest = await chipState(page);
    await chooseEnvironment(page, "prod");
    const inProd = await chipState(page);
    await chooseEnvironment(page, "test");
    const back = await chipState(page);

    expect(inProd.barHeight, `the bar is one height at ${String(width)}`).toBeCloseTo(
      inTest.barHeight,
      1,
    );
    expect(back.barHeight).toBeCloseTo(inTest.barHeight, 1);
    expect(inProd.mainTop, `the column does not move at ${String(width)}`).toBeCloseTo(
      inTest.mainTop,
      1,
    );
    expect(back.mainTop).toBeCloseTo(inTest.mainTop, 1);
  }

  await context.addCookies([{ name: MODE_COOKIE, value: "light-hc", url: ADMIN_BASE_URL }]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(OPERATIONS_PATH);
  await chooseEnvironment(page, "test");
  const hcTest = await chipState(page);
  await chooseEnvironment(page, "prod");
  const hcProd = await chipState(page);
  expect(hcProd.barHeight, "high contrast is one height too").toBeCloseTo(hcTest.barHeight, 1);
  expect(hcProd.mainTop).toBeCloseTo(hcTest.mainTop, 1);
  await context.clearCookies({ name: MODE_COOKIE });
});

test("a destructive confirmation names the environment it is about", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/forms");
  await chooseEnvironment(page, "test");

  formId = await createForm(page, FORM_SLUG, "Environment restatement");
  await page.goto(`/operations/forms/${formId}/intake`);

  await page.getByRole("button", { name: "Close in test" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("qcms-lifecycle-environment")).toContainText("test");
  await expect(dialog).toContainText("Every other environment is unaffected");
  await expect(dialog.getByRole("button", { name: "Close it in test" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The publish entry is the builder's, and intake is not offered there any more.
  await page.goto(`/forms/${formId}`);
  await expect(page.getByRole("button", { name: /^Publish/u })).toHaveCount(0);
  await expect(page.getByTestId("qcms-publish-entry")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Close in/u })).toHaveCount(0);
});

test("a dialog never acts in an environment another tab switched to", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/forms");
  await chooseEnvironment(page, "prod");
  await page.goto(`/operations/forms/${formId}/intake`);
  await page.getByRole("button", { name: "Close in prod" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Close it in prod" })).toBeVisible();

  const tabB = await page.context().newPage();
  await tabB.goto(OPERATIONS_PATH);
  await chooseEnvironment(tabB, "test");

  await dialog.getByRole("button", { name: "Close it in prod" }).click();
  await expect(dialog).toContainText("This tab was showing prod; you have since switched to test");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.reload();
  await expect(page.getByRole("button", { name: "Close in test" })).toBeVisible();
  await chooseEnvironment(tabB, "prod");
  await tabB.goto(`/operations/forms/${formId}/intake`);
  await expect(tabB.getByRole("button", { name: "Close in prod" })).toBeVisible();
  await tabB.close();
});

test("a tab coming back into view is re-read under another tab's switch", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto(OPERATIONS_PATH);
  await chooseEnvironment(page, "prod");

  const tabB = await page.context().newPage();
  await tabB.goto(OPERATIONS_PATH);
  await chooseEnvironment(tabB, "test");
  await tabB.close();

  await expect(environmentChip(page)).toHaveAttribute("data-environment", "prod");
  // Headless Chromium does not hide tabs or emit visibilitychange when switching them.
  // Assert its visible state before dispatching the return event directly.
  await page.bringToFront();
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(environmentChip(page)).toHaveAttribute("data-environment", "test");
  await expect(environmentChip(page)).toHaveAttribute("data-kind", "nonprod");

  await chooseEnvironment(page, "prod");
});
