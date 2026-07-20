/**
 * Scenario 3 - version pinning across a publish (task 027, exit criterion 1; I4).
 *
 * A session pins the form version it started on and never migrates: it completes
 * on v1 even after v2 is published mid-flight, while a session started *after*
 * the publish binds to v2. The pin is proven end to end - the old session still
 * submits, and the admin export records it at v1 while the new session reports v2.
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
  admin = new AdminClient(composed.app, composed.internalToken);
  respondent = new RespondentClient(composed.app, composed.internalToken);
  ({ formId } = await seedInsuranceForm(testDb.db)); // publishes v1
});

afterAll(async () => {
  await testDb.teardown();
});

describe("scenario 3: version pinning", () => {
  it("a session started on v1 completes on v1 after v2 publishes; a new session gets v2", async () => {
    // Start a session while only v1 exists.
    const first = await respondent.start<StartBody>({ formSlug: "life" });
    expect(first.status).toBe(201);
    expect(first.body.formVersion).toBe(1);
    const s1 = { id: first.body.sessionId, token: first.body.sessionToken };

    // Publish v2 mid-flight.
    await publishInsuranceVersion(testDb.db, formId);

    // The in-flight session still serves and completes on its pinned v1.
    const step = await respondent.getStep<StepBody>(s1.id, s1.token);
    expect(step.status).toBe(200);
    expect((await respondent.answer<StepBody>(s1.id, s1.token, "q_smoker", false)).status).toBe(
      200,
    );
    expect((await respondent.submit<Receipt>(s1.id, s1.token)).status).toBe(200);

    // A session started now binds to v2 (newest published).
    const second = await respondent.start<StartBody>({ formSlug: "life" });
    expect(second.status).toBe(201);
    expect(second.body.formVersion).toBe(2);

    // The export confirms the completed first session is recorded at v1.
    const json = await admin.export(formId, { format: "json" });
    const rows = JSON.parse(json.text) as { sessionId: string; formVersion: number }[];
    expect(rows.find((r) => r.sessionId === s1.id)?.formVersion).toBe(1);
  });
});
