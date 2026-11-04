import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { chooseEnvironment, environmentChip } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { submitResponse } from "./support/ops.js";

/**
 * One form's operational screens in a browser: their rail, their tabs, and the journey a
 * response viewer walks. The editor's rail is swept by `rail-screens.pw.ts` instead.
 */

test.describe.configure({ mode: "serial" });

/** The seeded insurance fixture: a published v1, released, with secure links. */
const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const ACCIDENT = "q_at_fault_accident";

const OPERATOR = uniqueAdminEmail("opsrail");
/** `responses.viewer` only: one context on every row, and nothing authoring. */
const VIEWER = uniqueAdminEmail("opsviewer");

let operatorSecret = "";
/** A production response, submitted through the real respondent routes. */
let sessionId = "";

/** One screen: its path, the rail row it marks, and the tab it names. */
interface Screen {
  readonly path: string;
  /** The `data-rail-item` key that should carry `aria-current`. */
  readonly current: string;
  readonly title: string;
}

/** All five of one form's operational screens, in the order the rail draws its rows. */
function screens(): readonly Screen[] {
  return [
    {
      path: `/operations/forms/${FORM_ID}/responses`,
      current: "section:responses",
      title: `Responses: ${FORM_ID} - QCMS`,
    },
    {
      path: `/operations/forms/${FORM_ID}/responses/${sessionId}`,
      current: "section:responses",
      // The session id alone: it identifies one response across the deployment.
      title: `Response ${sessionId} - QCMS`,
    },
    {
      path: `/operations/forms/${FORM_ID}/links`,
      current: "section:links",
      title: `Links: ${FORM_ID} - QCMS`,
    },
    {
      path: `/operations/forms/${FORM_ID}/webhooks`,
      current: "section:webhooks",
      title: `Webhooks: ${FORM_ID} - QCMS`,
    },
    {
      path: `/operations/forms/${FORM_ID}/intake`,
      current: "section:intake",
      title: `Intake: ${FORM_ID} - QCMS`,
    },
  ];
}

test.beforeAll(async ({ browser }) => {
  await createTestAdmin(OPERATOR);
  await createTestAdmin(VIEWER, { grants: ["responses.viewer"], owner: false });
  const page = await browser.newPage();
  try {
    operatorSecret = await enrollNewAdmin(page, OPERATOR);
    sessionId = await submitResponse(SLUG, [[ACCIDENT, false]]);
  } finally {
    await page.close();
  }
});

test("every operational screen of one form marks its own rail row and names its own tab", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, OPERATOR, operatorSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await chooseEnvironment(page, "prod");

  for (const screen of screens()) {
    await page.goto(screen.path);
    await expect(page.locator("main#main-content"), `${screen.path} is the shell`).toHaveCount(1);

    // Soft throughout, so one sweep reports all five verdicts rather than stopping at the
    // first screen that disagrees.
    const rail = page.getByTestId("qcms-operations-form-rail");
    await expect.soft(rail, `${screen.path} carries the Operations form rail`).toBeVisible();
    await expect.soft(page, `${screen.path} names its own browser tab`).toHaveTitle(screen.title);
    await expect
      .soft(
        rail.locator(`.qcms-rail__link[data-rail-item="${screen.current}"]`),
        `${screen.path} marks ${screen.current} as the current row`,
      )
      .toHaveAttribute("aria-current", "page");
    // The editor's screens are not reachable from here: this mode's reads are one
    // environment's and authoring edits a draft that belongs to none.
    for (const authoring of ["builder", "rules", "preview", "versions", "publish"]) {
      await expect
        .soft(
          rail.locator(`[data-rail-item="section:${authoring}"]`),
          `${screen.path} offers no ${authoring} row`,
        )
        .toHaveCount(0);
    }
    // The way back is the rail Header's back link, which is Operations itself (§7.0).
    await expect
      .soft(rail.getByRole("link", { name: "Operations" }), `${screen.path} offers the way back`)
      .toBeVisible();
  }

  // An owner holds the erase cell on this form in prod through their member role, which no
  // named grant carries, so the door is there to find.
  await page.goto(`/operations/forms/${FORM_ID}/responses/${sessionId}`);
  await expect(page.getByRole("button", { name: "Erase respondent data…" })).toBeVisible();
});

test("intake closes and reopens one environment from the screen that owns it", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, OPERATOR, operatorSecret);
  await chooseEnvironment(page, "prod");
  await page.goto(`/operations/forms/${FORM_ID}/intake`);

  // The acts moved here from the builder, and they name the environment they land in: the
  // closed state is per (form, environment) and closing the wrong one is not undoable (Q6).
  await page.getByRole("button", { name: "Close in prod" }).click();
  const closing = page.getByRole("alertdialog");
  await expect(closing).toContainText("In prod.");
  await closing.getByRole("button", { name: "Close it in prod" }).click();

  await expect(page.getByTestId("qcms-form-closed")).toBeVisible();
  await expect(page.getByTestId("qcms-form-intake-reading")).toHaveText("Closed");

  // Put it back, so the fixture is where every other spec in the suite expects it.
  await page.getByRole("button", { name: "Reopen in prod" }).click();
  const reopening = page.getByRole("alertdialog");
  await reopening.getByRole("button", { name: "Reopen it in prod" }).click();
  await expect(page.getByTestId("qcms-form-intake-reading")).toHaveText("Open");
});

test("the builder offers no intake act, because that screen is authoring now", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, OPERATOR, operatorSecret);
  // The editing environment: in prod the builder is a read-only review of what is released,
  // which offers no act of its own and would make the absence below prove nothing.
  await chooseEnvironment(page, "test");
  await page.goto(`/forms/${FORM_ID}`);
  await waitForHydration(page);

  // Absent, not disabled: a caller looking for the intake door is sent to Operations
  // rather than offered a refusal on an authoring screen.
  await expect(page.getByRole("button", { name: /^Close in /u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Reopen in /u })).toHaveCount(0);
  await expect(page.getByTestId("qcms-publish-entry")).toBeVisible();
});

test("a response viewer reaches Operations, a form's responses and one response", async ({
  page,
}) => {
  test.setTimeout(600_000);
  // Operations is this persona's landing: `responses.viewer` reaches no authoring area, so
  // the default `/questions` is a wait that can only time out.
  await enrollNewAdmin(page, VIEWER, /\/operations$/u);
  await chooseEnvironment(page, "test");

  // Operations in `test`, which is the only area this persona's grants admit it to beyond
  // the claim's own workspace administration.
  await page.goto("/operations");
  await expect(page.getByTestId("qcms-mode-header")).toHaveAttribute("data-mode", "operations");
  await expect(environmentChip(page)).toHaveAttribute("data-environment", "test");

  // By its id attribute rather than by its text: the name cell shows the form's title and
  // its slug, neither of which is the id this spec names the fixture by.
  const row = page.locator(`tr[data-form-id="${FORM_ID}"]`);
  // Responses is the one context `responses.viewer` holds a read cell for, so it is the
  // form's name and the list beside it is empty.
  const name = row.getByTestId("qcms-operations-name");
  await expect(name).toHaveAttribute("data-context", "responses");
  await expect(row.getByTestId("qcms-operations-contexts")).toHaveCount(0);
  await name.click();

  // The form's responses in `test`, which is this environment's list and holds nothing:
  // the respondent harness submits into `prod`.
  await expect(page).toHaveURL(new RegExp(`/operations/forms/${FORM_ID}/responses$`, "u"));
  await expect(page.getByTestId("qcms-response-browser")).toBeVisible();
  // The rail offers the one context this persona holds, the same rule the row applied.
  const rail = page.getByTestId("qcms-operations-form-rail");
  await expect(rail).toBeVisible();
  await expect(rail.locator('[data-rail-item="section:responses"]')).toBeVisible();
  for (const absent of ["links", "webhooks", "intake"]) {
    await expect(
      rail.locator(`[data-rail-item="section:${absent}"]`),
      `the viewer's rail offers no ${absent} row`,
    ).toHaveCount(0);
  }

  // One response, read in the environment that has one. Same route, different pool, which
  // is what makes "one environment and no other" something an operator can see.
  await chooseEnvironment(page, "prod");
  await page.goto(`/operations/forms/${FORM_ID}/responses`);
  await page
    .getByTestId("qcms-response-browser")
    .getByRole("link", { name: new RegExp(`open response ${sessionId}$`, "u") })
    .click();

  await expect(page).toHaveURL(
    new RegExp(`/operations/forms/${FORM_ID}/responses/${sessionId}$`, "u"),
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(sessionId);
  // The read this persona came for, on a screen whose form read its grants refuse.
  await expect(page.getByTestId("qcms-response-detail")).toBeVisible();
  // Neither erasure door reaches a caller holding no erase cell on this form and
  // environment: not the cross-environment offer, and not the control beside it
  // (Code Owner, 2026-11-05).
  await expect(page.getByTestId("qcms-erasure-elsewhere")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Erase respondent data…" })).toHaveCount(0);
});
