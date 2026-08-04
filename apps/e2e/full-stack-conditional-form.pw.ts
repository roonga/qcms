import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import { generate } from "otplib";

import {
  addRule,
  addStep,
  chooseOption,
  createForm,
  pinQuestion,
  rule,
  toggleTarget,
  waitForSaved,
} from "../admin/e2e/support/forms.js";
import { confirmLifecycle, createDraft } from "../admin/e2e/support/questions.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ADMIN_URL = process.env.QCMS_COMPOSE_E2E_ADMIN_URL ?? "http://localhost:17940";
const PORTAL_PORT = process.env.QCMS_COMPOSE_E2E_PORTAL_PORT ?? "17900";
const PORTAL_URL = `http://localhost:${PORTAL_PORT}`;
const credentialsPath = join(REPOSITORY_ROOT, ".e2e-full-stack-credentials.json");
const authStatePath = join(REPOSITORY_ROOT, "test-results", "full-stack-e2e", "admin-state.json");
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
const FORM_SLUG = `full-stack-e2e-conditional-${RUN}`;
const QUESTION_TYPES = [
  { slug: "short-text", type: "Short text" },
  { slug: "long-text", type: "Long text" },
  { slug: "number", type: "Number" },
  { slug: "date", type: "Date" },
  { slug: "boolean", type: "Yes or no" },
  { slug: "single-choice", type: "Single choice" },
  { slug: "multi-choice", type: "Multiple choice" },
] as const;
const QUESTION_IDS = Object.fromEntries(
  QUESTION_TYPES.map((question) => [question.slug, questionId(question.slug)]),
) as Record<(typeof QUESTION_TYPES)[number]["slug"], string>;

let formId = "";

function questionId(slug: string): string {
  return `q_full_stack_e2e_${slug}_${RUN}`.replaceAll("-", "_");
}

function questionLabel(type: string): string {
  return `E2E ${type} question`;
}

async function continueOrSubmit(page: Page): Promise<void> {
  const next = page.getByRole("button", { name: /^(Continue|Submit)$/ });
  await next.click();
}

/** Start a portal session through the form's BFF endpoint and follow its redirect. */
async function startPortalSession(page: Page, formSlug: string): Promise<void> {
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

async function openFormBuilder(page: Page): Promise<void> {
  expect(formId, "the form must be created before its builder is opened").not.toBe("");
  await page.goto(`/forms/${formId}`);
  await expect(page).toHaveURL(new RegExp(`/forms/${formId}$`));
}

test.beforeAll(async () => {
  mkdirSync(dirname(authStatePath), { recursive: true });
  if (existsSync(authStatePath)) unlinkSync(authStatePath);
  const response = await fetch(`${ADMIN_URL}/sign-in`);
  expect(response.ok, "run pnpm docker:up before pnpm test:e2e").toBe(true);
});

test.describe.serial("conditional form journey", () => {
  test("enrolls the bootstrap admin in MFA", async ({ page }) => {
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
    // Keep the real post-enrolment session while each later checkpoint runs
    // in its own fresh browser context.
    await page.context().storageState({ path: authStatePath });
  });

  test.describe("signed-in authoring and respondent flow", () => {
    test.use({ storageState: authStatePath });

    for (const question of QUESTION_TYPES) {
      test(`publishes a ${question.type} question`, async ({ page }) => {
        await createDraft(page, `full-stack-e2e-${question.slug}-${RUN}`, question.type);
        await confirmLifecycle(page, /^Publish version 1$/, "Publish");
      });
    }

    test("builds the form steps from published questions", async ({ page }) => {
      formId = await createForm(page, FORM_SLUG, "Full stack conditional flow");
      await addStep(page, "Start");
      for (const slug of ["short-text", "date", "boolean"] as const) {
        await pinQuestion(page, QUESTION_IDS[slug], 1);
      }
      await addStep(page, "Your route");
      for (const slug of ["number", "multi-choice", "single-choice", "long-text"] as const) {
        await pinQuestion(page, QUESTION_IDS[slug], 1);
      }
      await waitForSaved(page);
    });

    test("adds the affirmative conditional route", async ({ page }) => {
      await openFormBuilder(page);
      for (const target of [QUESTION_IDS.number, QUESTION_IDS["long-text"]]) {
        const ruleId = await addRule(page);
        const scope = rule(page, ruleId);
        await chooseOption(scope, "Question", `${QUESTION_IDS.boolean}@1`);
        await chooseOption(scope, "Operator", "equals (the whole answer)");
        await chooseOption(scope, "Value", "Yes");
        await toggleTarget(page, ruleId, target, true);
      }
      await waitForSaved(page);
    });

    test("adds the negative conditional route", async ({ page }) => {
      await openFormBuilder(page);
      for (const target of [QUESTION_IDS["multi-choice"], QUESTION_IDS["single-choice"]]) {
        const ruleId = await addRule(page);
        const scope = rule(page, ruleId);
        await chooseOption(scope, "Question", `${QUESTION_IDS.boolean}@1`);
        await chooseOption(scope, "Operator", "equals (the whole answer)");
        await chooseOption(scope, "Value", "No");
        await toggleTarget(page, ruleId, target, true);
      }
      await waitForSaved(page);
    });

    test("publishes the conditional form", async ({ page }) => {
      await openFormBuilder(page);
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      const publish = page.getByRole("alertdialog");
      await expect(publish).toBeVisible();
      await publish.getByRole("button", { name: "Publish v1" }).click();
      await expect(page.getByText("Published as v1.")).toBeVisible({ timeout: 30_000 });
    });

    test("completes the affirmative respondent route", async ({ page }) => {
      // The affirmative branch: number and long text appear, while both false
      // branch controls are absent. Values are posted before advancing each step.
      await page.goto(`${PORTAL_URL}/f/${FORM_SLUG}`);
      await startPortalSession(page, FORM_SLUG);
      await expect(page.getByText(questionLabel("Short text"))).toBeVisible();
      await page.getByText("Yes", { exact: true }).click();
      await continueOrSubmit(page);
      await expect(page.getByRole("textbox", { name: questionLabel("Number") })).toBeVisible();
      await expect(page.getByRole("textbox", { name: questionLabel("Long text") })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "Yes, always" })).toHaveCount(0);
      await expect(page.getByRole("radio", { name: "Yes, always" })).toHaveCount(0);
      await continueOrSubmit(page);
      await expect(page).toHaveURL(/\/done/);
    });

    test("completes the negative respondent route", async ({ page }) => {
      await page.goto(`${PORTAL_URL}/f/${FORM_SLUG}`);
      await startPortalSession(page, FORM_SLUG);
      await expect(page.getByText(questionLabel("Short text"))).toBeVisible();
      await page.getByText("No", { exact: true }).click();
      await continueOrSubmit(page);
      await expect(page.getByRole("checkbox", { name: "Yes, always" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Yes, always" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: questionLabel("Number") })).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: questionLabel("Long text") })).toHaveCount(0);
      // React Aria keeps the native checkbox input visually hidden under its
      // painted control. Click its label text (the respondent's hit target),
      // rather than the hidden input exposed by the role locator.
      const yesAlways = page.getByText("Yes, always", { exact: true });
      await yesAlways.first().click();
      await yesAlways.last().click();
      await continueOrSubmit(page);
      await expect(page).toHaveURL(/\/done/);
    });
  });
});
