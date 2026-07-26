/**
 * Answer retraction end to end (issue #95, ADR-33): the reproduction from the
 * issue must no longer reproduce.
 *
 * A respondent answers a required date, then clears it. Before this fix the
 * server never learned about the clear (react-aria reports no value change when
 * a complete date becomes incomplete, and the API had no retraction path at all),
 * so it honored the stale stored answer and **Continue advanced**. Now the clear
 * is observed at the commit moment, posted as a null retraction, and appended to
 * the ledger as a tombstone: the question is unanswered again, Continue is
 * blocked, and the error summary names the field.
 *
 * The final assertions open their OWN Postgres connection, so the read model and
 * the audit ledger are verified independently of the API's response echo: the
 * retracted question is gone from the current answers while every row, including
 * the retraction, is still in the ledger (nothing is mutated or deleted, R3 /
 * ADR-17).
 */

import { test, expect } from "./support/gates.js";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import { KS, clearDate, enterDate, fillText, startKitchenSink } from "./support/kitchen-sink.js";

test("clearing an answered required date retracts it and Continue no longer advances", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = new URL(page.url()).pathname.split("/")[2] ?? "";
  expect(sessionId).toMatch(/^ses_/);
  // Not decoration: these two waits are what lets the first interaction land on a
  // HYDRATED page. Filling and blurring a control before hydration fires no React
  // handler, so the answer post never happens and the spec times out waiting for
  // it (the same preamble the kitchen-sink flow spec carries).
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");

  // Satisfy step 1: both required questions answered, so Continue WOULD advance.
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");

  // Now clear the date. This is the issue's reproduction.
  await clearDate(page);

  // Continue must NOT advance: the required date is unanswered again, so the
  // error summary appears and step 1 stays on screen.
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Driving history" })).toHaveCount(0);
  // The summary names the cleared question, not the answered one.
  await expect(page.getByTestId("error-summary")).toContainText(KS.dob);
  await expect(page.getByTestId("error-summary")).not.toContainText(KS.fullName);
  // The control shows empty, matching what the server now holds.
  await expect(
    page.getByRole("group", { name: KS.dob }).getByRole("spinbutton", { name: /month/i }),
  ).toHaveText(/mm/i);

  // Re-answering restores the flow: the tombstone is a revision, not a lock.
  await enterDate(page, "05171990");
  await page.getByTestId("primary-action").click();
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  // --- Independent DB verification -------------------------------------------
  const db = await openDb(databaseUrl);
  try {
    // Current answers: the re-answer wins, and the untouched question is intact.
    const latest = await db.latestAnswers(sessionId);
    expect(latest.get("q_dob")).toBe("1990-05-17");
    expect(latest.get("q_full_name")).toBe("Ada Lovelace");

    // The ledger keeps the whole story, retraction included and unmistakable.
    const dobRows = (await db.answerRows(sessionId)).filter((r) => r.questionId === "q_dob");
    expect(dobRows.map((r) => [r.value, r.retracted])).toEqual([
      ["1990-05-17", false],
      [null, true],
      ["1990-05-17", false],
    ]);
  } finally {
    await db.close();
  }
});
