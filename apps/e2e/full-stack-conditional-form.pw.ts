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
import { confirmLifecycle, createDraft } from "../admin/e2e/support/questions.js";
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
 * Generated per run rather than written down: a literal here is a committed credential,
 * and a leaked log line from one run then authorizes nothing in the next (SEC-1).
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
 * `page.request` is an API client, not a page, so it sends none of this itself and the
 * SEC-9 belt refuses a POST declaring no origin. The pair is what the belt reads, and
 * the `Origin` must be the portal's own: Next's Server Action check refuses `null`.
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
    // The forced change and the MFA enrolment must stay in this order: it is the
    // first-run sequence under test, and only this stack runs it unstubbed.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/change-password$/);
    // By exact accessible name, not by label: a label matches on substring, so
    // `getByLabel("New password")` also resolves the confirmation field, and the
    // required marker inside the label makes the label text differ from the name.
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
      // Anchor the wait to the last pin: a save stores the whole draft, and this test
      // ends by closing the page, where an autosave still on the debounce is lost.
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
        // Save each rule before starting the next: the editor buffers, so nothing typed
        // in it reaches the draft until it closes.
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
      await openFormBuilder(page);
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      const publish = page.getByRole("alertdialog");
      await expect(publish).toBeVisible();
      await expect(page.getByTestId("qcms-freeze-summary")).toHaveText(
        "Freezes 2 steps, 7 pinned questions, 4 rules.",
      );
      await publish.getByRole("button", { name: "Publish v1" }).click();
      await expect(page.getByText("Published as v1.")).toBeVisible({ timeout: 30_000 });
    });

    test("releases the published version, which is what puts it in front of a respondent", async ({
      page,
    }) => {
      // Publishing freezes into `control` and serves nowhere; a session resolves the
      // version released to its environment, so without this the route answers 409
      // (ADR-40).
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

    // These two belong in this suite only: `next dev` replaces the error component with
    // its overlay driver, so a development probe says nothing about what a respondent
    // receives. Next gates an action id on length before the module map, so a wrong
    // length is a 400 and a well-formed unknown id a 409. The post must be multipart or
    // Next does not treat it as an action request at all.

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
     * A public surface discloses nothing about the build (SEC-13). The length bound is
     * positive so "nothing rendered" cannot become "something broken rendered".
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
      // The header rides the 400 below too, so the status is what separates skew from a
      // malformed request; reading the header alone is not enough.
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
      // A wrong-length id cannot have come from a browser holding one of our pages, so
      // this stays a separate test and the two statuses cannot merge unnoticed.
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
      // Click the label text, the respondent's hit target: React Aria keeps the native
      // input visually hidden under its painted control.
      const yesAlways = page.getByText("Yes, always", { exact: true });
      await yesAlways.first().click();
      await yesAlways.last().click();
      await continueOrSubmit(page);
      await expect(page).toHaveURL(/\/done/);
    });
  });
});
