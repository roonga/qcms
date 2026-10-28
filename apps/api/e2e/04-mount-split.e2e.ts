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
  tokenFromLinkUrl,
  type TestDb,
} from "./support/index.js";

// The public process has no admin group, so nothing verifies this value.
const ADMIN_HEADERS = {
  "content-type": "application/json",
  "x-qcms-admin-session": "any-value-unverified-here",
} as const;

let testDb: TestDb;
let publicApi: ReturnType<typeof composeApi>;
let adminApi: ReturnType<typeof composeApi>;
let admin: AdminClient;
let respondent: RespondentClient;
let formId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  // `buildEnv()` regenerates secrets per call, so both compositions must share one object.
  const env = buildEnv();
  publicApi = composeApi(testDb.db, env, MOUNT.publicOnly);
  adminApi = composeApi(testDb.db, env, MOUNT.adminOnly);
  admin = new AdminClient(adminApi.app, adminApi.internalToken, await adminLogin(testDb.db));
  respondent = new RespondentClient(publicApi.app, publicApi.internalToken);
  ({ formId } = await seedInsuranceForm(testDb.db));
});

afterAll(async () => {
  await testDb?.teardown();
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
      body: JSON.stringify({ formSlug: "auto" }),
    });
    expect(res.status).toBe(404);
  });

  it("admin mints a link, the public process runs the respondent, admin reads it back", async () => {
    const minted = await admin.mintLinks<{ links: { url: string }[] }>(formId, {
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      oneTime: false,
    });
    expect(minted.status).toBe(201);
    const token = tokenFromLinkUrl(minted.body.links[0]!.url);

    const start = await respondent.start<StartBody>({ token });
    expect(start.status).toBe(201);
    const { sessionId, sessionToken } = start.body;
    expect(
      (await respondent.answer<StepBody>(sessionId, sessionToken, "q_at_fault_accident", false))
        .status,
    ).toBe(200);
    expect((await respondent.submit<Receipt>(sessionId, sessionToken)).status).toBe(200);

    const json = await admin.export(formId, { format: "json" });
    expect(json.status).toBe(200);
    const rows = JSON.parse(json.text) as { sessionId: string; accessMode: string }[];
    const row = rows.find((r) => r.sessionId === sessionId);
    expect(row).toBeDefined();
    expect(row?.accessMode).toBe("secure_link");
  });
});
