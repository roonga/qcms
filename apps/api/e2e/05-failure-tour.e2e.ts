import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminLogin,
  AdminClient,
  MOUNT,
  NOW,
  RespondentClient,
  type ErrBody,
  type Receipt,
  type StartBody,
  type StepBody,
  buildEnv,
  composeApi,
  mintInsuranceLink,
  seedInsuranceForm,
  startTestDb,
  tokenFromLinkUrl,
  type TestDb,
} from "./support/index.js";

let testDb: TestDb;
let composed: ReturnType<typeof composeApi>;
let admin: AdminClient;
let respondent: RespondentClient;
let formId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  composed = composeApi(testDb.db, buildEnv(), MOUNT.all);
  admin = new AdminClient(composed.app, composed.internalToken, await adminLogin(testDb.db));
  respondent = new RespondentClient(composed.app, composed.internalToken);
  ({ formId } = await seedInsuranceForm(testDb.db));
});

afterAll(async () => {
  await testDb?.teardown();
});

function shortText(id: string, label: string): Record<string, unknown> {
  return { questionId: id, type: "shortText", label: { en: label } };
}

describe("scenario 5: failure tour (typed codes through the envelope)", () => {
  it("publish with a backward rule target → 422 PUBLISH_REJECTED", async () => {
    // A rule that reads a later question and shows an earlier one is a backward target (ADR-16).
    for (const [id, label] of [
      ["q_bw_a", "A"],
      ["q_bw_b", "B"],
    ] as const) {
      expect(
        (
          await admin.createQuestion({
            slug: id.replace(/_/g, "-"),
            definition: shortText(id, label),
          })
        ).status,
      ).toBe(201);
      expect((await admin.publishQuestionVersion(id, 1)).status).toBe(200);
    }

    expect(
      (await admin.createForm({ formId: "frm_bw", slug: "bw", defaultLocale: "en" })).status,
    ).toBe(201);
    const backwardDef = {
      formId: "frm_bw",
      defaultLocale: "en",
      title: { en: "Backward" },
      steps: [
        { stepId: "stp_one", title: { en: "one" }, items: [{ questionId: "q_bw_a", version: 1 }] },
        { stepId: "stp_two", title: { en: "two" }, items: [{ questionId: "q_bw_b", version: 1 }] },
      ],
      rules: [
        { ruleId: "rul_back", when: { op: "answered", questionId: "q_bw_b" }, show: ["q_bw_a"] },
      ],
    };
    expect((await admin.saveDraft("frm_bw", backwardDef)).status).toBe(200);

    const rejected = await admin.publishForm<ErrBody>("frm_bw");
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe("PUBLISH_REJECTED");
  });

  it("an out-of-range answer → 422 INVALID_ANSWER", async () => {
    const start = await respondent.start<StartBody>({ formSlug: "auto" });
    const { sessionId, sessionToken } = start.body;
    expect(
      (await respondent.answer<StepBody>(sessionId, sessionToken, "q_at_fault_accident", true))
        .status,
    ).toBe(200);
    const bad = await respondent.answer<ErrBody>(sessionId, sessionToken, "q_accident_count", -1);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("INVALID_ANSWER");
  });

  it("an expired link → 403 LINK_EXPIRED", async () => {
    // Expiry is measured against the app's fixed clock (NOW), not host time.
    const token = await mintInsuranceLink(testDb.db, composed.deps.config, formId, {
      linkId: "lnk_expired_e2e",
      expiresAt: new Date(NOW.getTime() - 60_000),
    });
    const res = await respondent.start<ErrBody>({ token });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("LINK_EXPIRED");
  });

  it("a valid link into a closed form → 409 FORM_CLOSED", async () => {
    // A second form, so the tour's own form stays open.
    const closed = await seedInsuranceForm(testDb.db, {
      formId: "frm_closed_e2e",
      slug: "closed-e2e",
      sharedQuestionsSeeded: true,
      closed: true,
    });
    const token = await mintInsuranceLink(testDb.db, composed.deps.config, closed.formId, {
      linkId: "lnk_closed_e2e",
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    });

    const res = await respondent.start<ErrBody>({ token });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("FORM_CLOSED");
  });

  it("a consumed one-time link → 409 LINK_CONSUMED", async () => {
    const minted = await admin.mintLinks<{ links: { url: string }[] }>(formId, {
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      oneTime: true,
    });
    const token = tokenFromLinkUrl(minted.body.links[0]!.url);

    expect((await respondent.start<StartBody>({ token })).status).toBe(201);
    const second = await respondent.start<ErrBody>({ token });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("LINK_CONSUMED");
  });

  it("answering an already-submitted session → 409 SESSION_SUBMITTED", async () => {
    const start = await respondent.start<StartBody>({ formSlug: "auto" });
    const { sessionId, sessionToken } = start.body;
    expect(
      (await respondent.answer<StepBody>(sessionId, sessionToken, "q_at_fault_accident", false))
        .status,
    ).toBe(200);
    expect((await respondent.submit<Receipt>(sessionId, sessionToken)).status).toBe(200);

    const late = await respondent.answer<ErrBody>(
      sessionId,
      sessionToken,
      "q_at_fault_accident",
      true,
    );
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("SESSION_SUBMITTED");
  });
});
