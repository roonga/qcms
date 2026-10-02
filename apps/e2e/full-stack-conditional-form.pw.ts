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
 * The password this run chooses, replacing the provisional one `qcms:create-admin` set
 * (task 061, SEC-1). Generated rather than written down, like the admin suite's: a
 * literal is a hard-coded credential the lint gate flags, and a value that changes per
 * run means a leaked log line from one run authorizes nothing in the next.
 *
 * Nothing after the first checkpoint signs in again - the enrolled session is saved to
 * `authStatePath` and reused - so this is used exactly once and never has to be written
 * back to the credentials file the compose bootstrap produced.
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
 * The Fetch Metadata a browser attaches when it submits the portal's own entry form.
 *
 * `page.request` is an API client, not a page, so it sends none of this on its own,
 * and the portal's SEC-9 belt (issue #487) refuses a state-changing POST that declares
 * no origin at all. Supplying it is not a workaround for the guard: it is what the
 * browser this helper stands in for actually sends, and a helper that drove the route
 * with headers no browser produces would be testing a client that does not exist.
 *
 * **The `Origin` is the portal's own, and it used to be the literal `null`.** Per
 * Fetch, a navigation POST under `Referrer-Policy: no-referrer` serializes its origin
 * as `null`, and the portal served that policy until task 073; it now serves
 * `same-origin` (Code Owner, 2026-10-01, SEC-9 as amended), because Next's Server
 * Action check compares `Origin` to the `Host` and refuses `null`, and the no-JS roster
 * operation of a repeating group is a Server Action. So the real shape of a legitimate
 * no-JS Start now carries this portal's real origin, and that is what this helper
 * sends. The belt still reads `Sec-Fetch-Site` first and its acceptance rule is
 * unchanged, so the pair is what matters rather than either header alone.
 */
const BROWSER_FORM_POST = { "sec-fetch-site": "same-origin", origin: PORTAL_URL } as const;

/** Start a portal session through the form's BFF endpoint and follow its redirect. */
async function startPortalSession(page: Page, formSlug: string): Promise<void> {
  const response = await page.request.post(`${PORTAL_URL}/f/${formSlug}/start`, {
    maxRedirects: 0,
    headers: BROWSER_FORM_POST,
  });
  expect(response.status(), "the portal Start BFF route should redirect to a session").toBe(303);
  const location = response.headers()["location"];
  // The redirect must carry the PUBLIC portal origin. The container-internal
  // listen address is exactly what this route used to emit, and a browser outside
  // the Compose network cannot follow it, so accepting that shape here would
  // accept the bug the portal's QCMS_PORTAL_BASE_URL read exists to fix.
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
    // docker:up bootstraps a first admin in the fresh test database with the REAL
    // `qcms:create-admin`, so this is the only place the whole SEC-1 first-run sequence
    // runs against the shipped images: a provisional credential set by the command, the
    // forced change, then the required MFA enrollment. Task 061's exit criterion 5 is
    // the order these two appear in, and the reason it is asserted here as well as in
    // the admin suite is that this stack is the one that never stubs the bootstrap.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/change-password$/);
    // By accessible name and exactly, not by label, and the reason is specific to this
    // screen: Playwright matches a label by case-insensitive substring, so
    // `getByLabel("New password")` resolves to the confirmation field as well and the
    // fill is a strict-mode violation rather than a locator. `exact: true` on the label
    // does not rescue it either - a react-aria `TextField` puts the required marker
    // inside the label element as an `aria-hidden` span, so the label TEXT is "New
    // password*" while the accessible NAME is "New password".
    // `apps/admin/e2e/forced-password-change.pw.ts` carries the same note beside its own
    // helper; the sign-in fields above stay on `getByLabel` because that screen has no
    // second field whose label contains either word.
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
      for (const slug of ["number", "multi-choice", "single-choice"] as const) {
        await pinQuestion(page, QUESTION_IDS[slug], 1);
      }
      // THE LAST PIN IS ANCHORED, and it stands for all seven (issue 748). A save stores
      // the WHOLE draft, so waiting for the one the last pin arms is waiting for every pin
      // above it. `waitForSaved` could not say that: "Last saved" is already on screen from
      // an earlier pin, so it returned while the rest were still on the debounce, and this
      // test ends by closing its page - an autosave still armed at that moment is an edit
      // the form never receives.
      const beforeLastPin = await savedStamp(page);
      await pinQuestion(page, QUESTION_IDS["long-text"], 1);
      await waitForSaveAfter(page, beforeLastPin);
    });

    test("adds the affirmative conditional route", async ({ page }) => {
      await openFormBuilder(page);
      for (const target of [QUESTION_IDS.number, QUESTION_IDS["long-text"]]) {
        // ONE RULE, ONE SAVE, WAITED ON (issue 748). The stamp is read while the strip is
        // settled, so nothing already in flight can move it, and the wizard buffers, so the
        // only thing that moves it next is this rule's own Save. What this loop used to
        // assert was that the EDITOR reached a state, which says nothing about the draft
        // reaching the server: the second rule was still on the debounce when the page
        // closed, and the publish two tests later froze a form without it.
        const beforeRule = await savedStamp(page);
        const ruleId = await addRule(page);
        const scope = rule(page, ruleId);
        await chooseOption(scope, "Question", `${QUESTION_IDS.boolean}@1`);
        await chooseOption(scope, "Operator", "equals (the whole answer)");
        await chooseOption(scope, "Value", "Yes");
        await toggleTarget(page, ruleId, target, true);
        // SAVE EACH RULE BEFORE STARTING THE NEXT. The editor is a buffering modal since
        // 2026-08-30: nothing typed in it reaches the draft until Save, so a loop that
        // moved straight on to `addRule` both left the rail behind an open dialog and
        // built rules the form never received.
        await closeRuleEditor(page);
        await waitForSaveAfter(page, beforeRule);
      }
    });

    test("adds the negative conditional route", async ({ page }) => {
      await openFormBuilder(page);
      for (const target of [QUESTION_IDS["multi-choice"], QUESTION_IDS["single-choice"]]) {
        // Same anchor as the affirmative route above, and for the same reason.
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
      // A SERVER READ-BACK BEFORE THE FREEZE (issue 748). This page loaded the draft the
      // API holds and the summary counts what publish is about to freeze out of it, so an
      // authored rule that never reached the server fails HERE, naming the count it found,
      // rather than two tests later as a respondent question that should have been hidden
      // and was not. Three CI reds read as portal bugs before that distinction was drawn.
      await expect(page.getByTestId("qcms-freeze-summary")).toHaveText(
        "Freezes 2 steps, 7 pinned questions, 4 rules.",
      );
      await publish.getByRole("button", { name: "Publish v1" }).click();
      await expect(page.getByText("Published as v1.")).toBeVisible({ timeout: 30_000 });
    });

    test("refuses a cross-site Start and creates no session (SEC-9, issue #487)", async ({
      page,
    }) => {
      // The belt asserted through the deployed stack rather than only in a unit test:
      // real proxy, real Next server, real container, real published form. Everything
      // about this request is legitimate except where the browser says it came from,
      // so a pass here cannot be explained by the form being unreachable.
      const response = await page.request.post(`${PORTAL_URL}/f/${FORM_SLUG}/start`, {
        maxRedirects: 0,
        headers: { "sec-fetch-site": "cross-site", origin: "https://forged.example" },
      });
      expect(response.headers()["location"]).toBe(`${PORTAL_URL}/f/${FORM_SLUG}?state=error`);
      // The assertion that matters. The redirect only says what the respondent sees;
      // this says no session was minted, which is the state change being refused.
      expect(response.headers()["set-cookie"] ?? "").not.toContain("qcms_session=");
    });

    test("a stale Server Action id is refused by the framework, and leaks nothing (task 073)", async ({
      page,
    }) => {
      // Asserted HERE and nowhere else, because this is the only suite that runs the portal
      // as a production build, and the behaviour differs from development: `next dev`
      // replaces the error component with its overlay driver, so a dev probe says nothing
      // about what a respondent receives.
      //
      // What it receives, measured on 2026-10-02 while reviewing PR #1034: a bare
      // `500 text/plain`. Next recalculates action ids between builds, so a page held across
      // a deploy posts an id this build does not know; the action handler validates every id
      // BEFORE dispatch and throws, so no page of this app renders - not the flow segment's
      // error boundary, which catches only what its own subtree throws while rendering, and
      // not an App Router `app/500/page.tsx` or a Pages Router `pages/_error.tsx`, both of
      // which were tried against this build and neither of which is consulted. ADR-43's
      // amendment carries that correction; this test is what holds it true.
      //
      // The request is what the browser sends: a MULTIPART post carrying an action
      // descriptor whose id was never built. Multipart matters, because Next treats a
      // url-encoded POST that is not a fetch action as not an action request at all and
      // simply renders the page. No session, form or repeating group is needed to reach it,
      // since the id check happens before anything of the app runs.
      const unknownActionId = "00112233445566778899aabbccddeeff001122334455";
      const response = await page.request.post(`${PORTAL_URL}/f/${FORM_SLUG}`, {
        maxRedirects: 0,
        headers: BROWSER_FORM_POST,
        multipart: {
          $ACTION_REF_1: "",
          "$ACTION_1:0": `{"id":"${unknownActionId}","bound":"$@1"}`,
          "$ACTION_1:1": "[{}]",
        },
      });

      expect(response.status()).toBe(500);
      const body = await response.text();
      // The assertions that matter are about what is NOT in it. The framework's own words
      // name the deployment and must not reach a respondent (SEC-13's spirit: a public
      // surface discloses nothing about the build), and no session identifier appears.
      expect(body, "the framework's deployment wording stays in the log").not.toContain(
        "Failed to find Server Action",
      );
      expect(body).not.toMatch(/ses_[0-9a-f]/);
      // And it is a dead end rather than a redirect loop: a respondent's recovery is a GET
      // of the step, which still serves it. Asserted positively so "nothing is rendered"
      // cannot quietly become "something broken is rendered".
      expect(body.length, "a bare framework 500 rather than a page").toBeLessThan(200);
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
