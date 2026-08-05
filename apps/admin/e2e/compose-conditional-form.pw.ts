import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { generate } from "otplib";

import { COMPOSE_ADMIN_URL, COMPOSE_PORTAL_URL } from "./support/compose-config.js";
import {
  addRule,
  addStep,
  chooseOption,
  createForm,
  pinQuestion,
  rule,
  toggleTarget,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ADMIN_URL = COMPOSE_ADMIN_URL;
const PORTAL_URL = COMPOSE_PORTAL_URL;
const credentialsPath = join(REPOSITORY_ROOT, ".e2e-compose-credentials.json");
if (!existsSync(credentialsPath)) {
  throw new Error("Missing E2E credentials. Run pnpm docker:up before pnpm test:e2e.");
}
const credentials = JSON.parse(readFileSync(credentialsPath, "utf8")) as {
  readonly email: string;
  readonly password: string;
};
const EMAIL = credentials.email;
const PASSWORD = credentials.password;

const RUN = Date.now().toString(36);
const FORM_SLUG = `compose-e2e-conditional-${RUN}`;
const QUESTION_TYPES = [
  { slug: "short-text", type: "Short text" },
  { slug: "long-text", type: "Long text" },
  { slug: "number", type: "Number" },
  { slug: "date", type: "Date" },
  { slug: "boolean", type: "Yes or no" },
  { slug: "single-choice", type: "Single choice" },
  { slug: "multi-choice", type: "Multiple choice" },
] as const;

function questionId(slug: string): string {
  return `q_compose_e2e_${slug}_${RUN}`.replaceAll("-", "_");
}

function questionLabel(type: string): string {
  return `E2E ${type} question`;
}

async function continueOrSubmit(page: import("@playwright/test").Page): Promise<void> {
  const next = page.getByRole("button", { name: /^(Continue|Submit)$/ });
  await next.click();
}

/** Start a portal session through the form's BFF endpoint and follow its redirect. */
async function startPortalSession(
  page: import("@playwright/test").Page,
  formSlug: string,
): Promise<void> {
  const response = await page.request.post(`${PORTAL_URL}/f/${formSlug}/start`, {
    maxRedirects: 0,
  });
  expect(response.status(), "the portal Start BFF route should redirect to a session").toBe(303);
  const location = response.headers()["location"];
  expect(location, "the portal Start BFF route should return a session location").toMatch(
    /^http:\/\/(?:localhost:\d+|0\.0\.0\.0:3000)\/s\/ses_/,
  );
  const sessionToken = /(?:^|,)\s*qcms_session=([^;]+)/u.exec(
    response.headers()["set-cookie"] ?? "",
  )?.[1];
  expect(
    sessionToken,
    "the portal Start BFF route should set a respondent session cookie",
  ).toBeDefined();
  await page.context().addCookies([
    {
      name: "qcms_session",
      value: sessionToken ?? "",
      url: PORTAL_URL,
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    },
  ]);
  const sessionPath = new URL(location ?? "/", PORTAL_URL).pathname;
  await page.goto(`${PORTAL_URL}${sessionPath}`);
}

test.beforeAll(async () => {
  const response = await fetch(`${ADMIN_URL}/sign-in`);
  expect(response.ok, "run pnpm docker:up before pnpm test:e2e").toBe(true);
});

test("creates, publishes, and completes every branch of a conditional form", async ({ page }) => {
  test.setTimeout(600_000);

  // docker:up bootstraps a first admin in the fresh test database. This flow
  // proves that account can complete the required MFA enrollment in the browser.
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);

  const setupKey = await page.getByLabel(/Setup key/).inputValue();
  await page.getByLabel(/Six-digit code/).fill(await generate({ secret: setupKey }));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);

  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
  await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();

  // Every renderer shape must be created and published before it can be pinned
  // into the form library. Choice types receive their required options through
  // the shared authoring helper.
  for (const question of QUESTION_TYPES) {
    await createDraft(page, `compose-e2e-${question.slug}-${RUN}`, question.type);
    await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  }

  const ids = Object.fromEntries(
    QUESTION_TYPES.map((question) => [question.slug, questionId(question.slug)]),
  ) as Record<(typeof QUESTION_TYPES)[number]["slug"], string>;

  await createForm(page, FORM_SLUG, "Compose conditional flow");
  await addStep(page, "Start");
  for (const slug of ["short-text", "date", "boolean"] as const) {
    await pinQuestion(page, ids[slug], 1);
  }
  await addStep(page, "Your route");
  for (const slug of ["number", "multi-choice", "single-choice", "long-text"] as const) {
    await pinQuestion(page, ids[slug], 1);
  }

  // True reveals number + long text; false reveals multi + single choice. The
  // two respondent sessions below fill both projections, so all question types
  // are exercised by the portal as well as authored by the admin UI.
  for (const [value, targets] of [
    ["Yes", [ids.number, ids["long-text"]]],
    ["No", [ids["multi-choice"], ids["single-choice"]]],
  ] as const) {
    for (const target of targets) {
      const ruleId = await addRule(page);
      const scope = rule(page, ruleId);
      await chooseOption(scope, "Question", `${ids.boolean}@1`);
      await chooseOption(scope, "Operator", "equals (the whole answer)");
      await chooseOption(scope, "Value", value);
      await toggleTarget(page, ruleId, target, true);
    }
  }
  await waitForSaved(page);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const publish = page.getByRole("alertdialog");
  await expect(publish).toBeVisible();
  await publish.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText("Published as v1.")).toBeVisible({ timeout: 30_000 });

  // A separate page keeps the anonymous respondent session independent from
  // the signed-in author while exercising the normal, JavaScript-enabled portal.
  const portal = await page.context().newPage();
  try {
    // The affirmative branch: number and long text appear, while both false
    // branch controls are absent. Values are posted before advancing each step.
    await portal.goto(`${PORTAL_URL}/f/${FORM_SLUG}`);
    await startPortalSession(portal, FORM_SLUG);
    await expect(portal.getByText(questionLabel("Short text"))).toBeVisible();
    await portal.getByText("Yes", { exact: true }).click();
    await continueOrSubmit(portal);
    await expect(portal.getByRole("textbox", { name: questionLabel("Number") })).toBeVisible();
    await expect(portal.getByRole("textbox", { name: questionLabel("Long text") })).toBeVisible();
    await expect(portal.getByRole("checkbox", { name: "Yes, always" })).toHaveCount(0);
    await expect(portal.getByRole("radio", { name: "Yes, always" })).toHaveCount(0);
    await continueOrSubmit(portal);
    await expect(portal).toHaveURL(/\/done/);

    // A second anonymous session selects the other condition and receives the
    // complementary controls. This proves the branch is a live projection, not
    // a one-way reveal left behind by the first respondent.
    await portal.goto(`${PORTAL_URL}/f/${FORM_SLUG}`);
    await startPortalSession(portal, FORM_SLUG);
    await expect(portal.getByText(questionLabel("Short text"))).toBeVisible();
    await portal.getByText("No", { exact: true }).click();
    await continueOrSubmit(portal);
    await expect(portal.getByRole("checkbox", { name: "Yes, always" })).toBeVisible();
    await expect(portal.getByRole("radio", { name: "Yes, always" })).toBeVisible();
    await expect(portal.getByRole("textbox", { name: questionLabel("Number") })).toHaveCount(0);
    await expect(portal.getByRole("textbox", { name: questionLabel("Long text") })).toHaveCount(0);
    // React Aria keeps the native checkbox input visually hidden under its
    // painted control. Click its label text (the respondent's hit target),
    // rather than the hidden input exposed by the role locator.
    const yesAlways = portal.getByText("Yes, always", { exact: true });
    await yesAlways.first().click();
    await yesAlways.last().click();
    await continueOrSubmit(portal);
    await expect(portal).toHaveURL(/\/done/);
  } finally {
    await portal.close();
  }
});
