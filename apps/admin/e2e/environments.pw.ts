import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { MODE_COOKIE } from "../lib/appearance.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { chooseEnvironment, environmentChip, OPERATIONS_PATH } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createForm } from "./support/forms.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";

/**
 * The environment chip (ADR-40 Q6, `plan/admin-design-contracts.md` §10).
 *
 * ## Why these are browser claims
 *
 * An indicator nobody renders is the failure mode here, and a unit test on the component
 * does not catch a header that never mounts it. Everything below is a property of the
 * composed app: which header carries the chip, what survives a navigation and a reload,
 * what a confirmation says when it opens, and whether a switch moves the page.
 *
 * ## The claims, in order
 *
 *  1. **The chip is in the Operations header and nowhere else.** Normal mode has no
 *     environment context, so it draws neither the chip nor the bar's environment edge.
 *  2. **The states are distinguishable and the name is always written**, so an operator who
 *     cannot see the colour still reads where they are.
 *  3. **Switching moves nothing**: the bar's height and the content column's position are
 *     the same under `test` and under `prod`, at desktop, at 390 and under high contrast.
 *  4. **A destructive confirmation names the environment**, because an act performed
 *     against the wrong one is not undoable.
 *  5. **A tab never acts in an environment another tab switched to**, and a tab coming back
 *     into view is re-read.
 *
 * Nothing here hard-codes a colour. The states are told apart by their computed values
 * DIFFERING, so a palette revision changes nothing and a chip that stopped distinguishing
 * them still fails.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("environments");
const RUN = Date.now().toString(36);
const FORM_SLUG = `e2e-env-form-${RUN}`;

/** Set by the first test, which walks the account through enrollment. */
let totpSecret = "";
let formId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** Normal-mode screens, which carry no environment context at all. */
function normalScreens(): readonly string[] {
  // Not `/responses`: it redirects into Operations, which carries the chip.
  return ["/questions", "/forms", "/settings"];
}

/** The chip's drawn state and the bar's edge, read off the live computed values. */
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
  // In the mode header, which is the ruling: the explicit selector belongs to Operations.
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
  // Solid under prod, outlined under test: the fill separates them, so the hue is never
  // the only carrier.
  expect(nonProd.fill).not.toBe(production.fill);
  expect(nonProd.edgeColour).not.toBe(production.edgeColour);

  // Announced, and only after a switch: the chip beside the region already names the
  // environment, so a region that spoke on every render would be ignored.
  await expect(page.getByTestId("qcms-environment-status")).toHaveText(/Now working in test/u);

  // Across a navigation into Normal mode and back, and across a reload: the cookie rides
  // the request, so the first byte of HTML already carries the selection.
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

  // And under high contrast, where the chip and the bar both take stronger edges: the
  // states still have to be the same size as each other.
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

  // Chosen here rather than inherited from the test above: a Playwright test gets a fresh
  // browser context, so the cookie that carries the selection does not cross between them.
  await page.goto("/forms");
  await chooseEnvironment(page, "test");

  formId = await createForm(page, FORM_SLUG, "Environment restatement");
  await page.goto(`/forms/${formId}`);

  // Closing a form is per (form, environment) since task 066 (Q18), so the environment is
  // in the trigger, the title, the body and the confirm button: an operator who has been
  // working in `test` all morning must not read a confirmation that says nothing about
  // where it lands - and since the act itself is now scoped, "Close form" would be
  // ambiguous rather than merely unhelpful.
  await page.getByRole("button", { name: "Close in test" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("qcms-lifecycle-environment")).toContainText("test");
  await expect(dialog).toContainText("Every other environment is unaffected");
  await expect(dialog.getByRole("button", { name: "Close it in test" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Publishing names no environment here, and that is the point since the wizard became
  // the one entry (issue #1197): the destination is chosen in the wizard's own body, so
  // nothing on this screen offers a second environment to confuse with the one the
  // lifecycle dialog has just restated.
  await expect(page.getByRole("button", { name: /^Publish/u })).toHaveCount(0);
  await expect(page.getByTestId("qcms-publish-entry")).toBeVisible();
});

test("a dialog never acts in an environment another tab switched to", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // Local UX list A1, reproduced live before the fix: tab A showed "Close it in prod", tab
  // B switched to test, and confirming in tab A closed the form in TEST. The selection is a
  // cookie both tabs share, so tab B is a second page in the same context.
  await page.goto("/forms");
  await chooseEnvironment(page, "prod");
  await page.goto(`/forms/${formId}`);
  await page.getByRole("button", { name: "Close in prod" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Close it in prod" })).toBeVisible();

  const tabB = await page.context().newPage();
  await tabB.goto(OPERATIONS_PATH);
  await chooseEnvironment(tabB, "test");

  // Tab A still names prod, and its confirmation is refused rather than obeyed in test.
  await dialog.getByRole("button", { name: "Close it in prod" }).click();
  await expect(dialog).toContainText("This tab was showing prod; you have since switched to test");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Nothing was closed in either environment. Tab A, reloaded, is in test and the form is
  // still open there; tab B, back in prod, finds it open there too.
  await page.reload();
  await expect(page.getByRole("button", { name: "Close in test" })).toBeVisible();
  await chooseEnvironment(tabB, "prod");
  await tabB.goto(`/forms/${formId}`);
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

  // Still rendered from prod until it is looked at again.
  await expect(environmentChip(page)).toHaveAttribute("data-environment", "prod");
  // Playwright's default Chromium (the headless shell) never hides a page: measured with
  // probes on every one, page A reports `visible` before tab B opens, while it is open,
  // after it closes and after `bringToFront()`, and receives no `visibilitychange` at any of
  // those points. So the event a returning operator's browser sends cannot be produced by
  // switching tabs here and is dispatched directly. The state the shell checks is asserted
  // first, so a red below is about what the shell does with a return, not about whether the
  // harness produced one.
  await page.bringToFront();
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // The chip follows the re-read rather than keeping the name it was mounted with.
  await expect(environmentChip(page)).toHaveAttribute("data-environment", "test");
  await expect(environmentChip(page)).toHaveAttribute("data-kind", "nonprod");

  await chooseEnvironment(page, "prod");
});
