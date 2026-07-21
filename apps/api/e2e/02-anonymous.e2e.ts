/**
 * Scenario 2 - the anonymous respondent path (task 027, exit criterion 1).
 *
 * The same respondent loop as scenario 1 but with no secure link: an anonymous
 * session started by form slug walks the branch (this time keeping the follow-up
 * answered), submits, and the response surfaces in the admin export tagged
 * `anonymous`. The form is stood up with the shared seed toolkit.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminClient,
  MOUNT,
  RespondentClient,
  type Receipt,
  type StartBody,
  type StepBody,
  buildEnv,
  composeApi,
  seedInsuranceForm,
  startTestDb,
  type TestDb,
} from "./support/index.js";

let testDb: TestDb;
let admin: AdminClient;
let respondent: RespondentClient;
let formId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  const composed = composeApi(testDb.db, buildEnv(), MOUNT.all);
  admin = new AdminClient(composed.app, composed.internalToken);
  respondent = new RespondentClient(composed.app, composed.internalToken);
  ({ formId } = await seedInsuranceForm(testDb.db));
});

afterAll(async () => {
  await testDb.teardown();
});

describe("scenario 2: anonymous respondent", () => {
  it("starts anonymously, walks the branch, submits, and exports as anonymous", async () => {
    const start = await respondent.start<StartBody>({ formSlug: "auto" });
    expect(start.status).toBe(201);
    const { sessionId, sessionToken } = start.body;

    // Reveal the follow-up and answer it (kept in the locked set this time).
    const revealed = await respondent.answer<StepBody>(
      sessionId,
      sessionToken,
      "q_at_fault_accident",
      true,
    );
    expect(revealed.status).toBe(200);
    expect(revealed.body.flowState.visibleQuestions).toContain("q_accident_count");

    const complete = await respondent.answer<StepBody>(
      sessionId,
      sessionToken,
      "q_accident_count",
      12,
    );
    expect(complete.status).toBe(200);
    expect(complete.body.flowState.readyToSubmit).toBe(true);
    expect(complete.body.step).toBeNull();

    const receipt = await respondent.submit<Receipt>(sessionId, sessionToken);
    expect(receipt.status).toBe(200);
    expect(receipt.body.contentHash).toMatch(/^[0-9a-f]{64}$/);

    // The response is in the export, tagged anonymous, with both answers.
    const json = await admin.export(formId, { format: "json" });
    expect(json.status).toBe(200);
    const rows = JSON.parse(json.text) as {
      sessionId: string;
      accessMode: string;
      answers: Record<string, unknown>;
    }[];
    const row = rows.find((r) => r.sessionId === sessionId);
    expect(row).toBeDefined();
    expect(row?.accessMode).toBe("anonymous");
    // The JSON export keys answers by questionId (canonical encodings).
    expect(Object.keys(row?.answers ?? {}).sort()).toEqual([
      "q_accident_count",
      "q_at_fault_accident",
    ]);
  });
});
