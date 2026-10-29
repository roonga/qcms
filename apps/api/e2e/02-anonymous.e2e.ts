import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminLogin,
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
  admin = new AdminClient(composed.app, composed.internalToken, await adminLogin(testDb.db));
  respondent = new RespondentClient(composed.app, composed.internalToken);
  ({ formId } = await seedInsuranceForm(testDb.db));
});

afterAll(async () => {
  await testDb?.teardown();
});

describe("scenario 2: anonymous respondent", () => {
  it("starts anonymously, walks the branch, submits, and exports as anonymous", async () => {
    const start = await respondent.start<StartBody>({ formSlug: "auto" });
    expect(start.status).toBe(201);
    const { sessionId, sessionToken } = start.body;

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
    expect(Object.keys(row?.answers ?? {}).sort()).toEqual([
      "q_accident_count",
      "q_at_fault_accident",
    ]);
  });
});
