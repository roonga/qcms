import { generate } from "otplib";

import { expect, test } from "../../portal/e2e/support/gates.js";
import { starveScripts } from "../../portal/e2e/support/script-starve.js";

import { HYDRATED_ATTRIBUTE } from "../lib/hydration.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  accountTrigger,
  enrollNewAdmin,
  openMenu,
  signInWithTotp,
  submitSignIn,
} from "./support/flow.js";
import { holdScripts, waitForHydration } from "./support/hydration.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("hydration");
let totpSecret = "";

const TYPED_PROBE_CODE = "123456";

const REJECTION_BUDGET_MS = 3_000;

// Keep the positive budget below the suite default so a marker that arrives only at the deadline cannot pass.
const RESOLUTION_BUDGET_MS = 15_000;

// Bundle release still requires download and commit; budget for both rather than testing their speed.
const HYDRATION_BUDGET_MS = 30_000;

// Keep the scripting-off ceiling below the wait timeout so timing out cannot satisfy the assertion.
const NO_SCRIPT_BUDGET_MS = 2_000;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("the marker is absent from the served HTML and the wait rejects a page React never ran on", async ({
  page,
}) => {
  const starvation = await starveScripts(page);
  await page.goto("/sign-in");

  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved",
  ).toBeGreaterThan(0);

  const served = await page.request.get(page.url());
  expect(served.ok(), "the sign-in screen must be served successfully to be inspected").toBe(true);
  expect(
    await served.text(),
    "the hydration marker must never appear in server-rendered HTML",
  ).not.toContain(HYDRATED_ATTRIBUTE);

  await expect(page.getByLabel("Email")).toBeAttached();
  await expect(page.getByLabel("Password")).toBeAttached();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeAttached();

  let failure = "";
  try {
    await waitForHydration(page, { timeout: REJECTION_BUDGET_MS });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure, "the wait must fail on markup React never attached to").toMatch(/timeout/i);

  starvation.restore();
  await page.goto("/sign-in");
  await waitForHydration(page, { timeout: RESOLUTION_BUDGET_MS });
});

test("enrol this file's account", async ({ page }) => {
  totpSecret = await enrollNewAdmin(page, EMAIL);
});

test("a value typed before hydration survives it, and the waited path completes", async ({
  page,
}) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/challenge$/);

  const held = holdScripts(page);
  try {
    await page.goto("/two-factor/challenge", { waitUntil: "commit" });
    const field = page.getByLabel(/Six-digit code/);
    await expect(field).toBeAttached();

    await field.focus();
    await page.keyboard.type(TYPED_PROBE_CODE);
    await expect(field, "the server-rendered field must accept typing").toHaveValue(
      TYPED_PROBE_CODE,
    );

    held.release();
    await waitForHydration(page, { timeout: HYDRATION_BUDGET_MS });
    await expect(field, "a pre-hydration value must survive hydration (issue #804)").toHaveValue(
      TYPED_PROBE_CODE,
    );
  } finally {
    held.release();
  }

  // A hydration wait protects interaction itself: fillStable cannot replay a press lost before event handlers attach.
  await page.goto("/two-factor/challenge");
  await waitForHydration(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel(/Six-digit code/)).toBeFocused();
  await page.keyboard.type(await generate({ secret: totpSecret }));
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Verify" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/questions$/);
});

// This probe must observe the helper still waiting while hydration is impossible.
// The post-release assertion distinguishes correct waiting from an early press followed by polling.
const PRE_HYDRATION_PROBE_MS = 1_500;

test("a menu press waits for the attach rather than landing on an inert trigger", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  const held = holdScripts(page);
  try {
    await page.goto("/questions", { waitUntil: "commit" });

    const trigger = accountTrigger(page);
    await expect(trigger, "the shell's account trigger is server-rendered").toBeAttached();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    const opening = openMenu(trigger);

    const early = await Promise.race([
      opening.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      new Promise<"waiting">((resolve) => {
        setTimeout(() => {
          resolve("waiting");
        }, PRE_HYDRATION_PROBE_MS);
      }),
    ]);
    expect(early, "the menu cannot open on a shell React has not reached").toBe("waiting");

    held.release();
    await opening;
    await expect(page.getByRole("menu")).toBeVisible();
  } finally {
    held.release();
  }
});

const RESPONSES_FORM_ID = "frm_auto_quote";

test("the export trigger is refused rather than inert while React is still in flight", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  const held = holdScripts(page);
  try {
    await page.goto(`/operations/forms/${RESPONSES_FORM_ID}/responses`, { waitUntil: "commit" });

    await expect(page.getByTestId("qcms-response-browser")).toBeVisible();
    await expect(
      page.locator(`html[${HYDRATED_ATTRIBUTE}]`),
      "the point of this block is a screen React has not reached",
    ).toHaveCount(0);

    // The export range uses the operator's clock, which is unavailable before hydration.
    const exportTrigger = page.getByRole("button", { name: "Export", exact: true });
    await expect(exportTrigger).toBeDisabled();
    await expect(page.getByTestId("qcms-export-dialog")).toHaveCount(0);
  } finally {
    held.release();
  }

  await waitForHydration(page, { timeout: HYDRATION_BUDGET_MS });
  const exportTrigger = page.getByRole("button", { name: "Export", exact: true });
  await expect(exportTrigger).toBeEnabled();
  await exportTrigger.click();
  await expect(page.getByTestId("qcms-export-dialog")).toBeVisible();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the wait returns at once on a page whose scripts will never run", async ({ page }) => {
    await page.goto("/sign-in");
    const started = Date.now();
    await waitForHydration(page, { timeout: NO_SCRIPT_BUDGET_MS });
    expect(
      Date.now() - started,
      "with scripting off the wait must return immediately, not time out",
    ).toBeLessThan(NO_SCRIPT_BUDGET_MS);

    await expect(page.getByRole("heading", { name: "JavaScript is required" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeHidden();
  });
});
