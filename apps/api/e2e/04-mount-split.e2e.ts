/**
 * Scenario 4 - the split enterprise topology (task 027, exit criterion 1).
 *
 * Two separate compositions over **one** database and **one** environment prove
 * the deployment shape from ARCHITECTURE §5.1: a public-only respondent process
 * (admin routes simply do not exist - 404, not 403, per ADR-09) and a separate
 * internal/admin authoring process. The admin process mints a link and reads the
 * response back; the public process runs the respondent through that link. It
 * only works because both share the DB (data is visible across processes) and
 * the env (the link and internal tokens minted by one verify in the other).
 *
 * The single `buildEnv()` call is load-bearing: `validEnv()` regenerates secrets
 * per call, so two compositions that must share tokens have to be built from the
 * same env object.
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
  tokenFromLinkUrl,
  type TestDb,
} from "./support/index.js";

const ADMIN_HEADERS = {
  "content-type": "application/json",
  "x-qcms-admin-session": "e2e-admin",
} as const;

let testDb: TestDb;
let publicApi: ReturnType<typeof composeApi>;
let adminApi: ReturnType<typeof composeApi>;
let admin: AdminClient;
let respondent: RespondentClient;
let formId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  // ONE env, shared by both compositions, so their tokens match.
  const env = buildEnv();
  publicApi = composeApi(testDb.db, env, MOUNT.publicOnly);
  adminApi = composeApi(testDb.db, env, MOUNT.adminOnly);
  admin = new AdminClient(adminApi.app, adminApi.internalToken);
  respondent = new RespondentClient(publicApi.app, publicApi.internalToken);
  ({ formId } = await seedInsuranceForm(testDb.db));
});

afterAll(async () => {
  await testDb.teardown();
});

describe("scenario 4: public-only + admin-only over one db/env", () => {
  it("admin routes do not exist on the public process (404, not 403)", async () => {
    const res = await publicApi.app.request("/admin/forms", {
      headers: { "x-qcms-internal-token": publicApi.internalToken, ...ADMIN_HEADERS },
    });
    expect(res.status).toBe(404);
  });

  it("respondent routes do not exist on the admin process (404)", async () => {
    const res = await adminApi.app.request("/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": adminApi.internalToken,
      },
      body: JSON.stringify({ formSlug: "life" }),
    });
    expect(res.status).toBe(404);
  });

  it("admin mints a link, the public process runs the respondent, admin reads it back", async () => {
    // Authoring surface: mint a secure link (proves the admin composition works).
    const minted = await admin.mintLinks<{ links: { url: string }[] }>(formId, {
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      oneTime: false,
    });
    expect(minted.status).toBe(201);
    const token = tokenFromLinkUrl(minted.body.links[0]!.url);

    // Respondent surface (separate process): the link - signed with the shared
    // env's link key - verifies here.
    const start = await respondent.start<StartBody>({ token });
    expect(start.status).toBe(201);
    const { sessionId, sessionToken } = start.body;
    expect(
      (await respondent.answer<StepBody>(sessionId, sessionToken, "q_smoker", false)).status,
    ).toBe(200);
    expect((await respondent.submit<Receipt>(sessionId, sessionToken)).status).toBe(200);

    // Back on the admin process: the submission written by the public process is
    // visible - the two compositions share the database.
    const json = await admin.export(formId, { format: "json" });
    expect(json.status).toBe(200);
    const rows = JSON.parse(json.text) as { sessionId: string; accessMode: string }[];
    const row = rows.find((r) => r.sessionId === sessionId);
    expect(row).toBeDefined();
    expect(row?.accessMode).toBe("secure_link");
  });
});
