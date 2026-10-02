import { expect, test } from "./support/gates.js";
import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { SESSION_FIELD } from "../lib/repeat.js";
import { countStepPosts, stepSubmit, submitStep } from "./support/no-js.js";

/**
 * The repeating group **without scripting** (task 073, ADR-42, ADR-43).
 *
 * This is the **eighth** spec `docs/portal-constraints.md` names as the definition of
 * the no-JS claim, beside submit, required-date, multi-choice, number, select,
 * retraction and appearance. The claim is unqualified and its exception list is empty:
 * there is no question shape a respondent without scripting cannot answer, and a
 * repeating group is the newest shape it had to stay true of.
 *
 * ## What the mechanism is, because the assertions only make sense against it
 *
 * The Add and Remove controls are **named submit buttons** on the step's own form,
 * `name="__qop"`, carrying `formnovalidate`. A `<button name value>` contributes its
 * pair to the form data set only when it is the submitter, so one form carries several
 * operations with no scripting at all and no repeated field name is relied on anywhere.
 *
 * The form's `action` is a **Next Server Action**, which applies the roster operation
 * and re-renders the step in the same **200** response: that response is what carries
 * every typed value back, because the values are the whole step rather than a refused
 * subset and a nine-instance step does not fit a 4 KB cookie. Continue keeps its own
 * URL through `formaction` on the submit control, so it still reaches the whole-step BFF
 * route and its 303. The Code Owner ruled that shape on 2026-10-01 after the earlier
 * 200-from-a-route-handler proved unbuildable in Next's App Router.
 *
 * **An Add or Remove post commits NO answers.** That is what makes `formnovalidate`
 * safe rather than merely convenient, and cases 29 below are where it is proved: an
 * emptied previously answered required field on such a post is neither stored nor
 * retracted, so the ledger holds what it held before.
 *
 * Acceptance cases owned here: **28** (the whole walk completes, add and remove
 * included, and reaches the receipt), **29** (Add with a blank required field is not
 * refused, every typed value comes back, no answer row is written, no retraction is
 * appended, and a replay applies the operation once), **30** (exactly one `__qop` entry
 * on the wire, or none) and **35** (a re-render after a validation failure returns every
 * accepted answer and every refused value beside its own message).
 */

test.use({ javaScriptEnabled: false });

const { repeatFleetSlug, databaseUrl } = readFixtures();

const ADD = "Add Vehicle";
const removeName = (ordinal: number): string => `Remove Vehicle ${String(ordinal)}`;

function card(page: import("@playwright/test").Page, ordinal: number) {
  return page.locator("fieldset[data-qcms-instance]").nth(ordinal - 1);
}

/**
 * Every value posted under one field name, read out of a `multipart/form-data` body.
 *
 * The step form's action is a Server Action, and React renders such a form as
 * `multipart/form-data`, so the browser's post is not a query string and
 * `URLSearchParams` reads nothing from it. This is a deliberately small reader: the
 * parts are split on the boundary, and a part's value is what follows its blank line.
 */
function multipartValues(body: string, field: string): string[] {
  const values: string[] = [];
  for (const part of body.split(/--[-A-Za-z0-9]+/)) {
    const match = /name="([^"]*)"\r?\n\r?\n([\s\S]*?)\r?\n?$/.exec(part.trimStart());
    if (match !== null && match[1] === field) values.push(match[2] ?? "");
  }
  return values;
}

/** Start the flow without scripting and land on the step. */
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
  // Waits for the navigation the press produces and then ASSERTS its status. Waiting for a
  // 200 specifically would turn any other answer - a framework error, a belt refusal - into
  // a bare timeout, and the response here is the whole mechanism under test.
  // The timeout is explicit and generous because the FIRST `__qop` post in a run pays
  // for the dev server compiling the Server Action route, which on a loaded host takes
  // longer than the default action budget on its own. It is a compile cost, not a
  // property of the mechanism, and a real refusal still fails fast on the status below.
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
    // `"string"` is the WIRE kind, which is not the question type: the vocabulary is
    // `string | number | radio | multi` (`native-submit.ts`). A tag the decoder does not
    // recognise is ignored, and since the decoder iterates the TAGS rather than the
    // values, an unrecognised one means the post carries no answers at all - a 303 that
    // stored nothing, which is what "shortText" produced here.
    form[`__qk__${name}`] = "string";
  }
  const response = await page.request.post(`/s/${sessionId}/step`, {
    headers: { "sec-fetch-site": "same-origin" },
    form,
    maxRedirects: 0,
  });
  // A 303 either way: the route redirects back to the step whether the API accepted the
  // batch or refused it, and what differs is the context cookie it writes first.
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
  // The first `__qop` post in a run pays for Next compiling the Server Action route,
  // which on a loaded host can take most of the default budget on its own. The
  // assertions below are the walk's, not the compiler's.
  test.slow();
  const sessionId = await startNoJsRepeat(page);

  await page.getByLabel("Fleet reference").fill("NORTH-1");
  await card(page, 1).getByLabel("Registration plate").fill("AAA111");

  await rosterPress(page, ADD);
  // The typed values came back in the 200: the POST body is the carrier, so nothing had
  // to survive a cookie or a redirect.
  await expect(page.getByLabel("Fleet reference")).toHaveValue("NORTH-1");
  await expect(card(page, 1).getByLabel("Registration plate")).toHaveValue("AAA111");
  await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();

  await card(page, 2).getByLabel("Registration plate").fill("BBB222");
  await rosterPress(page, ADD);
  await card(page, 3).getByLabel("Registration plate").fill("CCC333");

  // Remove the middle one. Its answer stays in the ledger and leaves the live set.
  await rosterPress(page, removeName(2));
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(2);
  await expect(card(page, 2).getByLabel("Registration plate")).toHaveValue("CCC333");

  // Continue, which is the ordinary whole-step POST and its 303. The fixture is one
  // step, so that Continue is also the submit and the 303 lands on the receipt.
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
    // Get the plate HELD by the API first: the retraction half of this case needs a
    // previously answered required field to try to clear.
    //
    // Posted through `craftStepPost` rather than by pressing Continue, and for two
    // reasons that are both the suite working as intended. The fixture is a single step,
    // so a Continue the API ACCEPTS submits the response and ends the session, leaving
    // nothing to press Add on. And a Continue the API would refuse never leaves the page,
    // because the thing that makes it refusable - a blank required `Fleet reference` - is
    // exactly what HTML `required` blocks. So the post omits the fleet reference: the API
    // stores the plate it accepted and refuses the step as incomplete, which is the state
    // this case starts from.
    const [first] = await instanceIds(page);
    await craftStepPost(page, sessionId, { [`${first!}/q_rf_plate`]: "AAA111" });
    // Still on the step, with the plate the API now holds rendered back into its cell.
    // That value coming from the API's own projection is what this setup needed; whether
    // the re-render also draws a summary for the missing fleet reference is
    // `no-js-required.pw.ts`'s subject, not this one's.
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
    await expect(card(page, 1).getByLabel("Registration plate")).toHaveValue("AAA111");
    const beforeRows = await db.instanceAnswerRows(sessionId);
    expect(beforeRows.filter((row) => row.questionId === "q_rf_plate")).toHaveLength(1);

    // Now EMPTY that required field and press Add. Two things must happen, and the
    // second is the one the ruling of 2026-09-30 exists for.
    await card(page, 1).getByLabel("Registration plate").fill("");
    const posts = countStepPosts(page);
    await rosterPress(page, ADD);

    // One: the browser did not refuse the press. `formnovalidate` is what makes it
    // through, and without it a respondent who has not finished vehicle 1 could not
    // reach vehicle 2 and would be told nothing - the dead end issues #920, #18 and
    // #988 each closed once.
    await expect(page.getByRole("heading", { name: "Vehicle 2" })).toBeVisible();
    // It is not the whole-step route either: the Server Action posts to the page.
    expect(posts()).toBe(0);

    // Two: NO answer was written and NO retraction was appended. The ledger holds
    // exactly what it held before, which is what keeps
    // `docs/portal-constraints.md`'s "a required question cannot be CLEARED without
    // scripting" bullet true rather than amended.
    const afterRows = await db.instanceAnswerRows(sessionId);
    expect(afterRows).toEqual(beforeRows);
    expect(afterRows.some((row) => row.retracted)).toBe(false);

    // And the emptied field came back EMPTY: the respondent's own typing is what the
    // 200 carries, not the answer the API still holds.
    await expect(card(page, 1).getByLabel("Registration plate")).toHaveValue("");

    // Three: a replay applies the operation once. The response to the Add is a page, so
    // a reload asks the browser to resubmit it; the one-time operation token recorded
    // with the roster row is what makes the second application a no-op.
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

  // Every Add and Remove control is a `<button name="__qop">`, and nothing else on the
  // page carries that name - no hidden input, which would serialize whether pressed or
  // not. So only the pressed button contributes its pair, by HTML's own rule.
  const named = page.locator('[name="__qop"]');
  await expect(named).toHaveCount(2);
  for (const handle of await named.all()) {
    expect(await handle.evaluate((node) => node.tagName)).toBe("BUTTON");
    await expect(handle).toHaveAttribute("type", "submit");
    await expect(handle).toHaveAttribute("formnovalidate", "");
  }
  expect(await page.locator('input[name="__qop"]').count()).toBe(0);

  // On the wire: press Add and read the body the browser actually sent.
  //
  // Parsed as MULTIPART rather than as a query string, because that is what the browser
  // sends: React renders a form whose action is a function with
  // `enctype="multipart/form-data"`, so a `URLSearchParams` reading of this body finds
  // nothing at all. Each part is `name="<field>"` followed by a blank line and the value,
  // and the assertion below is on the parts named `__qop`.
  const request = page.waitForRequest(
    (candidate) => candidate.method() === "POST" && candidate.isNavigationRequest(),
  );
  await page.getByRole("button", { name: ADD }).click();
  const body = (await request).postData() ?? "";
  const entries = multipartValues(body, "__qop");
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/^add:grp_vehicles:op_[0-9a-f]+$/);

  // An ordinary Continue carries none at all: it posts to the BFF route through the
  // submit control's own `formaction`, and the roster buttons were not the submitter.
  //
  // The required fields are filled first, because Continue carries no `formnovalidate`:
  // with a blank required field the browser refuses the submit and there is no request to
  // read. That refusal is the suite working (`no-js-required.pw.ts` owns it), and here it
  // would read as this assertion passing for the wrong reason.
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
  // Continue posts to the BFF route, which is a plain URL on the submit control, so its
  // body is an ordinary URL-encoded form rather than the action's multipart one. Both
  // readings are tried, so this cannot pass merely because the parser saw nothing.
  const continueBody = (await continueRequest).postData() ?? "";
  expect(postedValues(continueBody, "__qop")).toEqual([]);
  // And the session rides with it, which is both the proof that the body was read at all
  // and the thing the `__qop` action needs: the reserved hidden input posts with EVERY
  // submit of this form, not only with the roster buttons.
  expect(postedValues(continueBody, SESSION_FIELD)).toEqual([sessionId]);
});

test("case 35: a re-render after a refusal shows every accepted answer and every refused value", async ({
  page,
}) => {
  const sessionId = await startNoJsRepeat(page);
  await rosterPress(page, ADD);
  await rosterPress(page, ADD);
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(3);
  const ids = await instanceIds(page);

  // Vehicle 1 and 3 are valid; vehicle 2's plate is two characters, below the question's
  // `minLength: 3`, so the API refuses exactly that cell.
  //
  // Crafted rather than typed, because the BROWSER refuses it first: the renderer emits
  // the question's floor as `minlength`, so a two-character plate never leaves the page.
  // That is the right behaviour and it is asserted below, but the case under test is what
  // the API's refusal RE-RENDERS, which needs the post to reach the API.
  await craftStepPost(page, sessionId, {
    q_rf_fleet_ref: "NORTH-1",
    [`${ids[0]!}/q_rf_plate`]: "AAA111",
    [`${ids[1]!}/q_rf_plate`]: "BB",
    [`${ids[2]!}/q_rf_plate`]: "CCC333",
  });
  await page.goto(`/s/${sessionId}`);

  // The accepted answers are back from the API's own projection.
  await expect(page.getByLabel("Fleet reference")).toHaveValue("NORTH-1");
  await expect(card(page, 1).getByLabel("Registration plate")).toHaveValue("AAA111");
  await expect(card(page, 3).getByLabel("Registration plate")).toHaveValue("CCC333");
  // And the REFUSED one is back in its own field beside its own message. A blank cell
  // next to a message about what the respondent typed is the WCAG 3.3.7 Redundant Entry
  // failure the `{error, constraint, value}` cookie record exists to prevent.
  await expect(card(page, 2).getByLabel("Registration plate")).toHaveValue("BB");
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();
  await expect(summary.getByRole("link", { name: /^Vehicle 2: Registration plate/ })).toBeVisible();

  const db = await openDb(databaseUrl);
  try {
    // Two accepted plates in the ledger and nothing for the refused cell: a 422 stores
    // nothing (ADR-33's rule that an invalid value is never silently converted).
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
  // The other half of case 35, and the reason its refusal has to be crafted: a cell inside
  // a repeating group carries the same native constraints as a question outside one, so the
  // browser stops a short plate before the form leaves the page. A `__qop` press is the
  // exception that proves it, since `formnovalidate` is what lets Add through regardless.
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
  // The other half of ruling Q29 (2026-10-02): a batch the API refuses outright has no
  // refused FIELD to hang a message on, so the step used to re-render unchanged and say
  // nothing. That is the silent reload issue #920 removed from the required-answer path, and
  // a respondent whose Continue was refused by the rate limiter met it every time.
  //
  // Driven by writing the route's own context cookie rather than by provoking a refusal,
  // and both halves of that are deliberate. A refusal is UNREACHABLE from a real form here:
  // the ceiling a batch is measured against is the step's own bound, which is by
  // construction the most a legitimate step can carry, and the browser harness raises every
  // other limiter to a million. So what is left to assert in a browser is the half a browser
  // can see, which is that the shape the route writes reaches the respondent as a visible,
  // announced message with their values intact. That the ROUTE writes it on a 429 is
  // asserted in `lib/server/step-required.test.ts`, where the refusal can be injected.
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
  // Announced, not only painted: the respondent arrived at a freshly rendered page and this
  // is the one thing on it they did not ask for.
  await expect(notice).toHaveAttribute("role", "alert");
  // And the value rides the re-render, which is what the notice is telling them.
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
  // The grouping WAI's forms tutorial asks for: a fieldset per instance whose legend
  // names it, with the same text reachable as a heading. One element does both jobs, so
  // the label is spoken once rather than twice by a screen reader that reads a legend
  // with every control in its group.
  const legend = card(page, 1).locator("legend");
  await expect(legend).toHaveText("Vehicle 1");
  await expect(legend.locator("h4")).toHaveAttribute("tabindex", "-1");
  // The focus handle the 200's `autofocus` lands on, and the id the summary anchors at.
  const instanceId = await card(page, 1).getAttribute("data-qcms-instance");
  await expect(legend.locator("h4")).toHaveAttribute("id", instanceId!);
  // The instance id is never a label a respondent reads (ADR-42).
  await expect(legend).not.toContainText("ins_");
});

test("the 200 lands focus on the new instance by autofocus, never by a fragment", async ({
  page,
}) => {
  await startNoJsRepeat(page);
  await rosterPress(page, ADD);
  const second = await card(page, 2).getAttribute("data-qcms-instance");
  // `autofocus` applies to every element and not only to form controls, and a negative
  // `tabindex` makes the heading a focusable area. It is what lands the no-JS add,
  // because a 200 to a POST leaves the browser on the POST's own URL and that URL
  // carries no fragment. The two must never be combined: a fragment target makes the
  // browser skip `autofocus` outright.
  await expect(card(page, 2).locator("h4")).toHaveAttribute("autofocus", "");
  expect(new URL(page.url()).hash).toBe("");
  // Asserted after a rendering update rather than on load: the first read of a freshly
  // painted document can still report BODY.
  await page.waitForFunction(() => document.activeElement?.tagName !== "BODY");
  await expect(page.locator(":focus")).toHaveAttribute("id", second!);
});
