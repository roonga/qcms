import { expect, test } from "./support/gates.js";
import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { SESSION_FIELD } from "../lib/repeat.js";
import { countStepPosts, stepSubmit, submitStep } from "./support/no-js.js";

/**
 * The repeating group without scripting (ADR-42, ADR-43), one of the specs
 * `docs/portal-constraints.md` names as the definition of the no-JS claim.
 *
 * The mechanism, because the assertions only make sense against it: Add and Remove are
 * named submit buttons carrying `formnovalidate`, and a `<button name value>`
 * contributes its pair only when it is the submitter, so one form carries several
 * operations with no repeated field name. The form's action is a Server Action, which
 * applies the operation and re-renders the step in the same 200, and that response is
 * what carries every typed value back; Continue keeps its own URL through `formaction`,
 * so it still reaches the whole-step route and its 303.
 *
 * An Add or Remove post commits no answers, which is what makes `formnovalidate` safe:
 * an emptied previously answered required field on such a post is neither stored nor
 * retracted.
 */

test.use({ javaScriptEnabled: false });

const { repeatFleetSlug, databaseUrl } = readFixtures();

const ADD = "Add Vehicle";
const removeName = (ordinal: number): string => `Remove Vehicle ${String(ordinal)}`;

function card(page: import("@playwright/test").Page, ordinal: number) {
  return page.locator("fieldset[data-qcms-instance]").nth(ordinal - 1);
}

/**
 * React renders a Server Action's form as `multipart/form-data`, so the post is not a
 * query string and `URLSearchParams` reads nothing from it. Deliberately small: parts
 * split on the boundary, and a part's value is what follows its blank line.
 */
function multipartValues(body: string, field: string): string[] {
  const values: string[] = [];
  for (const part of body.split(/--[-A-Za-z0-9]+/)) {
    const match = /name="([^"]*)"\r?\n\r?\n([\s\S]*?)\r?\n?$/.exec(part.trimStart());
    if (match !== null && match[1] === field) values.push(match[2] ?? "");
  }
  return values;
}

async function startNoJsRepeat(page: import("@playwright/test").Page): Promise<string> {
  await page.goto(`/f/${repeatFleetSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2]!;
}

/**
 * Press a `__qop` button and wait for the page the **200** carries back.
 *
 * A native submission the browser REFUSES looks exactly like one that submitted and
 * changed nothing, so the wait is on the served response rather than on a timeout. The
 * response is a 200 to a POST here rather than a 303 followed by a GET, which is the
 * whole point of the mechanism.
 */
async function rosterPress(page: import("@playwright/test").Page, name: string): Promise<void> {
  const served = page.waitForResponse((response) => response.request().isNavigationRequest(), {
    timeout: 120_000,
  });
  await page.getByRole("button", { name }).click();
  const response = await served;
  expect(response.status(), `the ${name} post's own response`).toBe(200);
}

/**
 * Post the step the way a browser would, but **without the browser's own validation**.
 *
 * Needed because two of the cases below turn on what the API refuses, and the browser
 * refuses those posts first: HTML `required` blocks an empty required field and
 * `minlength` blocks a plate below the question's floor, so a form the API would reject
 * never leaves the page. `page.request` shares this context's cookies, so this is the same
 * session the page is looking at - a respondent defeating their own form, which is the
 * threat model that makes server-side validation worth having (R2: the API is
 * authoritative). It is the shape `no-js-number.pw.ts` already uses for the same reason.
 *
 * `fields` are raw form entries: a value under its (qualified) field name, and a
 * `__qk__`-prefixed kind tag for each, which is what the decoder iterates.
 */
async function craftStepPost(
  page: import("@playwright/test").Page,
  sessionId: string,
  fields: Readonly<Record<string, string>>,
): Promise<void> {
  const form: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    form[name] = value;
    form[`__qk__${name}`] = "string";
  }
  const response = await page.request.post(`/s/${sessionId}/step`, {
    headers: { "sec-fetch-site": "same-origin" },
    form,
    maxRedirects: 0,
  });
  expect(response.status(), "the crafted whole-step post").toBe(303);
}

/**
 * Every value posted under one field name, whichever encoding the form used.
 *
 * The step form's enctype is `multipart/form-data`, because its action is a Server
 * Action, and that holds for the Continue control too even though Continue posts to a
 * plain URL through `formaction`. So both readings are tried rather than assumed, and a
 * body in neither encoding yields nothing from both - which is why the assertions that
 * expect nothing also assert something they DO expect to find.
 */
function postedValues(body: string, field: string): string[] {
  const multipart = multipartValues(body, field);
  if (multipart.length > 0) return multipart;
  return new URLSearchParams(body).getAll(field);
}

/** The live instance ids on the page, in the order their cards are drawn. */
async function instanceIds(page: import("@playwright/test").Page): Promise<string[]> {
  return page
    .locator("fieldset[data-qcms-instance]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-qcms-instance") ?? ""));
}

test("case 28: the whole walk completes without scripting, add and remove included", async ({
  page,
}) => {
  test.slow();
  const sessionId = await startNoJsRepeat(page);

  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await card(page, 1).getByLabel("Registration plate").fill("AAA111");

  await rosterPress(page, ADD);
  await expect(page.getByLabel("Fleet reference")).toHaveValue("NORTH-1");
  await expect(card(page, 1).getByLabel("Registration plate")).toHaveValue("AAA111");
  await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();

  await card(page, 2).getByLabel("Registration plate").fill("BBB222");
  await rosterPress(page, ADD);
  await card(page, 3).getByLabel("Registration plate").fill("CCC333");

  await rosterPress(page, removeName(2));
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(2);
  await expect(card(page, 2).getByLabel("Registration plate")).toHaveValue("CCC333");

  await submitStep(page);
  await expect(page).toHaveURL(/\/done/);

  const db = await openDb(databaseUrl);
  try {
    const locked = await db.lockedAnswers(sessionId);
    expect(
      locked.filter((answer) => answer.questionId === "q_rf_plate").map((a) => a.value),
    ).toEqual(["AAA111", "CCC333"]);
    const roster = await db.rosterRows(sessionId);
    expect(roster.filter((row) => row.event === "added")).toHaveLength(3);
    expect(roster.filter((row) => row.event === "removed")).toHaveLength(1);
  } finally {
    await db.close();
  }
});

test("case 29: Add with a blank required field adds, writes nothing, and replays once", async ({
  page,
}) => {
  const sessionId = await startNoJsRepeat(page);
  const db = await openDb(databaseUrl);
  try {
    const [first] = await instanceIds(page);
    await craftStepPost(page, sessionId, { [`${first!}/q_rf_plate`]: "AAA111" });
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
    await expect(card(page, 1).getByLabel("Registration plate")).toHaveValue("AAA111");
    const beforeRows = await db.instanceAnswerRows(sessionId);
    expect(beforeRows.filter((row) => row.questionId === "q_rf_plate")).toHaveLength(1);

    await card(page, 1).getByLabel("Registration plate").fill("");
    const posts = countStepPosts(page);
    await rosterPress(page, ADD);

    await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();
    expect(posts()).toBe(0);

    const afterRows = await db.instanceAnswerRows(sessionId);
    expect(afterRows).toEqual(beforeRows);
    expect(afterRows.some((row) => row.retracted)).toBe(false);

    await expect(card(page, 1).getByLabel("Registration plate")).toHaveValue("");

    const instancesBefore = await page.locator("fieldset[data-qcms-instance]").count();
    await page.reload();
    await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(instancesBefore);
    const roster = await db.rosterRows(sessionId);
    expect(roster.filter((row) => row.event === "added")).toHaveLength(2);
  } finally {
    await db.close();
  }
});

test("case 30: exactly one __qop entry reaches the server, or none", async ({ page }) => {
  const sessionId = await startNoJsRepeat(page);

  const named = page.locator('[name="__qop"]');
  await expect(named).toHaveCount(2);
  for (const handle of await named.all()) {
    expect(await handle.evaluate((node) => node.tagName)).toBe("BUTTON");
    await expect(handle).toHaveAttribute("type", "submit");
    await expect(handle).toHaveAttribute("formnovalidate", "");
  }
  expect(await page.locator('input[name="__qop"]').count()).toBe(0);

  const request = page.waitForRequest(
    (candidate) => candidate.method() === "POST" && candidate.isNavigationRequest(),
  );
  await page.getByRole("button", { name: ADD }).click();
  const body = (await request).postData() ?? "";
  const entries = multipartValues(body, "__qop");
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/^add:grp_vehicles:op_[0-9a-f]+$/);

  await page.getByLabel("Fleet reference").fill("NORTH-1");
  for (const ordinal of [1, 2]) {
    await card(page, ordinal)
      .getByLabel("Registration plate")
      .fill(`PLATE${String(ordinal)}`);
  }
  const continueRequest = page.waitForRequest(
    (candidate) =>
      candidate.method() === "POST" &&
      /\/s\/ses_[^/]+\/step$/.test(new URL(candidate.url()).pathname),
  );
  await stepSubmit(page).click();
  const continueBody = (await continueRequest).postData() ?? "";
  expect(postedValues(continueBody, "__qop")).toEqual([]);
  expect(postedValues(continueBody, SESSION_FIELD)).toEqual([sessionId]);
});

test("Enter in a member field continues and leaves the roster alone (local UX list P3)", async ({
  page,
}) => {
  const sessionId = await startNoJsRepeat(page);
  await page.getByLabel("Fleet reference").fill("NORTH-1");
  const plate = card(page, 1).getByLabel("Registration plate");
  await plate.fill("AAA111");
  const remove = page.getByRole("button", { name: removeName(1) });
  await expect(remove).toBeVisible();
  const visibleSubmit = await stepSubmit(page).elementHandle();
  expect(
    await remove.evaluate(
      (node, submit) =>
        (node.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      visibleSubmit,
    ),
  ).toBe(true);

  const posts = countStepPosts(page);
  const served = page.waitForResponse(
    (response) => response.request().isNavigationRequest() && response.status() === 200,
  );
  await plate.press("Enter");
  await served;

  await expect(page).toHaveURL(/\/done/);
  expect(posts()).toBe(1);

  const db = await openDb(databaseUrl);
  try {
    const roster = await db.rosterRows(sessionId);
    expect(roster.filter((row) => row.event === "added")).toHaveLength(1);
    expect(roster.filter((row) => row.event === "removed")).toHaveLength(0);
    const locked = await db.lockedAnswers(sessionId);
    expect(
      locked.filter((answer) => answer.questionId === "q_rf_plate").map((a) => a.value),
    ).toEqual(["AAA111"]);
  } finally {
    await db.close();
  }
});

test("case 35: a re-render after a refusal shows every accepted answer and every refused value", async ({
  page,
}) => {
  const sessionId = await startNoJsRepeat(page);
  await rosterPress(page, ADD);
  await rosterPress(page, ADD);
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(3);
  const ids = await instanceIds(page);

  await craftStepPost(page, sessionId, {
    q_rf_fleet_ref: "NORTH-1",
    [`${ids[0]!}/q_rf_plate`]: "AAA111",
    [`${ids[1]!}/q_rf_plate`]: "BB",
    [`${ids[2]!}/q_rf_plate`]: "CCC333",
  });
  await page.goto(`/s/${sessionId}`);

  await expect(page.getByLabel("Fleet reference")).toHaveValue("NORTH-1");
  await expect(card(page, 1).getByLabel("Registration plate")).toHaveValue("AAA111");
  await expect(card(page, 3).getByLabel("Registration plate")).toHaveValue("CCC333");
  await expect(card(page, 2).getByLabel("Registration plate")).toHaveValue("BB");
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();
  await expect(summary.getByRole("link", { name: /^Vehicle 2: Registration plate/ })).toBeVisible();

  const db = await openDb(databaseUrl);
  try {
    const rows = (await db.instanceAnswerRows(sessionId)).filter(
      (row) => row.questionId === "q_rf_plate",
    );
    expect(rows).toHaveLength(2);
  } finally {
    await db.close();
  }
});

test("the browser refuses a plate below the question's floor, inside a group as outside one", async ({
  page,
}) => {
  await startNoJsRepeat(page);
  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await card(page, 1).getByLabel("Registration plate").fill("BB");
  const posts = countStepPosts(page);
  await stepSubmit(page).click();
  await expect(card(page, 1).getByLabel("Registration plate")).toBeFocused();
  expect(posts()).toBe(0);
  await rosterPress(page, ADD);
  await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();
});

test("a refused whole-step post comes back with a message and every typed value", async ({
  page,
}) => {
  const sessionId = await startNoJsRepeat(page);
  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await page.context().addCookies([
    {
      name: "qcms_step_ctx",
      value: JSON.stringify({
        values: { q_rf_fleet_ref: "NORTH-1" },
        errors: {},
        constraints: {},
        missingRequired: [],
        notice: "step.notSaved",
      }),
      url: page.url(),
    },
  ]);

  await page.goto(`/s/${sessionId}`);

  const notice = page.getByTestId("step-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Nothing was saved");
  await expect(notice).toHaveAttribute("role", "alert");
  await expect(page.getByLabel("Fleet reference")).toHaveValue("NORTH-1");

  const db = await openDb(databaseUrl);
  try {
    expect(await db.instanceAnswerRows(sessionId)).toEqual([]);
  } finally {
    await db.close();
  }
});

test("the group renders one card per live instance with a legend and a heading", async ({
  page,
}) => {
  await startNoJsRepeat(page);
  const legend = card(page, 1).locator(":scope > legend");
  await expect(legend).toHaveText("Vehicle 1");
  await expect(legend.locator("h4")).toHaveAttribute("tabindex", "-1");
  const instanceId = await card(page, 1).getAttribute("data-qcms-instance");
  await expect(legend.locator("h4")).toHaveAttribute("id", instanceId!);
  await expect(legend).not.toContainText("ins_");
});

test("the 200 lands focus on the new instance by autofocus, never by a fragment", async ({
  page,
}) => {
  await startNoJsRepeat(page);
  await rosterPress(page, ADD);
  const second = await card(page, 2).getAttribute("data-qcms-instance");
  await expect(card(page, 2).locator("h4")).toHaveAttribute("autofocus", "");
  expect(new URL(page.url()).hash).toBe("");
  await page.waitForFunction(() => document.activeElement?.tagName !== "BODY");
  await expect(page.locator(":focus")).toHaveAttribute("id", second!);
});
