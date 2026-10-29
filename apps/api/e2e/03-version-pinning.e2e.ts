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
  publishInsuranceVersion,
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

describe("scenario 3: version pinning", () => {
  it("a session started on v1 completes on v1 after v2 publishes; a new session gets v2", async () => {
    const first = await respondent.start<StartBody>({ formSlug: "auto" });
    expect(first.status).toBe(201);
    expect(first.body.formVersion).toBe(1);
    const s1 = { id: first.body.sessionId, token: first.body.sessionToken };

    await publishInsuranceVersion(testDb.db, formId);

    const step = await respondent.getStep<StepBody>(s1.id, s1.token);
    expect(step.status).toBe(200);
    expect(
      (await respondent.answer<StepBody>(s1.id, s1.token, "q_at_fault_accident", false)).status,
    ).toBe(200);
    expect((await respondent.submit<Receipt>(s1.id, s1.token)).status).toBe(200);

    const second = await respondent.start<StartBody>({ formSlug: "auto" });
    expect(second.status).toBe(201);
    expect(second.body.formVersion).toBe(2);

    const json = await admin.export(formId, { format: "json" });
    const rows = JSON.parse(json.text) as { sessionId: string; formVersion: number }[];
    expect(rows.find((r) => r.sessionId === s1.id)?.formVersion).toBe(1);
  });
});
