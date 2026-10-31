import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { rulesNotRun } from "@roonga/qcms-e2e-support/axe";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { openDbHandle } from "../../api/e2e/support/index.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { chooseSource } from "./support/publish.js";

/**
 * The two-person rule for production, in a browser (ADR-41's release rule, Q13, Q30, Q51;
 * task 070).
 *
 * # Why these claims are browser claims
 *
 * The API's own suite asserts the rule: every self-release and self-confirm path is refused
 * there, over HTTP, in `apps/api/e2e/security/01-authorization-matrix.e2e.ts`. The component
 * tests assert the two panels' rendering from invented props. Neither can see the three
 * things this file is for, and each of the three is a way the feature can be whole and
 * still useless:
 *
 *   - **the wiring on `forms/[formId]/webhooks/page.tsx`**: the pending list is a fourth
 *     read on that screen and the confirm and withdraw actions are bound there with the
 *     form and the shown environment. A regression in that binding leaves every component
 *     test green and the panel reading nothing, or acting in the wrong environment.
 *   - **that a `202` reads as "waiting" rather than as "done"**. This is the one outcome in
 *     the product where the operator's act succeeded and *nothing changed*, and a screen
 *     that reported it as a success would tell them a production endpoint had moved when it
 *     had not. The component test drives the state directly; only a real propose through
 *     the real route proves the screen reaches it.
 *   - **that the refusals arrive as sentences**. `PROPOSER_CANNOT_CONFIRM` and
 *     `APPROVER_IS_AUTHOR` are the two refusals this feature exists to produce, so they are
 *     the two an operator is most likely to read. Unmapped they render as
 *     "The request failed (APPROVER_IS_AUTHOR)", which is the code teaching the feature.
 *
 * # Two accounts, because the rule is about two accounts
 *
 * `membership.pw.ts` drives the switch and reads its help text; it has one account, so it
 * cannot walk the rule. This file enrolls **two**, each holding the default grant set, and
 * the second one is the only reason any confirmation here succeeds. One person may hold
 * `forms.editor` and `forms.approver` together, so what the rule separates is accounts, and
 * a spec with one account could only ever assert the refusals.
 *
 * # This file owns the seeded workspace's switch, and leaves it off
 *
 * The switch is workspace state, not per-test state, so turning it on reaches every later
 * screen that reads it. The suite runs `workers: 1` with `fullyParallel: false`, so no other
 * file is mid-run while this one holds it on, and `membership.pw.ts` - the one file that
 * asserts the switch is **unchecked** - sorts before this one. The last test here turns it
 * back off, which is the invariant a test added to this file has to keep: leave the
 * workspace as Q13's default found it.
 *
 * **The `afterAll` below is what makes that invariant true when the group is cut short**,
 * and the case it is for is a CI retry rather than another spec: a retry re-runs the serial
 * group from test 1, and test 2 asserts the default. See the hook.
 *
 * # The accessibility checks here, and what stays in the sweep
 *
 * `a11y-axe.pw.ts` is the sweep: three modes, the heading-order debt register, every state
 * it can reach. It cannot reach these two, because a pending production change needs the
 * switch on and two accounts. So this file runs **the sweep's own rule set** on the two
 * states its flow produces, through the shared `rulesNotRun` bookkeeping, and asserts the
 * 320px reflow SC 1.4.10 names. It is not a second gate and it does not restate the mode
 * sweep or the register: those stay the sweep's, and if these states ever become reachable
 * from it they belong there instead.
 */

test.describe.configure({ mode: "serial" });

/** The account that proposes, and that publishes nothing: it is the one refused a confirm. */
const PROPOSER = uniqueAdminEmail("twoperson-proposer");
/** The second account. Its existence is what makes any confirmation here possible. */
const APPROVER = uniqueAdminEmail("twoperson-approver");

/** The workspace a bootstrapped installation is seeded with (ADR-41, task 068). */
const WORKSPACE_ID = "org_default_workspace";
/** The insurance fixture's form, which the harness seeds with published versions. */
const FORM_ID = "frm_auto_quote";

const AGREED_URL = "https://agreed-consumer.example/qcms-hook";
const WITHDRAWN_URL = "https://withdrawn-consumer.example/qcms-hook";

/** Set by the enrolling tests; the rest sign in again (serial shares no browser context). */
let proposerSecret = "";
let approverSecret = "";
/** The pending change this spec creates, read off its own row rather than guessed. */
let proposalId = "";

test.beforeAll(async () => {
  // Two accounts, each holding the default grant set, which includes `forms.approver`
  // scoped to every environment and the `forms.owner` member row that may flip the switch.
  // The rule is about two **accounts**, so one account could only ever assert refusals.
  await createTestAdmin(PROPOSER);
  await createTestAdmin(APPROVER);
});

/**
 * Put the switch back to Q13's default, whatever happened above.
 *
 * The last test turns it off through the real panel, which is the claim; this is the net
 * under it, and the case it exists for is a **CI retry** rather than another spec (PR
 * #1100's round-two review, finding 2). A failure anywhere in a serial group skips the rest
 * of the group, test 8 included, so the switch stays on - and `retries: 2` then re-runs the
 * group from test 1, where test 2 asserts the switch is **unchecked**. Without this hook any
 * flake in tests 2 to 7 converts into a deterministic red at test 2, reported against "Q13's
 * default" rather than against whatever actually broke. Hooks still run when a serial group
 * is cut short, which is what makes the net work.
 *
 * A raw statement rather than the product's own route, for the reason `markProvisional` uses
 * one: this is harness code reaching for one row, the database client belongs to the API
 * workspace, and a cleanup that went through the UI could fail for the same reason the test
 * before it did. The same shape as
 * `apps/api/src/features/releases/releases.integration.test.ts`'s `afterAll` on this switch.
 */
test.afterAll(async () => {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    const updated = await handle.query(
      `update control."organization" set "requireSecondApprover" = false where id = $1`,
      [WORKSPACE_ID],
    );
    // A silent no-op is the failure mode worth refusing, which is `markProvisional`'s rule
    // one table over: a renamed column throws on its own, but a workspace id this harness
    // no longer matches would leave the switch on while the hook reported success - and the
    // next run would meet exactly the red at test 2 that this hook exists to prevent.
    if (updated.rows.length === 0 && (updated as { rowCount?: number }).rowCount === 0) {
      throw new Error(`the two-person cleanup matched no workspace for ${WORKSPACE_ID}`);
    }
  } finally {
    await handle.close();
  }
});

/** The sweep's tag set and extra rules, applied here to a state the sweep cannot reach. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const EXTRA_RULES = { "heading-order": { enabled: true } };

/**
 * Zero violations on the state the page is in, with the rules shown to have run.
 *
 * Narrower than the sweep's helper **on purpose**: no mode sweep and no debt register, both
 * of which belong to `a11y-axe.pw.ts` and neither of which this file should carry a second
 * copy of. What it keeps is the part that makes an axe assertion worth anything - the rule
 * set, and the check that the rules asked for actually loaded (issue #943), which is the
 * shared `rulesNotRun`.
 */
async function expectAxeClean(page: Page, state: string): Promise<void> {
  // From the top of the page: `.qcms-topbar` is sticky, so `target-size` hit-tests
  // whatever a scrolled control is sitting under. The sweep normalises the same way.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS }, rules: EXTRA_RULES })
    .analyze();
  expect(
    rulesNotRun(results, Object.keys(EXTRA_RULES)),
    `axe did not load these rules on the ${state} state`,
  ).toEqual([]);
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.help} [${v.nodes
          .map((node) => `${node.target.join(" ")} - ${node.failureSummary ?? ""}`)
          .join(" | ")}]`,
    ),
    `axe violations on the ${state} state`,
  ).toEqual([]);
}

/** The document's scroll width at one viewport, for SC 1.4.10. */
async function expectNoHorizontalScroll(page: Page, state: string): Promise<void> {
  const previous = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: 320, height: 720 });
  try {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // Zero, not "close to zero": a panel that makes a screen scroll sideways at 320px is
    // the defect 1.4.10 names, and the other admin screens are already clean at this width
    // (`reflow.pw.ts`), so a new panel has no allowance to inherit.
    expect(
      overflow,
      `${state} overflows a 320px viewport by ${String(overflow)}px`,
    ).toBeLessThanOrEqual(0);
  } finally {
    await page.setViewportSize(previous);
  }
}

/** Turn the workspace's two-person switch on or off through the real settings panel. */
async function setTwoPersonSwitch(page: Page, on: boolean): Promise<void> {
  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  await waitForHydration(page);
  const control = twoPersonControl(page);
  // **The label is what gets pressed, not the input.** The kit's Checkbox is a React Aria
  // control whose real input is visually hidden, so neither `click()` nor `check()` on the
  // input lands anywhere: `check()` waits for a visible element and times out, and the
  // first version of this helper spent a five-minute test budget doing exactly that.
  // Pressing the label is also what an operator does.
  if ((await control.isChecked()) !== on) {
    await page.getByText("Require a second approver for production", { exact: true }).click();
  }
  await expect(control).toBeChecked({ checked: on });
  await page.getByRole("button", { name: "Save settings" }).click();
  // The panel reports its own outcome, and the sentence names the audit - which is the
  // half Q57 and Q61 are about: turning it on is an owner's deliberate, recorded act.
  await expect(page.getByText("the change is on the access audit", { exact: false })).toBeVisible();
}

/** The workspace's two-person switch, by the accessible name its label gives it. */
function twoPersonControl(page: Page) {
  return page.getByRole("checkbox", {
    name: "Require a second approver for production",
    exact: true,
  });
}

/** The pending-changes panel, which renders nothing at all when nothing is waiting. */
function pendingPanel(page: Page) {
  return page.getByTestId("qcms-endpoint-proposals");
}

/** The endpoint list's row for one URL, if it has one. */
function endpointRowFor(page: Page, url: string) {
  return page.getByTestId("qcms-webhooks-table").locator("tr").filter({ hasText: url });
}

/** The row for the change this spec created, by the id read off it. */
function pendingRow(page: Page) {
  return pendingPanel(page).locator(`tr[data-proposal="${proposalId}"]`);
}

test("the sign-in screen is served before anything types into it", async ({ page }) => {
  test.setTimeout(300_000);
  // **A compile step, asserted rather than slept through.** The admin runs as a dev server
  // in this suite, so the first request for a route pays its compilation - and on
  // `/sign-in` that lands while React is hydrating the form, which is enough to make the
  // next test's two fills race a re-render ("Execution context was destroyed"). Every
  // sibling spec is spared it because an earlier file in the run warmed the route; this
  // one is the first to reach it, and it is also what a single-file run looks like.
  //
  // So the cost is paid here, in a test that types nothing, and the claim is real: the
  // screen an operator starts from is served and interactive.
  await page.goto("/sign-in");
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("the switch is off by default, and an owner turns it on through the panel", async ({
  page,
}) => {
  test.setTimeout(300_000);
  proposerSecret = await enrollNewAdmin(page, PROPOSER);

  await page.goto(`/workspaces/${WORKSPACE_ID}`);
  // Q13's default, read off the real control before anything turns it on. A spec that
  // started by switching it on could not tell the default from its own first act.
  await expect(twoPersonControl(page)).not.toBeChecked();

  await setTwoPersonSwitch(page, true);
  // Reloaded, so what is asserted is the stored value rather than the control's own state.
  await page.reload();
  await expect(twoPersonControl(page)).toBeChecked();
});

test("a prod endpoint change is stored waiting, and nothing is live", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, PROPOSER, proposerSecret);
  await page.goto(`/forms/${FORM_ID}/webhooks`);

  await page.getByRole("button", { name: "Add endpoint" }).click();
  const dialog = page.getByTestId("qcms-webhook-url-dialog");
  await dialog.getByRole("textbox", { name: "Endpoint URL" }).fill(AGREED_URL);
  await dialog.getByRole("button", { name: "Create endpoint" }).click();

  // **"Waiting", not "done".** The one outcome where the act succeeded and nothing
  // changed, and the sentence has to say so where the operator is looking.
  await expect(page.getByTestId("qcms-webhook-pending")).toContainText(
    "Nothing has changed in prod yet",
  );
  // The secret is still revealed, because this is the only moment its plaintext exists
  // (SEC-6) - and nothing signs with it until the change is confirmed.
  await expect(page.getByTestId("qcms-webhook-secret")).toBeVisible();
  await page.getByRole("button", { name: "I have copied it" }).click();

  // The panel names the change, the account that proposed it, and the state.
  await expect(pendingPanel(page)).toContainText(AGREED_URL);
  await expect(pendingPanel(page)).toContainText("Waiting for a second approver");
  await expect(pendingPanel(page)).toContainText("Add this endpoint");

  // **Nothing live.** The endpoint list is the screen's other half and it has no row for
  // this URL, because the proposal reached no `data_prod.webhooks` row at all.
  //
  // Asserted on the **URL** rather than on the table's absence: this form carries whatever
  // endpoints earlier specs in the run left on it, so "no table" is true in a single-file
  // run and false in the suite - which is how the first version of this line passed alone
  // and failed at test 466. The URL is unique to this file, so the narrower claim is the
  // one that is actually about the mechanism.
  await expect(endpointRowFor(page, AGREED_URL)).toHaveCount(0);

  proposalId =
    (await pendingPanel(page)
      .locator("tr")
      .filter({ hasText: AGREED_URL })
      .getAttribute("data-proposal")) ?? "";
  expect(proposalId, "the pending change owns a row").toMatch(/^wep_/u);

  await expectAxeClean(page, "pending endpoint change");
  await expectNoHorizontalScroll(page, "pending endpoint change");
});

test("the account that proposed it cannot confirm it, and is told why", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, PROPOSER, proposerSecret);
  await page.goto(`/forms/${FORM_ID}/webhooks`);

  // The warning is on the dialog before anything is pressed, because a refusal is a worse
  // way to learn a rule than a sentence.
  // Scoped to the row this spec created, by the id read off it, so a second pending change
  // from elsewhere in the suite could not make this press ambiguous.
  await pendingRow(page).getByRole("button", { name: "Confirm" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("You cannot confirm a change you proposed yourself");
  // Q6's restatement, in the words the catalog uses: the act names its environment.
  await expect(dialog.getByTestId("qcms-proposal-environment")).toContainText("In prod");
  // A new endpoint, so the sentence is the create one rather than "starts delivering to".
  await expect(dialog).toContainText("A new endpoint in prod starts receiving deliveries");

  await dialog.getByRole("button", { name: "Confirm" }).click();
  // And the refusal is a sentence rather than a code: this is the API's answer, rendered.
  await expect(page.getByTestId("qcms-proposal-status")).toContainText(
    "You proposed this change, so you cannot confirm it",
  );
  // Still waiting, and still nothing live.
  await expect(pendingPanel(page)).toContainText("Waiting for a second approver");
  await expect(endpointRowFor(page, AGREED_URL)).toHaveCount(0);
});

test("a second approver confirms it, and the endpoint goes live", async ({ page }) => {
  test.setTimeout(300_000);
  approverSecret = await enrollNewAdmin(page, APPROVER);
  await page.goto(`/forms/${FORM_ID}/webhooks`);

  await pendingRow(page).getByRole("button", { name: "Confirm" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Confirm" }).click();

  // The panel empties, because nothing is waiting any more, and the endpoint list now
  // carries the row. Both halves, because either one alone would be satisfiable by a bug.
  await expect(pendingPanel(page)).toHaveCount(0);
  await expect(endpointRowFor(page, AGREED_URL)).toHaveCount(1);
});

test("either account can withdraw a waiting change, and the endpoint is untouched", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, APPROVER, approverSecret);
  await page.goto(`/forms/${FORM_ID}/webhooks`);

  // Retarget the live endpoint, which is the ordinary shape of a production change.
  const row = page.getByTestId("qcms-webhooks-table").locator("tr").filter({ hasText: AGREED_URL });
  await row.getByRole("button", { name: "Change URL" }).click();
  const retarget = page.getByTestId("qcms-webhook-url-dialog");
  await retarget.getByRole("textbox", { name: "Endpoint URL" }).fill(WITHDRAWN_URL);
  await retarget.getByRole("button", { name: "Save the URL" }).click();

  await expect(page.getByTestId("qcms-webhook-pending")).toBeVisible();
  await expect(pendingPanel(page)).toContainText(WITHDRAWN_URL);
  // The live endpoint still holds the agreed URL while the change waits, which is the
  // property the whole mechanism is for.
  await expect(page.getByTestId("qcms-webhooks-table")).toContainText(AGREED_URL);

  await pendingPanel(page).getByRole("button", { name: "Withdraw" }).click();
  const dialog = page.getByRole("alertdialog");
  // The withdrawal states what it discards and what it leaves alone.
  await expect(dialog).toContainText("left exactly as it is");
  await dialog.getByRole("button", { name: "Withdraw" }).click();

  await expect(pendingPanel(page)).toHaveCount(0);
  await expect(page.getByTestId("qcms-webhooks-table")).toContainText(AGREED_URL);
  expect(await page.content()).not.toContain(WITHDRAWN_URL);
});

test("the publish wizard carries the rule's notice with the switch on", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, APPROVER, approverSecret);
  await page.goto(`/forms/${FORM_ID}/publish`);

  await chooseSource(page, "An existing version");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();

  // **The notice renders, in production, with the switch on.** The fixture's versions were
  // seeded without a publishing account, so the reading here is the "cannot be checked"
  // one - which is the honest state of a pre-070 version and the one an operator of an
  // upgraded deployment meets first. The other two readings (you published this one; you
  // are the second account) are the same pure function with a different author, and
  // `release-panel-two-person.test.tsx` walks all three: producing a version published by
  // *this* account in a browser means building a whole form to publish, which buys nothing
  // this file is for.
  await expect(destinations.locator('span[data-code="APPROVER_UNKNOWN_AUTHOR"]')).toContainText(
    "was not recorded",
  );
  // Disabled with that reason rather than merely inert: the confirmation would refuse it.
  await expect(destinations.getByRole("checkbox", { name: "prod", exact: true })).toBeDisabled();

  await expectAxeClean(page, "the publish wizard under the two-person rule");
  await expectNoHorizontalScroll(page, "the publish wizard under the two-person rule");
});

test("the publish wizard says nothing about the rule once the switch is off", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, APPROVER, approverSecret);
  await setTwoPersonSwitch(page, false);

  await page.goto(`/forms/${FORM_ID}/publish`);
  await chooseSource(page, "An existing version");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const destinations = page.getByTestId("qcms-publish-destinations");
  await expect(destinations).toBeVisible();

  // Criterion 3, in the browser: the same account, the same version, the same environment,
  // and with the switch off the screen says nothing about any of it. An implementation
  // that asked for an approver and then accepted the same account would look exactly like
  // this from the API and wrong from here.
  await expect(destinations.locator('span[data-code^="APPROVER_"]')).toHaveCount(0);
  // And the rule is the only thing that stopped being said. The fixture's prod already
  // serves this version, so naming every blocker left on it - rather than asserting it is
  // selectable, which it never was here - is what proves the approver reading is gone and
  // nothing else moved with it.
  const prod = destinations.locator('div[data-environment="prod"]');
  await expect(prod.locator('span[data-testid="qcms-publish-blocker"]')).toHaveCount(1);
  await expect(prod.locator('span[data-code="ALREADY_RELEASED"]')).toBeVisible();
});
