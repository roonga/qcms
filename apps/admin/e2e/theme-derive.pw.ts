import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { card } from "./support/agent-card.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { confirmLifecycle, createDraft, draftLabel } from "./support/questions.js";
import { auditDetails } from "./support/workspaces.js";

/*
 * The derive flow against the local TLS fixture origin the harness points the SEC-18 fetcher
 * at, through the drawer's own Get theme and through a confirmed assistant card. The browser
 * fetches nothing: the address goes to the API route, which makes the one request.
 */

test.describe.configure({ mode: "serial" });

const WORKSPACE_ID = "org_default_workspace";
const EMAIL = uniqueAdminEmail("derive117");
const RUN = Date.now().toString(36);
const TEXT_SLUG = `e2e-derive-text-${RUN}`;
const TEXT_ID = `q_${TEXT_SLUG.replaceAll("-", "_")}`;
const TEXT_LABEL = draftLabel("longText");
const THEME_NAME = `From the site ${RUN}`;

const SITE = "https://brand.example/";
const NO_COLOUR_SITE = "https://other-site.example/";
const REFUSED_SITE = "https://not-a-fixture.example/";
/* Longer than the card is wide, so the echo above Confirm has to wrap to show the host. */
const LONG_SITE =
  "https://brand.example/our-setting/early-learning-and-childcare/enrolments?ref=print&from=assistant";
/* The save script names the theme after this run's own word, so a rerun takes no name twice. */
const CARD_THEME_NAME = `From the website ${RUN}`;

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let totpSecret = "";
let formId = "";

function drawer(page: Page): Locator {
  return page.getByTestId("qcms-appearance-drawer");
}

function surface(page: Page): Locator {
  return page.getByTestId("qcms-builder-device").getByTestId("qcms-preview-surface");
}

function token(target: Locator, name: string): Promise<string> {
  return target.evaluate(
    (element, property) => getComputedStyle(element).getPropertyValue(property).trim(),
    name,
  );
}

async function axeClean(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS } })
    .analyze();
  expect(results.violations, `axe violations on ${where}`).toEqual([]);
}

async function openDrawer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(drawer(page)).toBeVisible();
}

async function openBuilder(page: Page): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/forms/${formId}/build`);
  await waitForHydration(page);
  await expect(surface(page).getByText(TEXT_LABEL)).toBeVisible({ timeout: 30_000 });
}

/** A narrow builder puts its two panes behind tabs, so the preview is one tab away. */
async function openPreviewPane(page: Page): Promise<void> {
  await page.goto(`/forms/${formId}/build`);
  await waitForHydration(page);
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(surface(page).getByText(TEXT_LABEL)).toBeVisible({ timeout: 30_000 });
}

// React Aria switches hide their input inside the label; the label is the pointer target.
function lock(page: Page): Locator {
  return page.getByRole("switch", { name: /Lock appearance/u }).locator("xpath=ancestor::label[1]");
}

async function derive(page: Page, address: string): Promise<void> {
  await drawer(page).getByLabel("Website address").fill(address);
  await drawer(page).getByRole("button", { name: "Get theme" }).click();
}

async function say(page: Page, message: string): Promise<void> {
  await fillStable(page.getByTestId("qcms-assistant-composer"), message);
  await page.getByTestId("qcms-assistant-send").locator("button").click();
}

function echo(page: Page): Locator {
  return card(page).getByTestId("qcms-acard-typed-echo-value");
}

function confirmOnCard(page: Page): Locator {
  return card(page).getByRole("button", { name: /^Confirm/u });
}

async function boxHeight(target: Locator): Promise<number> {
  const box = await target.boundingBox();
  expect(box, "the echo should be laid out").not.toBeNull();
  return box?.height ?? 0;
}

/** How many hosts the API has contacted for a derive, which the workspace audit counts. */
async function deriveContacts(): Promise<number> {
  return (await auditDetails(WORKSPACE_ID, "derive")).length;
}

/** The look the draft itself holds, read by a fresh load of the builder. */
async function storedPrimary(page: Page): Promise<string> {
  await page.reload();
  await waitForHydration(page);
  await expect(surface(page).getByText(TEXT_LABEL)).toBeVisible({ timeout: 30_000 });
  return await token(surface(page), "--color-primary");
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("builds a draft the derive can dress", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await createDraft(page, TEXT_SLUG, "longText");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  formId = await createForm(page, `e2e-derive-${RUN}`, "Derive intake");
  await addStep(page, "About you");
  await pinQuestion(page, TEXT_ID, 1);
  await waitForSaved(page);
});

test("reads a site, previews it unsaved, keeps it as a theme and applies it", async ({ page }) => {
  test.setTimeout(300_000);
  const outbound: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.hostname.endsWith("localhost") && url.hostname !== "127.0.0.1") {
      outbound.push(request.url());
    }
  });

  await openBuilder(page);
  await openDrawer(page);
  await axeClean(page, "the drawer before a derive");

  // Nothing is read until the address is a whole https one.
  await drawer(page).getByLabel("Website address").fill("brand.example");
  await expect(drawer(page).getByRole("button", { name: "Get theme" })).toBeDisabled();

  await derive(page, SITE);
  const values = page.getByTestId("qcms-appearance-derive-values");
  await expect(values).toBeVisible({ timeout: 60_000 });
  await expect(values).toContainText("#0f766e");
  await expect(values).toContainText("lexend");
  await expect(drawer(page)).toContainText("Taken from the site");
  await expect(drawer(page)).toContainText("Nothing from the site is stored except these values");

  // The derived look is live in the preview and marked unsaved in the Current slot.
  await expect.poll(() => token(surface(page), "--color-primary")).toBe("#0f766e");
  await expect(drawer(page).getByLabel("Theme", { exact: true })).toContainText("Not saved");
  await expect(page.getByTestId("qcms-appearance-unsaved")).toBeVisible();
  await axeClean(page, "the drawer with a derived theme");

  await page.getByTestId("qcms-appearance-theme-save").click();
  await page.getByTestId("qcms-appearance-theme-name").fill(THEME_NAME);
  await page.getByTestId("qcms-appearance-theme-save").click();
  await expect(page.getByText(`${THEME_NAME} is a workspace theme now.`)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("qcms-appearance-unsaved")).toHaveCount(0);
  await axeClean(page, "the drawer after the theme was kept");

  await page.getByTestId("qcms-appearance-done").click();
  await expect(page.getByText("Appearance saved to the draft.")).toBeVisible();

  await page.reload();
  await waitForHydration(page);
  await expect.poll(() => token(surface(page), "--color-primary")).toBe("#0f766e");
  await openDrawer(page);
  await expect(drawer(page).getByLabel("Theme", { exact: true })).toContainText(THEME_NAME);

  expect(outbound, "the browser contacted the site itself").toEqual([]);
});

test("says why a refused address and a page with no colour gave no theme", async ({ page }) => {
  test.setTimeout(300_000);
  await openBuilder(page);
  await openDrawer(page);

  await derive(page, REFUSED_SITE);
  const refused = page.getByTestId("qcms-appearance-derive-error");
  await expect(refused).toBeVisible({ timeout: 60_000 });
  await expect(refused).toContainText("could not be read for a theme");
  await expect(page.getByTestId("qcms-appearance-derive-values")).toHaveCount(0);
  await axeClean(page, "the drawer after a refused address");

  await derive(page, NO_COLOUR_SITE);
  await expect(page.getByTestId("qcms-appearance-derive-error")).toContainText(
    "declares no colour a theme could start from",
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("qcms-appearance-derive-values")).toHaveCount(0);
});

test("the drawer offers no derive on a locked workspace", async ({ page }) => {
  test.setTimeout(300_000);
  await openBuilder(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings`);
  await waitForHydration(page);
  await lock(page).click();
  await expect(page.getByText("Appearance is locked for this workspace.")).toBeVisible();

  // The workspace is shared with every test after this one, so the unlock is not optional.
  try {
    await page.goto(`/forms/${formId}/build`);
    await waitForHydration(page);
    await openDrawer(page);
    const reason = page.getByTestId("qcms-appearance-locked");
    const reasonId = (await reason.getAttribute("id")) ?? "";
    const address = drawer(page).getByLabel("Website address");
    await expect(address).toBeDisabled();
    await expect(address).toHaveAttribute("aria-describedby", new RegExp(reasonId, "u"));
    await expect(drawer(page).getByRole("button", { name: "Get theme" })).toBeDisabled();
  } finally {
    await page.goto(`/workspaces/${WORKSPACE_ID}/settings`);
    await waitForHydration(page);
    await lock(page).click();
    await expect(page.getByText("Appearance is unlocked for this workspace.")).toBeVisible();
  }
});

test("reads the address typed on a confirmed card, once, and keeps the look", async ({ page }) => {
  test.setTimeout(600_000);
  await openBuilder(page);
  await say(page, "#qcms-fake:propose-theme-derive make this look like our own site");
  await expect(card(page)).toBeVisible({ timeout: 60_000 });
  await expect(card(page)).toContainText("Read a website for a theme");
  await expect(card(page)).toContainText("No theme is saved and the form does not change.");

  // No step carries an address, so the card starts empty and Confirm starts closed.
  const typed = card(page).getByTestId("qcms-acard-typed-input");
  await expect(typed).toHaveValue("");
  await expect(card(page).getByTestId("qcms-acard-typed-echo")).toHaveCount(0);
  await expect(confirmOnCard(page)).toBeDisabled();

  await fillStable(typed, SITE);
  const oneLine = await boxHeight(echo(page));
  await fillStable(typed, LONG_SITE);
  await expect(echo(page)).toHaveText(LONG_SITE);
  expect(
    await boxHeight(echo(page)),
    "a long address should wrap rather than hide its host",
  ).toBeGreaterThan(oneLine);
  expect(
    await echo(page).evaluate((element) => ({
      wrap: getComputedStyle(element).overflowWrap,
      across: element.scrollWidth - element.clientWidth,
    })),
  ).toEqual({ wrap: "anywhere", across: 0 });

  await fillStable(typed, "brand.example");
  await expect(confirmOnCard(page)).toBeDisabled();
  await fillStable(typed, "http://brand.example/");
  await expect(confirmOnCard(page)).toBeDisabled();
  await fillStable(typed, SITE);
  await expect(confirmOnCard(page)).toBeEnabled();

  const before = await deriveContacts();
  await confirmOnCard(page).click();
  await expect(drawer(page)).toBeVisible();
  const values = page.getByTestId("qcms-appearance-derive-values");
  await expect(values).toBeVisible({ timeout: 60_000 });
  await expect(values).toContainText("#0f766e");
  await expect(drawer(page).getByLabel("Website address")).toHaveValue(SITE);
  await expect(drawer(page).getByLabel("Theme", { exact: true })).toContainText("Not saved");
  const read = await deriveContacts();
  expect(read, "the confirmed address was read").toBeGreaterThan(before);
  await axeClean(page, "the drawer a confirmed card handed an address");

  await say(page, `#qcms-fake:propose-theme-save keep this #qcms-fake-new:${RUN}`);
  await expect(card(page)).toContainText(CARD_THEME_NAME, { timeout: 60_000 });
  await confirmOnCard(page).click();
  const name = page.getByTestId("qcms-appearance-theme-name");
  await expect(name).toBeVisible();
  await expect(name).toHaveValue(CARD_THEME_NAME);
  await page.getByTestId("qcms-appearance-theme-save").click();
  await expect(page.getByText(`${CARD_THEME_NAME} is a workspace theme now.`)).toBeVisible({
    timeout: 60_000,
  });

  // Both hand-offs are spent: the drawer unmounts on close and acts on neither again.
  await drawer(page).getByRole("button", { name: "Close appearance" }).click();
  await expect(drawer(page)).toHaveCount(0);
  await openDrawer(page);
  await expect(drawer(page).getByLabel("Website address")).toHaveValue("");
  await expect(page.getByTestId("qcms-appearance-derive-values")).toHaveCount(0);
  await expect(page.getByTestId("qcms-appearance-theme-name")).toHaveCount(0);
  expect(await deriveContacts(), "reopening the drawer read the site again").toBe(read);
});

test("reads a derived look at a phone's width", async ({ page }) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const values = page.getByTestId("qcms-appearance-derive-values");

  // The result is a column of pairs, so it reads at a phone's width without scrolling across.
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await openPreviewPane(page);
    await openDrawer(page);
    await derive(page, SITE);
    await expect(values).toBeVisible({ timeout: 60_000 });
    await expect(values).toContainText("#0f766e");
    await expect(drawer(page).getByLabel("Theme", { exact: true })).toContainText("Not saved");
    expect(
      await values.evaluate((element) => element.scrollWidth - element.clientWidth),
      `the derive result overflowed at ${String(width)}`,
    ).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("applies the assistant's appearance edit to the draft, with its own Undo", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await openBuilder(page);
  const was = await token(surface(page), "--color-primary");

  await say(page, "#qcms-fake:builder-appearance give it our brand colour");
  const edits = page.getByTestId("qcms-builder-edit");
  await expect(edits).toHaveCount(1, { timeout: 60_000 });
  await expect(edits.nth(0)).toHaveAttribute("data-state", "applied", { timeout: 60_000 });
  await expect(edits.nth(0)).toContainText("Changed how it looks");
  await expect(card(page)).toHaveCount(0);

  // The open preview follows the draft the turn left, with no reload of its own.
  await expect.poll(() => token(surface(page), "--color-primary")).toBe("#2e7d32");

  await edits.nth(0).getByRole("button", { name: /^Undo/u }).click();
  await expect(edits.nth(0)).toHaveAttribute("data-state", "undone", { timeout: 60_000 });
  await expect.poll(() => token(surface(page), "--color-primary")).toBe(was);

  // The Undo reached the draft itself, not only this page.
  expect(await storedPrimary(page)).toBe(was);
});
