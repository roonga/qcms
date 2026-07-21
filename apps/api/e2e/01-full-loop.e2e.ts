/**
 * Scenario 1 - the full loop (task 027, exit criterion 1).
 *
 * One scripted consumer drives the entire product over HTTP against the real
 * Testcontainers database: an admin authors the insurance question library and
 * form, publishes it, wires a webhook, and mints a secure link; a respondent
 * walks the branching flow through that link; the signed webhook arrives at an
 * in-test receiver and verifies; the response exports as CSV and JSON; and an
 * erasure removes it from every export and lists a tombstone.
 *
 * The suite is a *consumer*: it speaks only `app.request()` (via the support
 * clients) and the seed toolkit - no slice internals. This file authors purely
 * over the admin HTTP API (the server compiles the draft at publish time).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AdminClient,
  INSURANCE_DEF,
  INSURANCE_GOLDEN,
  MOUNT,
  NOW,
  Q_ACCIDENT_COUNT_DEF,
  Q_ACCIDENT_DEF,
  RespondentClient,
  WebhookReceiver,
  buildEnv,
  composeApi,
  drainWebhooks,
  startTestDb,
  tokenFromLinkUrl,
  verifyWebhookSignature,
  type TestDb,
} from "./support/index.js";

interface StartBody {
  sessionId: string;
  sessionToken: string;
  formVersion: number;
}
interface StepBody {
  step: { stepId: string; root: unknown } | null;
  a2uiSpecVersion: string;
  flowState: {
    currentStep: string | null;
    visibleQuestions: string[];
    missingRequired: string[];
    readyToSubmit: boolean;
  };
}
interface Receipt {
  submittedAt: string;
  contentHash: string;
}

let testDb: TestDb;
let admin: AdminClient;
let respondent: RespondentClient;
let deps: ReturnType<typeof composeApi>["deps"];
const receiver = new WebhookReceiver();

beforeAll(async () => {
  testDb = await startTestDb();
  await receiver.start();
  const env = buildEnv();
  const composed = composeApi(testDb.db, env, MOUNT.all);
  deps = composed.deps;
  admin = new AdminClient(composed.app, composed.internalToken);
  respondent = new RespondentClient(composed.app, composed.internalToken);
});

afterAll(async () => {
  await receiver.stop();
  await testDb.teardown();
});

const FORM_ID = "frm_auto_quote";
const WEBHOOK_SECRET = "whsec_e2e_full_loop_0123456789";

describe("scenario 1: full loop end to end", () => {
  // Threaded across the ordered steps below.
  let linkUrl: string;
  let sessionId: string;
  let sessionToken: string;
  let contentHash: string;

  it("authors the question library over the admin API and publishes it", async () => {
    // q_at_fault_accident: create v1, publish it, add v2 (the form pins @2), publish v2.
    const created = await admin.createQuestion<{
      questionId: string;
      version: { version: number };
    }>({
      slug: "accident",
      definition: Q_ACCIDENT_DEF,
    });
    expect(created.status).toBe(201);
    expect(created.body.questionId).toBe("q_at_fault_accident");
    expect(created.body.version.version).toBe(1);

    expect((await admin.publishQuestionVersion("q_at_fault_accident", 1)).status).toBe(200);
    const v2 = await admin.addQuestionVersion<{ version: number }>("q_at_fault_accident");
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect((await admin.publishQuestionVersion("q_at_fault_accident", 2)).status).toBe(200);

    // q_accident_count: create v1, publish it (the form pins @1).
    const count = await admin.createQuestion<{ questionId: string }>({
      slug: "accident-count",
      definition: Q_ACCIDENT_COUNT_DEF,
    });
    expect(count.status).toBe(201);
    expect(count.body.questionId).toBe("q_accident_count");
    expect((await admin.publishQuestionVersion("q_accident_count", 1)).status).toBe(200);
  });

  it("creates the form, drafts it with the branch rule, and publishes (server compiles)", async () => {
    expect(
      (await admin.createForm({ formId: FORM_ID, slug: "auto", defaultLocale: "en" })).status,
    ).toBe(201);

    const draft = await admin.saveDraft<{ issues: unknown[] }>(FORM_ID, INSURANCE_DEF);
    expect(draft.status).toBe(200);
    // A valid draft with published pins has no advisory issues.
    expect(draft.body.issues).toEqual([]);

    const published = await admin.publishForm<{ version: number }>(FORM_ID);
    expect(published.status).toBe(200);
    expect(published.body.version).toBe(1);
  });

  it("configures a webhook (secret shown once) and mints a secure link", async () => {
    const hook = await admin.createWebhook<{ webhookId: string; secret: string }>(FORM_ID, {
      url: receiver.url("/hook"),
      secret: WEBHOOK_SECRET,
    });
    expect(hook.status).toBe(201);
    expect(hook.body.secret).toBe(WEBHOOK_SECRET);

    const minted = await admin.mintLinks<{ links: { url: string }[] }>(FORM_ID, {
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
      oneTime: false,
      count: 1,
    });
    expect(minted.status).toBe(201);
    expect(minted.body.links).toHaveLength(1);
    linkUrl = minted.body.links[0]!.url;
  });

  it("walks the branching flow through the link: branch appears then disappears", async () => {
    const start = await respondent.start<StartBody>({ token: tokenFromLinkUrl(linkUrl) });
    expect(start.status).toBe(201);
    expect(start.body.formVersion).toBe(1);
    sessionId = start.body.sessionId;
    sessionToken = start.body.sessionToken;

    // First step: only q_at_fault_accident is visible (the follow-up's rule is unsatisfied).
    const step0 = await respondent.getStep<StepBody>(sessionId, sessionToken);
    expect(step0.status).toBe(200);
    expect(step0.body.step?.stepId).toBe("stp_history");
    expect(step0.body.step?.root).toBeDefined();
    expect(step0.body.a2uiSpecVersion).toBe(INSURANCE_GOLDEN.a2uiSpecVersion);
    expect(step0.body.flowState.visibleQuestions).toEqual(["q_at_fault_accident"]);

    // q_at_fault_accident = true → the q_accident_count branch appears.
    const revealed = await respondent.answer<StepBody>(
      sessionId,
      sessionToken,
      "q_at_fault_accident",
      true,
    );
    expect(revealed.status).toBe(200);
    expect(revealed.body.flowState.visibleQuestions).toContain("q_accident_count");
    expect(revealed.body.flowState.readyToSubmit).toBe(false);

    // q_at_fault_accident = false → the branch disappears and the flow is complete.
    const hidden = await respondent.answer<StepBody>(
      sessionId,
      sessionToken,
      "q_at_fault_accident",
      false,
    );
    expect(hidden.status).toBe(200);
    expect(hidden.body.flowState.visibleQuestions).not.toContain("q_accident_count");
    expect(hidden.body.flowState.readyToSubmit).toBe(true);
    expect(hidden.body.step).toBeNull();
  });

  it("submits the response", async () => {
    const receipt = await respondent.submit<Receipt>(sessionId, sessionToken);
    expect(receipt.status).toBe(200);
    expect(receipt.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    contentHash = receipt.body.contentHash;
  });

  it("delivers a signed webhook the documented recipe verifies", async () => {
    const metrics = await drainWebhooks(deps);
    expect(metrics.materialized).toBe(1);
    expect(metrics.delivered).toBe(1);

    const hits = receiver.received.filter((r) => r.path === "/hook");
    expect(hits).toHaveLength(1);
    const req = hits[0]!;

    expect(req.header("x-qcms-event")).toBe("response.submitted");
    const timestamp = req.header("x-qcms-timestamp")!;
    const signature = req.header("x-qcms-signature")!;
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(WEBHOOK_SECRET, timestamp, req.body, signature)).toBe(true);
    // A tampered body must not verify.
    expect(verifyWebhookSignature(WEBHOOK_SECRET, timestamp, req.body + "x", signature)).toBe(
      false,
    );

    const envelope = JSON.parse(req.body) as {
      eventType: string;
      payload: { formId: string; contentHash: string; answers: { questionId: string }[] };
    };
    expect(envelope.eventType).toBe("response.submitted");
    expect(envelope.payload.formId).toBe(FORM_ID);
    expect(envelope.payload.contentHash).toBe(contentHash);
    // Only the visible q_at_fault_accident is locked (hidden q_accident_count excluded, I6).
    expect(envelope.payload.answers.map((a) => a.questionId)).toEqual(["q_at_fault_accident"]);
  });

  it("exports the response as CSV and JSON", async () => {
    const csv = await admin.export(FORM_ID, { format: "csv", version: "1" });
    expect(csv.status).toBe(200);
    expect(csv.contentType).toContain("text/csv");
    expect(csv.contentDisposition).toContain("attachment");
    expect(csv.text).toContain("q_at_fault_accident");
    expect(csv.text).toContain(sessionId);

    const json = await admin.export(FORM_ID, { format: "json" });
    expect(json.status).toBe(200);
    expect(json.contentType).toContain("application/json");
    const rows = JSON.parse(json.text) as { sessionId: string }[];
    expect(rows.map((r) => r.sessionId)).toContain(sessionId);
  });

  it("erases the session: exports drop it and a tombstone is listed", async () => {
    const erased = await admin.eraseSession<{ alreadyErased: boolean }>(sessionId, "e2e erasure");
    expect(erased.status).toBe(200);
    expect(erased.body.alreadyErased).toBe(false);

    // No longer in either export.
    const csv = await admin.export(FORM_ID, { format: "csv", version: "1" });
    expect(csv.text).not.toContain(sessionId);
    const json = await admin.export(FORM_ID, { format: "json" });
    const rows = JSON.parse(json.text) as { sessionId: string }[];
    expect(rows.map((r) => r.sessionId)).not.toContain(sessionId);

    // …but a tombstone records the erasure.
    const tombstones = await admin.listTombstones<{ erasures: { sessionId: string }[] }>({
      formId: FORM_ID,
    });
    expect(tombstones.body.erasures.map((t) => t.sessionId)).toContain(sessionId);
  });
});
