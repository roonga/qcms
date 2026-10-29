import { FormId, QuestionId } from "@roonga/qcms-core";
import { getDraft, getQuestionVersion } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminLogin, buildEnv, composeApi, MOUNT, type ComposedApi } from "./harness.js";
import { seedInsuranceForm, seedUnpublishedPinForm } from "./seed.js";

/**
 * The route types the payload `unknown`, so this is a view of the bytes rather than a
 * second declaration of the kernel's union.
 */
interface Issue {
  readonly code: string;
  readonly path?: { readonly step?: string; readonly question?: string };
}

let testDb: TestDb;
let api: ComposedApi;
let adminSessionToken: string;

beforeAll(async () => {
  testDb = await startTestDb();
  api = composeApi(testDb.db, buildEnv({ DATABASE_URL: testDb.connectionUri }), MOUNT.all);
  adminSessionToken = await adminLogin(testDb.db);
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

async function validateStoredDraft(formId: string): Promise<{ valid: boolean; issues: Issue[] }> {
  const draft = await getDraft(testDb.db, FormId.parse(formId));
  expect(draft, `form ${formId} has no stored draft to validate`).toBeDefined();
  const res = await api.app.request(`/admin/forms/${formId}/draft/validate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": api.internalToken,
      "x-qcms-admin-session": adminSessionToken,
    },
    body: JSON.stringify({ definition: draft?.definition }),
  });
  expect(res.status, "draft validate should answer 200").toBe(200);
  return (await res.json()) as { valid: boolean; issues: Issue[] };
}

describe("seeded fixtures", () => {
  it("publishes every question version the insurance form pins", async () => {
    await seedInsuranceForm(testDb.db, { formId: "frm_seed_valid", slug: "seed-valid" });
    const pins = [
      { questionId: "q_at_fault_accident", version: 2 },
      { questionId: "q_accident_count", version: 1 },
    ];
    for (const pin of pins) {
      const row = await getQuestionVersion(
        testDb.db,
        QuestionId.parse(pin.questionId),
        pin.version,
      );
      expect(row, `${pin.questionId}@${pin.version} was never created`).toBeDefined();
      expect(row?.status, `${pin.questionId}@${pin.version} is not published`).toBe("published");
      expect(row?.publishedAt).not.toBeNull();
    }
  });

  it("leaves the dedicated fixture with exactly two unpublished pins on stp_history", async () => {
    const { formId } = await seedUnpublishedPinForm(testDb.db);
    const verdict = await validateStoredDraft(formId);

    expect(verdict.valid).toBe(false);
    const unpublished = verdict.issues.filter((issue) => issue.code === "UNPUBLISHED_QUESTION_PIN");
    expect(unpublished).toHaveLength(2);
    // The admin's `stepIssueCounts` reads `path.step`, falling back to the step the named
    // question is pinned in, so both derivations are asserted.
    expect(unpublished.map((issue) => issue.path?.step)).toEqual(["stp_history", "stp_history"]);
    expect(unpublished.map((issue) => issue.path?.question).sort()).toEqual([
      "q_stale_accident",
      "q_stale_accident_count",
    ]);
    expect(verdict.issues).toHaveLength(2);
  });
});
