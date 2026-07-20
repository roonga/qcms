/**
 * Scenario 5 — the failure tour (task 027, exit criterion 1).
 *
 * Every guard surfaces a *typed* code through the shared error envelope, end to
 * end over HTTP: a publish with a backward rule (422 PUBLISH_REJECTED), an
 * out-of-range answer (422 INVALID_ANSWER), an expired link (403 LINK_EXPIRED), a
 * consumed one-time link (409 LINK_CONSUMED), and an answer to an
 * already-submitted session (409 SESSION_SUBMITTED). The suite proves the API
 * fails in the contracted, machine-readable way — not just that it fails.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
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
  admin = new AdminClient(composed.app, composed.internalToken);
  respondent = new RespondentClient(composed.app, composed.internalToken);
  ({ formId } = await seedInsuranceForm(testDb.db));
});

afterAll(async () => {
  await testDb.teardown();
});

function shortText(id: string, label: string): Record<string, unknown> {
  return { questionId: id, type: "shortText", label: { en: label } };
}

describe("scenario 5: failure tour (typed codes through the envelope)", () => {
  it("publish with a backward rule target → 422 PUBLISH_REJECTED", async () => {
    // Two published questions; a rule that reads a later question and shows an
    // earlier one is a backward target (ADR-16) — valid to draft, rejected to publish.
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
    const start = await respondent.start<StartBody>({ formSlug: "life" });
    const { sessionId, sessionToken } = start.body;
    // Reveal q_cigs_daily, then answer below its min (0).
    expect(
      (await respondent.answer<StepBody>(sessionId, sessionToken, "q_smoker", true)).status,
    ).toBe(200);
    const bad = await respondent.answer<ErrBody>(sessionId, sessionToken, "q_cigs_daily", -1);
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

  it("a consumed one-time link → 409 LINK_CONSUMED", async () => {
    const minted = await admin.mintLinks<{ links: { url: string }[] }>(formId, {
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      oneTime: true,
    });
    const token = tokenFromLinkUrl(minted.body.links[0]!.url);

    // First start consumes the one-time link.
    expect((await respondent.start<StartBody>({ token })).status).toBe(201);
    // Second start on the same link is rejected.
    const second = await respondent.start<ErrBody>({ token });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("LINK_CONSUMED");
  });

  it("answering an already-submitted session → 409 SESSION_SUBMITTED", async () => {
    const start = await respondent.start<StartBody>({ formSlug: "life" });
    const { sessionId, sessionToken } = start.body;
    expect(
      (await respondent.answer<StepBody>(sessionId, sessionToken, "q_smoker", false)).status,
    ).toBe(200);
    expect((await respondent.submit<Receipt>(sessionId, sessionToken)).status).toBe(200);

    const late = await respondent.answer<ErrBody>(sessionId, sessionToken, "q_smoker", true);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("SESSION_SUBMITTED");
  });
});
