import { FormId, QuestionId } from "@qcms/core";
import { getDraft, getQuestionVersion } from "@qcms/db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminLogin, buildEnv, composeApi, MOUNT, type ComposedApi } from "./harness.js";
import { seedInsuranceForm, seedUnpublishedPinForm } from "./seed.js";

/**
 * What the seeded fixtures ARE, asserted where it is cheap to assert (issue #275).
 *
 * The seed's validity used to be a property nothing checked, and it drifted twice in
 * opposite directions on one day. First `seedQuestionVersion` documented itself as
 * creating a published version and never published one, so every question pin in the
 * shared insurance fixture was a draft while the comment said otherwise. Then correcting
 * that broke `apps/admin/e2e/validation-idle.pw.ts`, which had been *relying* on those two
 * accidental issues as its invalid fixture - a dependency visible only in the Playwright
 * suite, which `pnpm verify` does not run.
 *
 * Both directions are pinned here, in the cheapest suite that can see them:
 *
 * - The shared fixture is **valid**: every version its form definition pins is published,
 *   so it is usable for the admin-side paths its doc comment advertises.
 * - The dedicated fixture is **invalid, on purpose**, with exactly two
 *   `UNPUBLISHED_QUESTION_PIN` issues on `stp_history`. That count is what the 625 spec
 *   reads off the rail badge, so a change that quietly makes the fixture clean fails here
 *   in seconds instead of in a browser run somebody may not have reached yet.
 *
 * The second one is driven through the real `POST /admin/forms/:id/draft/validate` rather
 * than through the kernel: the number the browser spec reads is the number that endpoint
 * returns, and a check one layer inside it could agree with the kernel while disagreeing
 * with the screen.
 */

/**
 * One dry-run issue. The route types the payload `unknown`, so this is a view of the
 * bytes rather than a second declaration of the kernel's union - the same stance
 * `apps/admin/lib/forms/types.ts` takes over the same payload.
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

/** The dry-run verdict for a form's stored draft, over the real admin route. */
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
    // Read straight off the library rather than through a form: the pins are
    // q_at_fault_accident@2 and q_accident_count@1, and a form version may only pin a
    // PUBLISHED question version.
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
    // The 625 spec's fixture, which brings two library questions of its own and pins the
    // single, never-published version of each.
    const { formId } = await seedUnpublishedPinForm(testDb.db);
    const verdict = await validateStoredDraft(formId);

    expect(verdict.valid).toBe(false);
    const unpublished = verdict.issues.filter((issue) => issue.code === "UNPUBLISHED_QUESTION_PIN");
    expect(unpublished).toHaveLength(2);
    // Attributed to the step, which is how the rail badge gets its number: the admin's
    // `stepIssueCounts` reads `path.step`, falling back to the step the named question is
    // pinned in. Both are asserted, so either derivation lands on `stp_history`.
    expect(unpublished.map((issue) => issue.path?.step)).toEqual(["stp_history", "stp_history"]);
    expect(unpublished.map((issue) => issue.path?.question).sort()).toEqual([
      "q_stale_accident",
      "q_stale_accident_count",
    ]);
    // And nothing else, so the count the rail badges is the count this fixture is about.
    expect(verdict.issues).toHaveLength(2);
  });
});
