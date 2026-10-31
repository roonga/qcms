import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";
import { generate } from "otplib";

import {
  addRule,
  addStep,
  chooseOption,
  closeRuleEditor,
  createForm,
  pinQuestion,
  releaseNewestVersion,
  rule,
  savedStamp,
  toggleTarget,
  waitForSaveAfter,
} from "../admin/e2e/support/forms.js";
import { publishDraftThroughWizard } from "../admin/e2e/support/publish.js";
import { waitForHydration as waitForAdminHydration } from "../admin/e2e/support/hydration.js";
import { waitForHydration as waitForPortalHydration } from "../portal/e2e/support/hydration.js";
import { confirmLifecycle, createDraft, fillDate } from "../admin/e2e/support/questions.js";
import { FULL_STACK_ADMIN_URL, FULL_STACK_PORTAL_URL } from "./support/full-stack-config.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ADMIN_URL = FULL_STACK_ADMIN_URL;
const PORTAL_URL = FULL_STACK_PORTAL_URL;
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
/**
 * Generated per run rather than written down, so a leaked log line from one run
 * authorizes nothing in the next (SEC-1).
 */
const CHOSEN_PASSWORD = `e2e-chosen-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;

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

/**
 * `page.request` sends no Fetch Metadata of its own, and the SEC-9 belt reads
 * `Sec-Fetch-Site` and `Origin` as a pair. These are the headers a real browser sends
 * for a same-origin navigation POST, not a way around the guard.
 */
const BROWSER_FORM_POST = { "sec-fetch-site": "same-origin", origin: PORTAL_URL } as const;

async function startPortalSession(page: Page, formSlug: string): Promise<void> {
  const response = await page.request.post(`${PORTAL_URL}/f/${formSlug}/start`, {
    maxRedirects: 0,
    headers: BROWSER_FORM_POST,
  });
  expect(response.status(), "the portal Start BFF route should redirect to a session").toBe(303);
  const location = response.headers()["location"];
  // The public portal origin, not the container-internal listen address: a browser
  // outside the Compose network cannot follow that one.
  expect(
    location?.startsWith(`${PORTAL_URL}/s/ses_`),
    `the Start redirect should target ${PORTAL_URL}/s/ses_..., got ${location ?? "no location header"}`,
  ).toBe(true);
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
  test("walks the bootstrap admin through the forced password change and MFA", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/change-password$/);
    // By exact accessible name, not by label: a react-aria required marker makes the label
    // text "New password*", and a label substring also matches the confirmation field.
    const field = (name: string) => page.getByRole("textbox", { name, exact: true });
    await field("Temporary password").fill(PASSWORD);
    await field("New password").fill(CHOSEN_PASSWORD);
    await field("Confirm new password").fill(CHOSEN_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page).toHaveURL(/\/two-factor\/enroll$/);

    const setupKey = await page.getByLabel(/Setup key/).inputValue();
    await page.getByLabel(/Six-digit code/).fill(await generate({ secret: setupKey }));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);

    await page.getByRole("button", { name: "I have saved these codes" }).click();
    await expect(page).toHaveURL(/\/questions$/);
    await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
    await page.context().addCookies([{ name: "qcms-environment", value: "test", url: ADMIN_URL }]);
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
      for (const slug of ["number", "multi-choice", "single-choice"] as const) {
        await pinQuestion(page, QUESTION_IDS[slug], 1);
      }
      // Anchoring the last pin covers all of them: one save stores the whole draft, and an
      // autosave still armed when the page closes is an edit the form never receives.
      const beforeLastPin = await savedStamp(page);
      await pinQuestion(page, QUESTION_IDS["long-text"], 1);
      await waitForSaveAfter(page, beforeLastPin);
    });

    test("adds the affirmative conditional route", async ({ page }) => {
      await openFormBuilder(page);
      for (const target of [QUESTION_IDS.number, QUESTION_IDS["long-text"]]) {
        const beforeRule = await savedStamp(page);
        const ruleId = await addRule(page);
        const scope = rule(page, ruleId);
        await chooseOption(scope, "Question", `${QUESTION_IDS.boolean}@1`);
        await chooseOption(scope, "Operator", "equals (the whole answer)");
        await chooseOption(scope, "Value", "Yes");
        await toggleTarget(page, ruleId, target, true);
        // Save each rule before starting the next: the editor is a buffering modal, so
        // nothing typed in it reaches the draft until Save, and it covers the rail.
        await closeRuleEditor(page);
        await waitForSaveAfter(page, beforeRule);
      }
    });

    test("adds the negative conditional route", async ({ page }) => {
      await openFormBuilder(page);
      for (const target of [QUESTION_IDS["multi-choice"], QUESTION_IDS["single-choice"]]) {
        const beforeRule = await savedStamp(page);
        const ruleId = await addRule(page);
        const scope = rule(page, ruleId);
        await chooseOption(scope, "Question", `${QUESTION_IDS.boolean}@1`);
        await chooseOption(scope, "Operator", "equals (the whole answer)");
        await chooseOption(scope, "Value", "No");
        await toggleTarget(page, ruleId, target, true);
        await closeRuleEditor(page);
        await waitForSaveAfter(page, beforeRule);
      }
    });

    test("publishes the conditional form", async ({ page }) => {
      // The wizard reads the draft the SERVER holds rather than this tab's, so the freeze
      // summary's counts assert what a fresh read of the API returns.
      await publishDraftThroughWizard(page, {
        formId,
        version: 1,
        environment: "test",
        freezeSummary: "Freezes 2 steps, 7 pinned questions, 4 rules.",
      });
    });

    test("verifies the published version through a test link before production promotion", async ({
      page,
    }) => {
      await page.goto(`/forms/${formId}/links`);
      await waitForAdminHydration(page);
      await page.getByRole("button", { name: "Mint links", exact: true }).click();
      await fillDate(page, "Expires", "12312030");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Mint for test", exact: true })
        .click();
      const minted = page.getByTestId("qcms-minted-links");
      await expect(minted).toBeVisible();
      const link = new URL(await minted.locator("code").innerText());
      expect(link.origin).toBe(PORTAL_URL);
      expect(link.pathname).toMatch(/^\/test\/l\//u);
      await page.goto(link.href);
      await expect(page).toHaveURL(
        (url) => url.origin === PORTAL_URL && url.pathname.startsWith("/test/s/ses_"),
      );
      await expect(page.getByText(questionLabel("Short text"))).toBeVisible();
      await waitForPortalHydration(page);
      const answered = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname.startsWith("/test/s/") &&
          response.url().endsWith("/answers") &&
          response.status() === 200,
      );
      await page.getByText("Yes", { exact: true }).click();
      await answered;
      await continueOrSubmit(page);
      await expect(page.getByRole("textbox", { name: questionLabel("Number") })).toBeVisible();
      await continueOrSubmit(page);
      await expect(page).toHaveURL(`${PORTAL_URL}/test/done`);
      await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/u);
    });

    test("releases the published version, which is what puts it in front of a respondent", async ({
      page,
    }) => {
      // Publishing freezes into `control`; a session resolves what is released to its
      // environment, so without this release the respondent route answers 409 (ADR-40).
      await releaseNewestVersion(page, formId);
    });

    test("refuses a cross-site Start and creates no session (SEC-9, issue #487)", async ({
      page,
    }) => {
      const response = await page.request.post(`${PORTAL_URL}/f/${FORM_SLUG}/start`, {
        maxRedirects: 0,
        headers: { "sec-fetch-site": "cross-site", origin: "https://forged.example" },
      });
      expect(response.headers()["location"]).toBe(`${PORTAL_URL}/f/${FORM_SLUG}?state=error`);
      expect(response.headers()["set-cookie"] ?? "").not.toContain("qcms_session=");
    });

    // This suite alone runs the portal as a production build, where Next gates an action id on its
    // length before the module map; `next dev` answers differently. The request must be multipart,
    // or Next renders the page instead of refusing.

    /** A well-formed action id, 42 lowercase hex characters, that no build ever minted. */
    const UNKNOWN_ACTION_ID = "00112233445566778899aabbccddeeff0011223344";
    /** The same bytes plus two: the wrong length, so Next refuses the SHAPE rather than the id. */
    const MALFORMED_ACTION_ID = "00112233445566778899aabbccddeeff001122334455";

    const postActionId = async (page: Page, id: string) =>
      page.request.post(`${PORTAL_URL}/f/${FORM_SLUG}`, {
        maxRedirects: 0,
        headers: BROWSER_FORM_POST,
        multipart: {
          $ACTION_REF_1: "",
          "$ACTION_1:0": `{"id":"${id}","bound":"$@1"}`,
          "$ACTION_1:1": "[{}]",
        },
      });

    /**
     * A public surface discloses nothing about the build (SEC-13), so neither refusal
     * may carry the framework's wording, a session identifier or a page.
     */
    const expectLeaksNothing = (body: string) => {
      expect(body, "the framework's deployment wording stays in the log").not.toContain(
        "Failed to find Server Action",
      );
      expect(body).not.toMatch(/ses_[0-9a-f]/);
      expect(body.length, "a bare framework response rather than a page").toBeLessThan(200);
    };

    test("a stale Server Action id is refused as a 409, and leaks nothing (task 073)", async ({
      page,
    }) => {
      expect(UNKNOWN_ACTION_ID, "a real action id in this build is 42 hex").toHaveLength(42);

      const response = await postActionId(page, UNKNOWN_ACTION_ID);

      expect(response.status()).toBe(409);
      expect(response.headers()["content-type"]).toContain("text/plain");
      // Next sends this header on an action-id refusal and on nothing this app answers, so
      // the status separates skew from a malformed request and the header names the source.
      expect(
        response.headers()["x-nextjs-action-not-found"],
        "the signal a proxy can tell deploy skew by",
      ).toBe("1");
      const body = await response.text();
      expect(body.trim()).toBe("Server Action unavailable.");
      expectLeaksNothing(body);
    });

    test("a malformed Server Action id is refused as a 400, and leaks nothing (task 073)", async ({
      page,
    }) => {
      expect(MALFORMED_ACTION_ID.length, "deliberately not 42").not.toBe(42);

      const response = await postActionId(page, MALFORMED_ACTION_ID);

      expect(response.status()).toBe(400);
      expect(response.headers()["content-type"]).toContain("text/plain");
      const body = await response.text();
      expect(body.trim()).toBe("Invalid Server Action request.");
      expectLeaksNothing(body);
    });

    test("completes the affirmative respondent route", async ({ page }) => {
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
      // React Aria hides the native input under its painted control, so the label text is
      // the respondent's hit target rather than the input the role locator returns.
      const yesAlways = page.getByText("Yes, always", { exact: true });
      await yesAlways.first().click();
      await yesAlways.last().click();
      await continueOrSubmit(page);
      await expect(page).toHaveURL(/\/done/);
    });
  });
});
