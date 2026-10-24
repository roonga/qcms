import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { openRail } from "./support/forms.js";

/**
 * A rail on every authenticated screen, and the list filters inside it (§7.0 of
 * `plan/admin-design-contracts.md`, Code Owner 2026-10-24; issue #1117).
 *
 * ## What this spec is for, and what it deliberately leaves to the other three
 *
 * `rail.pw.ts` measures the rail itself - the 240px track turning on at `--bp-sidebar`, the
 * disclosure, the wrap, N2's viewport fill. `rail-screens.pw.ts` walks the ten form-scoped
 * screens and asserts each marks the row it is. `settings-rail.pw.ts` drives the Settings
 * panels. None of that is repeated here.
 *
 * What only exists once §7.0 ruling 1 is built is the property this file is named for:
 * **every** screen has one, so the content column starts at the same place on all of them.
 * That is the acceptance criterion the issue states first, and it is the one a reader
 * notices the absence of without being able to name - a screen whose table sits 240px
 * further left reads as a different app for a moment.
 *
 * It is measured rather than inferred. "A rail is in the DOM" is a weaker claim than "the
 * column starts at the same x", and the weaker one passes on a rail that renders with no
 * width - which is exactly what a missing `:has(> .qcms-rail)` grid branch would produce.
 *
 * ## The filters, and why a browser is where they are checked
 *
 * `app/(shell)/forms-list-controls.test.tsx` already pins what the controls show for a given
 * URL and what the page asks the API for. What it cannot see is the round trip: typing a
 * term in the rail, pressing Apply, and arriving at a URL that carries it - and then
 * reloading that URL and finding the same state. That is three documents and a navigation,
 * so it lives here.
 *
 * ## One serial account
 *
 * The first test enrols an admin and the rest sign in with its secret, which is this suite's
 * standing pattern: a serial file shares no browser context, and enrolling per test would
 * pay for a 2FA setup nine times.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("raileveryscreen1117");

/** `--bp-sidebar` is 64rem, which the browser's default root size makes 1024px. */
const SIDEBAR = 1024;

/** The width the issue's first acceptance criterion names. */
const WIDE = 1440;

/** The seeded insurance fixture, as every form-scoped spec in this suite uses it. */
const FORM_ID = "frm_auto_quote";

/** The workspace a bootstrapped installation is seeded with (ADR-41, task 068). */
const WORKSPACE_ID = "org_default_workspace";

/** Set by the first test; the rest sign in again with it. */
let totpSecret = "";

/**
 * Every authenticated screen, with the `data-testid` its own rail carries.
 *
 * One form-scoped screen stands for the ten `rail-screens.pw.ts` walks, and one question
 * detail screen is absent for a reason worth stating: it needs a question id, and this file
 * is about the screens that had no rail. What it must not leave out is any screen from
 * §7.0's table, and `lib/rail-routes.test.ts` is the gate that says so off the route tree -
 * a screen added without a rail fails there whatever this list holds.
 */
function screens(): readonly { readonly path: string; readonly testId: string }[] {
  return [
    { path: "/questions", testId: "qcms-questions-rail" },
    { path: "/questions/new", testId: "qcms-new-question-rail" },
    { path: "/forms", testId: "qcms-forms-rail" },
    { path: "/forms/new", testId: "qcms-new-form-rail" },
    { path: `/forms/${FORM_ID}`, testId: "qcms-rail" },
    { path: "/responses", testId: "qcms-responses-rail" },
    { path: "/responses/erasures", testId: "qcms-erasures-rail" },
    { path: "/webhooks", testId: "qcms-webhooks-rail" },
    { path: "/workspaces", testId: "qcms-workspaces-rail" },
    { path: `/workspaces/${WORKSPACE_ID}`, testId: "qcms-workspace-rail" },
    { path: "/settings", testId: "qcms-settings-rail" },
  ];
}

/**
 * Where the content column starts, and how wide the rail beside it is, in one read.
 *
 * Both, because the criterion is about the column and the cause is the rail: a column at the
 * wrong x with no rail beside it is a missing slot page, and a column at the wrong x with a
 * zero-width rail is a missing grid branch. Reading one number would not tell them apart.
 */
async function columnStart(page: Page): Promise<{ readonly left: number; readonly rail: number }> {
  return page.evaluate(() => {
    const main = document.querySelector("main#main-content")?.getBoundingClientRect();
    const rail = document.querySelector("aside.qcms-rail")?.getBoundingClientRect();
    return {
      left: Math.round(main?.left ?? -1),
      rail: Math.round(rail?.width ?? 0),
    };
  });
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("1117 gives every shell screen one rail, and the content column the same left edge at 1440", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.setViewportSize({ width: WIDE, height: 900 });

  const measured: Record<string, { readonly left: number; readonly rail: number }> = {};
  for (const screen of screens()) {
    await page.goto(screen.path);
    // THE SCREEN'S OWN RAIL, by its own handle. Asserting `aside.qcms-rail` alone would
    // pass on a stale rail the previous screen left in the slot, which is the exact defect
    // `@rail/no-section.ts` was written for: on a soft navigation Next keeps a slot the new
    // URL does not match. A `goto` is a hard load, and the handle is what makes a soft one
    // checkable too.
    await expect(
      page.getByTestId(screen.testId),
      `${screen.path} renders its own rail`,
    ).toBeVisible();
    await expect
      .soft(page.locator("aside.qcms-rail"), `${screen.path} renders exactly one rail`)
      .toHaveCount(1);
    measured[screen.path] = await columnStart(page);
  }

  const edges = new Set(Object.values(measured).map((one) => one.left));
  expect(
    [...edges],
    `the content column starts at one x on every screen: ${JSON.stringify(measured)}`,
  ).toHaveLength(1);
  for (const [path, one] of Object.entries(measured)) {
    expect.soft(one.rail, `${path} gives the rail its own track`).toBeGreaterThan(200);
  }
});

test("1117 puts the list filters in the rail and nowhere else", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });

  for (const path of ["/questions", "/forms", "/responses", "/webhooks"]) {
    await page.goto(path);
    const filters = page.getByTestId("qcms-rail-filters");
    await expect(filters, `${path} has the Filters part`).toBeVisible();
    // INSIDE the rail, which is the half of ruling 4 that says the filters MOVED rather
    // than being duplicated: the content column had a card of them on three of these four
    // screens and now has none.
    await expect
      .soft(
        page.getByTestId(screenRail(path)).getByTestId("qcms-rail-filters"),
        `${path} puts them in its own rail`,
      )
      .toHaveCount(1);
    await expect
      .soft(
        page.locator("main#main-content form.qcms-filters"),
        `${path} leaves no filter form in the content column`,
      )
      .toHaveCount(0);
    // §7.0 ruling 2.4's two requirements that are markup rather than layout.
    await expect.soft(filters, `${path} is a search region`).toHaveAttribute("role", "search");
    await expect
      .soft(page.getByTestId(screenRail(path)).getByText("Filters", { exact: true }))
      .toBeVisible();
  }
});

test("1117 applies a filter from the rail into the URL, and reloads the URL back into it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });

  await page.goto("/questions");
  const filters = page.getByTestId("qcms-rail-filters");
  await filters.getByLabel("Search").fill("smoking");
  await filters.getByRole("button", { name: "Apply" }).click();

  // THE URL CARRIES THE STATE, which is what makes a filtered library a link somebody can
  // send and come back to. Apply is a native GET submission, so this is a real navigation
  // rather than a handler writing history.
  await expect(page).toHaveURL(/[?&]q=smoking/u);
  await expect(
    page.getByTestId("qcms-rail-summary-count"),
    "and the Header states how many filters are in force",
  ).toHaveText("1 active");

  // RELOADED FROM THE URL ALONE: a fresh document, which is the only way to tell the state
  // apart from something the first render happened to be holding.
  const url = page.url();
  await page.goto(url);
  await expect(page.getByTestId("qcms-rail-filters").getByLabel("Search")).toHaveValue("smoking");
  await expect(page.getByTestId("qcms-rail-summary-count")).toHaveText("1 active");

  // AND THE WAY OUT IS IN THE RAIL, which appears only once a filter is set. It is the one
  // control with that name on the screen: the filtered-empty panels gave theirs up with
  // this move, because two "Clear filters" are ambiguous to anybody navigating by name.
  const clear = page.getByRole("link", { name: "Clear filters" });
  await expect(clear).toHaveCount(1);
  await clear.click();
  await expect(page).not.toHaveURL(/[?&]q=/u);
  await expect(page.getByTestId("qcms-rail-summary-count")).toHaveCount(0);
});

test("1117 shuts the rail below --bp-sidebar into a summary naming the subject and the count", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  // One pixel under the boundary, which is where this behaviour is pinned everywhere else
  // in the suite: a disclosure that collapsed at 1000 would be a third breakpoint nobody
  // wrote down.
  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto("/questions?status=draft&q=smoking");
  await openRail(page);

  const disclosure = page.locator("details.qcms-rail__disclosure");
  expect(
    await disclosure.evaluate((element) => (element as HTMLDetailsElement).open),
    "the rail is shut below the boundary",
  ).toBe(false);

  // The summary is the whole of the rail in this state, and §7.0's 2026-10-24 clarification
  // gives it the subject plus at most one count - here the active filter count, because
  // this is a list screen.
  const summary = page.locator("summary.qcms-rail__summary");
  await expect(summary).toContainText("Questions");
  await expect(summary.getByTestId("qcms-rail-summary-count")).toHaveText("2 active");

  // The filters are reachable once it is opened, rather than absent at this width.
  await summary.click();
  await expect(page.getByTestId("qcms-rail-filters").getByLabel("Search")).toHaveValue("smoking");

  // And above the boundary the same screen shows the Header as a plain visible header with
  // the body open, which is ruling 2.1 and the reversal #1116 recorded.
  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto("/questions?status=draft&q=smoking");
  await openRail(page);
  expect(
    await disclosure.evaluate((element) => (element as HTMLDetailsElement).open),
    "and open at and above it",
  ).toBe(true);
});

/** Which rail handle a list screen carries, so the loop above can scope into it. */
function screenRail(path: string): string {
  if (path === "/questions") return "qcms-questions-rail";
  if (path === "/forms") return "qcms-forms-rail";
  if (path === "/responses") return "qcms-responses-rail";
  return "qcms-webhooks-rail";
}
