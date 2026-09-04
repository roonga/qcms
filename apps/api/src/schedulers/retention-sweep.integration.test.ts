/**
 * Live-DB integration (task 017, exit criterion 5 second half + criterion 1
 * happy path). Boots the 013 Testcontainers harness and proves:
 *
 * - the retention-sweep scheduler, on a short interval, actually expires an
 *   abandoned session in the real database; and
 * - `/ready` returns 200 against a reachable database.
 *
 * Requires Docker (like every `*.integration.test.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId, SessionId, type FormDefinition } from "@roonga/qcms-core";
import {
  createForm,
  createSession,
  enqueue,
  getSession,
  insertDelivery,
  insertFormVersion,
  insertWebhook,
  listRecentDeliveries,
  markDelivered,
  markDeliveryDelivered,
  recordDeliveryFailure,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";

import { createApp } from "../app.js";
import { systemClock } from "../clock.js";
import { loadConfig, type Config } from "../config.js";
import { createRetentionSweepScheduler } from "./retention-sweep.js";
import { makeDeps, validEnv } from "../test-support.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

/** Seed a form + one published version so a session has valid FKs. */
async function seedForm(id: string): Promise<{ formId: FormId; version: number }> {
  const formId = FormId.parse(id);
  await createForm(testDb.db, { formId, slug: `${id}-slug`, defaultLocale: "en" });
  const v = await insertFormVersion(testDb.db, {
    formId,
    // Empty def/compiled: the sweep only reads session status/expiry, never form
    // content. Cast the whole input so the test needn't import @roonga/qcms-a2ui-compiler.
    definition: {} as unknown as FormDefinition,
    compiled: {},
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  } as unknown as Parameters<typeof insertFormVersion>[1]);
  return { formId, version: v.version };
}

/** Build a config whose retention sweep runs on a short test interval. */
function shortIntervalConfig(intervalMs: number, ttl: Partial<Config["ttl"]> = {}): Config {
  const base = loadConfig(validEnv());
  return {
    ...base,
    scheduler: { ...base.scheduler, retentionSweepIntervalMs: intervalMs },
    ttl: { ...base.ttl, ...ttl },
  };
}

describe("retention-sweep scheduler (live DB)", () => {
  it("expires an abandoned session on a short interval", async () => {
    const { formId, version } = await seedForm("frm_api_sweep");
    const abandoned = SessionId.parse("ses_api_sweep");
    await createSession(testDb.db, {
      sessionId: abandoned,
      formId,
      formVersion: version,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() - 60_000), // already past → sweepable
    });
    expect((await getSession(testDb.db, abandoned))?.status).toBe("created");

    // System clock: the session's expiry is set relative to real `Date.now()`,
    // so the sweep must compare against real time, not a frozen test clock.
    const deps = makeDeps({ db: testDb.db, config: shortIntervalConfig(25), clock: systemClock });
    const scheduler = createRetentionSweepScheduler(deps);
    scheduler.start();
    try {
      const deadline = Date.now() + 4_000;
      let status: string | undefined;
      while (Date.now() < deadline) {
        status = (await getSession(testDb.db, abandoned))?.status;
        if (status === "expired") break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(status).toBe("expired");
    } finally {
      await scheduler.stop();
    }
    // Graceful stop leaves the scheduler idle.
    expect(scheduler.running).toBe(false);
  }, 15_000);

  /**
   * Issue #304: the same pass also ages out webhook delivery response snippets.
   * `last_response_snippet` is a consumer's response body verbatim, and a consumer
   * that echoes the request in a validation error puts a respondent's answers there.
   * The db package owns which rows; what this proves is that the API's existing
   * retention scheduler is actually wired to run it, against a real database.
   */
  it("ages out a stored delivery response snippet on the same pass", async () => {
    const { formId } = await seedForm("frm_api_snippet");
    const webhookId = "whk_api_snippet";
    await insertWebhook(testDb.db, {
      webhookId,
      formId,
      url: "https://consumer.example.com/api-snippet",
      secretEncrypted: "v1.opaque",
      active: true,
    });
    const event = await enqueue(testDb.db, {
      eventType: "response.submitted",
      payload: { formId },
    });
    await insertDelivery(testDb.db, { outboxId: event.id, webhookId });
    const [delivery] = await listRecentDeliveries(testDb.db, formId, 1);
    await recordDeliveryFailure(testDb.db, delivery!.deliveryId, "http_400", new Date(), {
      lastAttemptAt: new Date(Date.now() - 60_000),
      lastStatus: 400,
      lastLatencyMs: 5,
      lastRequestHeaders: null,
      lastResponseSnippet: '{"error":"invalid","received":{"q_name":"Ada Lovelace"}}',
    });

    const snippetOf = async (): Promise<string | null> =>
      (await listRecentDeliveries(testDb.db, formId, 1))[0]?.lastResponseSnippet ?? null;
    expect(await snippetOf()).toContain("Ada Lovelace");

    // A 1s window against an attempt a minute old, so the very next pass is due to
    // remove it. Real clock, for the same reason the sweep above uses one.
    const deps = makeDeps({
      db: testDb.db,
      config: shortIntervalConfig(25, { deliveryResponseSnippetMs: 1_000 }),
      clock: systemClock,
    });
    const scheduler = createRetentionSweepScheduler(deps);
    scheduler.start();
    try {
      const deadline = Date.now() + 4_000;
      while (Date.now() < deadline && (await snippetOf()) !== null) {
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      await scheduler.stop();
    }

    const [after] = await listRecentDeliveries(testDb.db, formId, 1);
    expect(after?.lastResponseSnippet).toBeNull();
    // Marked, so the dashboard says "removed" rather than "the body was empty".
    expect(after?.lastResponseSnippetRedactedAt).not.toBeNull();
    // The value-free half of the record is untouched.
    expect(after?.lastStatus).toBe(400);
    expect(after?.lastError).toBe("http_400");
  }, 15_000);

  /**
   * Issue #329: the same pass also drops the answers a settled outbox event carries.
   * `outbox.payload` is a second full copy of the respondent's locked answer set,
   * kept only so a delivery can be re-sent; once the event and its whole fan-out
   * have settled past the redelivery window there is nothing left for it to answer.
   * The db package owns which rows; what this proves is that the API's existing
   * retention scheduler is actually wired to run it, against a real database.
   */
  it("drops a settled event's answers on the same pass", async () => {
    const { formId } = await seedForm("frm_api_payload");
    const webhookId = "whk_api_payload";
    await insertWebhook(testDb.db, {
      webhookId,
      formId,
      url: "https://consumer.example.com/api-payload",
      secretEncrypted: "v1.opaque",
      active: true,
    });
    const settledAt = new Date(Date.now() - 60_000);
    const event = await enqueue(testDb.db, {
      eventType: "response.submitted",
      payload: {
        sessionId: "ses_api_payload",
        formId,
        contentHash: "0".repeat(64),
        answers: { q_name: "Ada Lovelace" },
      },
    });
    await insertDelivery(testDb.db, { outboxId: event.id, webhookId });
    const [delivery] = await listRecentDeliveries(testDb.db, formId, 1);
    await markDeliveryDelivered(testDb.db, delivery!.deliveryId, settledAt);
    await markDelivered(testDb.db, event.id, settledAt);

    const payloadOf = async (): Promise<Record<string, unknown>> =>
      (
        await testDb.client.query<{ payload: Record<string, unknown> }>(
          `select payload from outbox where id = $1`,
          [event.id],
        )
      ).rows[0]!.payload;
    expect(await payloadOf()).toHaveProperty("answers");

    // A 1s window against a fan-out that settled a minute ago, so the very next pass
    // is due to redact it. Real clock, for the same reason the sweeps above use one.
    const deps = makeDeps({
      db: testDb.db,
      config: shortIntervalConfig(25, { outboxPayloadMs: 1_000 }),
      clock: systemClock,
    });
    const scheduler = createRetentionSweepScheduler(deps);
    scheduler.start();
    try {
      const deadline = Date.now() + 4_000;
      while (Date.now() < deadline && "answers" in (await payloadOf())) {
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      await scheduler.stop();
    }

    // The answers are gone and the envelope is not: the event still records that a
    // response was submitted for this form and where it went.
    expect(await payloadOf()).toEqual({
      sessionId: "ses_api_payload",
      formId,
      contentHash: "0".repeat(64),
    });
    // And the delivery record survives untouched, so "was this sent anywhere" is
    // still answerable.
    const [after] = await listRecentDeliveries(testDb.db, formId, 1);
    expect(after?.deliveredAt).not.toBeNull();
  }, 15_000);
});

describe("/ready against a reachable database (exit criterion 1 happy path)", () => {
  it("returns 200 ready when the DB responds", async () => {
    const deps = makeDeps({ db: testDb.db });
    const app = createApp(deps, { public: true, internal: true, admin: true });
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", checks: { db: "ok" } });
  });
});
