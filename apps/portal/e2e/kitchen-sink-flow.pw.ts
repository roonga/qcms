/**
 * Full-stack kitchen-sink flow (task 045, ADR-28). Drives every one of the seven
 * question types across three steps via explicit Continue/Back navigation, submits
 * from the final step, and then opens its OWN Postgres connection to verify what
 * was persisted - independently of the API's response echo (exit criterion 4).
 *
 * The exit criteria this spec proves:
 * - 1: start -> through every step via Continue -> Submit -> completion receipt.
 * - M (multi-choice): selecting 2+ options keeps them all (the step never
 *      collapses on answer).
 * - G (Back): Back from step k returns to k-1 with the prior answers shown.
 * - N (final Submit): completes without regressing to an earlier step.
 * - 4: independent DB verification - canonical stored answers per type,
 *      append-only ledger (a Back-and-change adds a row), and the submission lock.
 *
 * It runs at three viewports (phone / tablet / desktop) via the config projects,
 * and inherits the browser + server error gates from `support/gates.ts`.
 */

import { test, expect } from "./support/gates.js";

import { openDb } from "./support/db.js";
import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  answerNumber,
  backStep,
  chooseRadio,
  chooseSingleChoice,
  checkOption,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

test("kitchen-sink: every type via Continue/Back, Submit, and independent DB verification", async ({
  page,
}) => {
  const { kitchenSinkSlug, databaseUrl } = readFixtures();

  await startKitchenSink(page, kitchenSinkSlug);
  const sessionId = new URL(page.url()).pathname.split("/")[2] ?? "";
  expect(sessionId).toMatch(/^ses_/);

  // --- Step 1: About you (short text + date) --------------------------------
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  // Back is hidden on the first step (042 wireframe).
  await expect(page.getByTestId("back-action")).toHaveCount(0);
  await expect(page.getByTestId("primary-action")).toHaveText("Continue");

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990"); // 1990-05-17 (en-US MM/DD/YYYY)
  await continueStep(page);

  // --- Step 2: Driving history (boolean + number + multi-choice + long text) -
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await expect(page.getByTestId("back-action")).toBeVisible();

  await chooseRadio(page, "Yes"); // reveals q_accident_count
  await expect(page.getByText("How many?")).toBeVisible();
  await answerNumber(page, "10");

  // Multi-choice: select two options; both must stay selected (guards M - the
  // step must not collapse or advance when the first selection satisfies required).
  await checkOption(page, "Breakdown");
  await checkOption(page, "Windscreen");
  await expect(page.getByRole("checkbox", { name: "Breakdown", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Windscreen", exact: true })).toBeChecked();

  // The multi-choice branch revealed the optional long-text follow-up.
  await fillText(page, KS.extraDetail, "No claims in 5 years");

  // --- Back to step 1 shows prior answers, and a change appends (guards G) ----
  await backStep(page);
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: KS.fullName })).toHaveValue("Ada Lovelace");
  // Change the name: an append-only new answer (ADR-17), verified in the DB below.
  await fillText(page, KS.fullName, "Grace Hopper");
  await continueStep(page);

  // Back on step 2, the earlier answers are still present (server-stored + cursor).
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Windscreen", exact: true })).toBeChecked();
  await continueStep(page);

  // --- Step 3: Your cover (single choice) -> Submit --------------------------
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await chooseSingleChoice(page, "Standard");

  await page.getByTestId("primary-action").click();
  // Final Submit completes without regressing to an earlier step (guards N).
  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/);

  // --- Independent DB verification (exit criterion 4) ------------------------
  const db = await openDb(databaseUrl);
  try {
    // (a) Canonical stored answers, per type, WITHOUT trusting the API echo.
    const latest = await db.latestAnswers(sessionId);
    expect(latest.get("q_full_name")).toBe("Grace Hopper"); // the changed value wins
    expect(latest.get("q_dob")).toBe("1990-05-17");
    expect(latest.get("q_at_fault_accident")).toBe(true);
    expect(latest.get("q_accident_count")).toBe(10);
    expect(latest.get("q_optional_cover")).toEqual(["opt_breakdown", "opt_windscreen"]);
    expect(latest.get("q_extra_detail")).toBe("No claims in 5 years");
    expect(latest.get("q_coverage_level")).toBe("opt_standard");

    // (b) Append-only: changing an answer adds a row, never updates in place.
    // The primary proof is q_full_name: answered "Ada Lovelace", then changed to
    // "Grace Hopper" via Back - two rows, in order, never a mutation.
    const nameRows = (await db.answerRows(sessionId)).filter((r) => r.questionId === "q_full_name");
    expect(nameRows.map((r) => r.value)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(await db.answerCount(sessionId, "q_full_name")).toBe(2);
    // The multi-choice was appended at least twice (Breakdown, then +Windscreen).
    // It may be >2: a discrete control posts on change AND again on blur, and each
    // post is an append (never a mutation) - which is exactly the property here.
    expect(await db.answerCount(sessionId, "q_optional_cover")).toBeGreaterThanOrEqual(2);

    // (c) The submission is locked with submittedAt + a 64-hex contentHash.
    const submission = await db.submission(sessionId);
    expect(submission).not.toBeNull();
    expect(submission?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(submission?.submittedAt).toBeTruthy();
  } finally {
    await db.close();
  }
});
