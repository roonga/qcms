import { FormId, SessionId, type FormDefinition } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createForm,
  createSession,
  enqueue,
  eraseSession,
  insertDelivery,
  insertFormVersion,
  insertWebhook,
  listTombstones,
  markDelivered,
  markDeliveryDelivered,
  markSubmitted,
  DELIVERY_CANCELLED_SESSION_ERASED,
  OUTBOX_MAX_ATTEMPTS,
  outbox,
  redeliveryRefusalFor,
  redactAgedOutboxPayloads,
  redactAgedResponseSnippets,
  recordDeliveryFailure,
  webhookDeliveries,
  type DeliveryAttemptRecord,
} from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
  DEFAULT_TEST_ENVIRONMENT,
} from "@roonga/qcms-db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerOutboxOps } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

const MAX_DELIVERY_LIMIT = 200;
const DEFAULT_DELIVERY_LIMIT = 50;

const FORM_A = FormId.parse("frm_outbox_a");
const FORM_B = FormId.parse("frm_outbox_b");
// Form A's `created_at` stamps are read positionally by the ordering and `?limit`
// assertions, so each later describe seeds its deliveries under a form of its own.
const FORM_SNIPPET = FormId.parse("frm_outbox_snippet");
const FORM_BULK = FormId.parse("frm_outbox_bulk");
const FORM_ERASED = FormId.parse("frm_outbox_erased");

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let adminSessionToken: string;

interface DeliveryItem {
  deliveryId: string;
  eventId: string;
  eventType: string;
  webhookId: string;
  url: string;
  status: "delivered" | "cancelled" | "deadLettered" | "pending";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  deadLetteredAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  lastStatus: number | null;
  latencyMs: number | null;
  requestHeaders: Record<string, string> | null;
  responseSnippet: string | null;
  responseSnippetRedactedAt: string | null;
}

// The deliverer masks before writing, so a hand-seeded record has to look masked too.
const STORED_ATTEMPT: DeliveryAttemptRecord = {
  lastAttemptAt: new Date("2026-07-20T00:00:05.000Z"),
  lastStatus: 200,
  lastLatencyMs: 31,
  lastRequestHeaders: {
    "content-type": "application/json",
    "x-qcms-event": "response.submitted",
    "x-qcms-signature": "v1=<masked>",
  },
  lastResponseSnippet: "thanks",
};

let seq = 0;

// `created_at` is stamped so newest-first ordering is a property of the query rather
// than of how fast the inserts happened to run.
async function seedDelivery(formId: FormId, createdAt: Date): Promise<string> {
  seq += 1;
  const webhookId = `whk_ops_${seq}`;
  await insertWebhook(testDb.db, {
    webhookId,
    formId,
    url: `https://consumer.example.com/ops-${seq}`,
    secretEncrypted: "v1.opaque-ciphertext",
    active: true,
  });
  const event = await enqueue(testDb.db, {
    eventType: "response.submitted",
    payload: { formId },
  });
  await insertDelivery(testDb.db, { outboxId: event.id, webhookId });
  const [row] = await testDb.db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(eq(webhookDeliveries.outboxId, event.id), eq(webhookDeliveries.webhookId, webhookId)),
    );
  const id = row!.id;
  await testDb.db.update(webhookDeliveries).set({ createdAt }).where(eq(webhookDeliveries.id, id));
  return id;
}

let pendingId: string;
let deliveredId: string;
let deadLetteredId: string;
let otherFormId: string;
let erasedFormVersion: number;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, {
    groups: { admin: [registerAdminAuth, registerGrantCheck, registerOutboxOps] },
  });
  adminSessionToken = (await seedAdminSession(testDb.db)).token;

  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FORM_A,
    slug: "ops-a",
    defaultLocale: "en",
  });
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FORM_B,
    slug: "ops-b",
    defaultLocale: "en",
  });
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FORM_SNIPPET,
    slug: "ops-snippet",
    defaultLocale: "en",
  });
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FORM_BULK,
    slug: "ops-bulk",
    defaultLocale: "en",
  });
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FORM_ERASED,
    slug: "ops-erased",
    defaultLocale: "en",
  });
  erasedFormVersion = (
    await insertFormVersion(testDb.db, {
      formId: FORM_ERASED,
      definition: {} as unknown as FormDefinition,
      compiled: {} as unknown as Parameters<typeof insertFormVersion>[1]["compiled"],
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    })
  ).version;

  pendingId = await seedDelivery(FORM_A, new Date("2026-07-20T00:00:00.000Z"));
  deliveredId = await seedDelivery(FORM_A, new Date("2026-07-20T00:01:00.000Z"));
  deadLetteredId = await seedDelivery(FORM_A, new Date("2026-07-20T00:02:00.000Z"));
  otherFormId = await seedDelivery(FORM_B, new Date("2026-07-20T00:03:00.000Z"));

  await markDeliveryDelivered(testDb.db, deliveredId, new Date(), STORED_ATTEMPT);
  for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
    await recordDeliveryFailure(testDb.db, deadLetteredId, "http_500", new Date(), {
      ...STORED_ATTEMPT,
      lastStatus: 500,
      lastResponseSnippet: "upstream unavailable",
    });
  }
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalTokenFor(deps.config),
    [ADMIN_SESSION_HEADER]: adminSessionToken,
  };
}

async function listDeliveries(
  formId: string,
  query = "",
): Promise<{ status: number; items: DeliveryItem[] }> {
  const res = await app.request(`/admin/forms/${formId}/deliveries${query}`, {
    headers: headers(),
  });
  if (res.status !== 200) return { status: res.status, items: [] };
  const body = (await res.json()) as { deliveries: DeliveryItem[] };
  return { status: res.status, items: body.deliveries };
}

describe("GET /admin/forms/:id/deliveries - rejections", () => {
  it("400s a malformed form id (not a frm_ id at all)", async () => {
    const res = await app.request("/admin/forms/not-a-form-id/deliveries", { headers: headers() });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "INVALID_FORM_ID" },
    });
  });

  it("404s a well-formed id for a form that does not exist", async () => {
    const res = await app.request("/admin/forms/frm_no_such_form/deliveries", {
      headers: headers(),
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "FORM_NOT_FOUND" },
    });
  });

  it("401s without an admin session (the gate runs before the handler)", async () => {
    const res = await app.request(`/admin/forms/${FORM_A}/deliveries`, {
      headers: { "x-qcms-internal-token": internalTokenFor(deps.config) },
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/forms/:id/deliveries - scoping, ordering and derived status", () => {
  it("returns only this form's deliveries, newest first", async () => {
    const { items } = await listDeliveries(FORM_A);
    expect(items.map((d) => d.deliveryId)).toEqual([deadLetteredId, deliveredId, pendingId]);
    expect(items.some((d) => d.deliveryId === otherFormId)).toBe(false);
    const other = await listDeliveries(FORM_B);
    expect(other.items.map((d) => d.deliveryId)).toEqual([otherFormId]);
  });

  it("derives status from the lifecycle timestamps for each of the three states", async () => {
    const { items } = await listDeliveries(FORM_A);
    const byId = new Map(items.map((d) => [d.deliveryId, d]));

    const pending = byId.get(pendingId)!;
    expect(pending.status).toBe("pending");
    expect(pending.deliveredAt).toBeNull();
    expect(pending.deadLetteredAt).toBeNull();
    expect(pending.attempts).toBe(0);
    expect(pending.lastAttemptAt).toBeNull();
    expect(pending.requestHeaders).toBeNull();

    const delivered = byId.get(deliveredId)!;
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.deadLetteredAt).toBeNull();
    // `attempts` counts failures, so a first-time success leaves it at 0.
    expect(delivered.attempts).toBe(0);
    expect(delivered.lastStatus).toBe(200);
    expect(delivered.latencyMs).toBe(31);
    expect(delivered.responseSnippet).toBe("thanks");
    expect(delivered.lastAttemptAt).toBe("2026-07-20T00:00:05.000Z");
    expect(delivered.eventType).toBe("response.submitted");
    expect(delivered.url).toContain("https://consumer.example.com/ops-");

    const dead = byId.get(deadLetteredId)!;
    expect(dead.status).toBe("deadLettered");
    expect(dead.deliveredAt).toBeNull();
    expect(dead.deadLetteredAt).not.toBeNull();
    expect(dead.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(dead.lastError).toBe("http_500");
    expect(dead.lastStatus).toBe(500);
    expect(dead.responseSnippet).toBe("upstream unavailable");
    expect(delivered.responseSnippetRedactedAt).toBeNull();
    expect(dead.responseSnippetRedactedAt).toBeNull();
  });

  it("reports a redacted response body as redacted rather than as an empty one", async () => {
    // The attempt is stamped far in the past with a horizon just after it, so the
    // sweep touches this row and nothing else this file seeded.
    const deliveryId = await seedDelivery(FORM_SNIPPET, new Date("2020-01-01T00:00:00.000Z"));
    await recordDeliveryFailure(testDb.db, deliveryId, "http_400", new Date(), {
      ...STORED_ATTEMPT,
      lastAttemptAt: new Date("2020-01-01T00:00:00.000Z"),
      lastStatus: 400,
      lastResponseSnippet: '{"error":"invalid","received":{"q_name":"Ada Lovelace"}}',
    });

    await redactAgedResponseSnippets(testDb.db, new Date("2020-01-02T00:00:00.000Z"));

    const { items } = await listDeliveries(FORM_SNIPPET);
    const row = items.find((i) => i.deliveryId === deliveryId)!;
    expect(row.responseSnippet).toBeNull();
    expect(row.responseSnippetRedactedAt).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain("Ada Lovelace");
    expect(row.lastStatus).toBe(400);
    expect(row.lastError).toBe("http_400");
  });

  it("carries the masked signature through, never an HMAC", async () => {
    const { items } = await listDeliveries(FORM_A);
    const delivered = items.find((d) => d.deliveryId === deliveredId)!;
    expect(delivered.requestHeaders?.["x-qcms-signature"]).toBe("v1=<masked>");
    expect(delivered.requestHeaders?.["x-qcms-event"]).toBe("response.submitted");
    expect(JSON.stringify(items)).not.toMatch(/v1=[0-9a-f]{64}/);
  });
});

describe("POST /admin/forms/:id/deliveries/:deliveryId/redeliver - the ADR-17 refusal", () => {
  async function seedErasableSession(sessionId: string): Promise<SessionId> {
    const parsed = SessionId.parse(sessionId);
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: parsed,
      formId: FORM_ERASED,
      formVersion: erasedFormVersion,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    return parsed;
  }

  // `sessionId: null` seeds an event with no session at all, which is what every
  // non-`response.submitted` type looks like.
  async function seedDeliveryForSession(sessionId: string | null): Promise<string> {
    seq += 1;
    const webhookId = `whk_erased_${seq}`;
    await insertWebhook(testDb.db, {
      webhookId,
      formId: FORM_ERASED,
      url: `https://consumer.example.com/erased-${seq}`,
      secretEncrypted: "v1.opaque-ciphertext",
      active: true,
    });
    const event = await enqueue(testDb.db, {
      eventType: "response.submitted",
      payload:
        sessionId === null
          ? { formId: FORM_ERASED }
          : { sessionId, formId: FORM_ERASED, answers: { q_secret: "42" } },
    });
    await insertDelivery(testDb.db, { outboxId: event.id, webhookId });
    const [row] = await testDb.db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.outboxId, event.id), eq(webhookDeliveries.webhookId, webhookId)),
      );
    return row!.id;
  }

  async function redeliver(deliveryId: string): Promise<{ status: number; code: string | null }> {
    const res = await app.request(
      `/admin/forms/${FORM_ERASED}/deliveries/${deliveryId}/redeliver`,
      {
        method: "POST",
        headers: headers(),
      },
    );
    if (res.ok) return { status: res.status, code: null };
    const body = (await res.json()) as { error?: { code?: string } };
    return { status: res.status, code: body.error?.code ?? null };
  }

  it("409s a delivery erasure cancelled, and leaves the row alone", async () => {
    const sessionId = await seedErasableSession("ses_erased_for_redeliver");
    const deliveryId = await seedDeliveryForSession(sessionId);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
      await recordDeliveryFailure(testDb.db, deliveryId, "http_500", new Date());
    }
    // Redeliverable right up to the erasure, so the 409 below is the erasure's doing.
    expect(await redeliveryRefusalFor(testDb.db, FORM_ERASED, deliveryId)).toBeUndefined();

    await eraseSession(testDb.db, FORM_ERASED, sessionId, "subject_request");

    expect(await redeliver(deliveryId)).toEqual({
      status: 409,
      code: "DELIVERY_NOT_REDELIVERABLE",
    });

    const [after] = await testDb.db
      .select({
        attempts: webhookDeliveries.attempts,
        deadLetteredAt: webhookDeliveries.deadLetteredAt,
        cancelledAt: webhookDeliveries.cancelledAt,
        cancelledReason: webhookDeliveries.cancelledReason,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    expect(after?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(after?.deadLetteredAt).not.toBeNull();
    expect(after?.cancelledAt).not.toBeNull();
    expect(after?.cancelledReason).toBe(DELIVERY_CANCELLED_SESSION_ERASED);
  });

  it("409s a delivery that was already delivered when its session was erased", async () => {
    // Erasure cancels only the still-sendable rows, so this one is not cancelled; its
    // payload is redacted instead.
    const sessionId = await seedErasableSession("ses_erased_after_delivery");
    const deliveryId = await seedDeliveryForSession(sessionId);
    await markDeliveryDelivered(testDb.db, deliveryId, new Date());
    await eraseSession(testDb.db, FORM_ERASED, sessionId, "subject_request");

    expect(await redeliveryRefusalFor(testDb.db, FORM_ERASED, deliveryId)).toBe("payloadRedacted");
    expect(await redeliver(deliveryId)).toEqual({
      status: 409,
      code: "DELIVERY_NOT_REDELIVERABLE",
    });
  });

  it("drops a cancelled delivery from the dead-letter queue but keeps it on the dashboard", async () => {
    const sessionId = await seedErasableSession("ses_erased_dead_letter_queue");
    const deliveryId = await seedDeliveryForSession(sessionId);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
      await recordDeliveryFailure(testDb.db, deliveryId, "http_500", new Date());
    }
    const onQueue = async (): Promise<boolean> => {
      const res = await app.request("/admin/outbox/dead-letters", { headers: headers() });
      const body = (await res.json()) as { deadLetters: Array<{ deliveryId: string }> };
      return body.deadLetters.some((d) => d.deliveryId === deliveryId);
    };
    expect(await onQueue(), "dead-lettered, so on the queue").toBe(true);

    await eraseSession(testDb.db, FORM_ERASED, sessionId, "subject_request");

    expect(await onQueue(), "cancelled, so off the queue").toBe(false);

    const listed = (await listDeliveries(FORM_ERASED)).items.find(
      (d) => d.deliveryId === deliveryId,
    );
    expect(listed?.status).toBe("cancelled");
    expect(listed?.cancelledReason).toBe(DELIVERY_CANCELLED_SESSION_ERASED);
    expect(listed?.cancelledAt).not.toBeNull();
  });

  it("still redelivers a delivery whose session was never erased", async () => {
    const deliveryId = await seedDeliveryForSession("ses_alive_for_redeliver");
    expect((await redeliver(deliveryId)).status).toBe(200);
  });

  it("still redelivers a delivery whose snippet merely aged out (#304)", async () => {
    const deliveryId = await seedDeliveryForSession("ses_alive_snippet_aged");
    await recordDeliveryFailure(testDb.db, deliveryId, "http_400", new Date(), {
      ...STORED_ATTEMPT,
      lastAttemptAt: new Date("2020-01-01T00:00:00.000Z"),
      lastStatus: 400,
      lastResponseSnippet: '{"error":"invalid","received":{"q_name":"Ada Lovelace"}}',
    });
    await redactAgedResponseSnippets(testDb.db, new Date("2020-01-02T00:00:00.000Z"));

    expect(await redeliveryRefusalFor(testDb.db, FORM_ERASED, deliveryId)).toBeUndefined();
    expect((await redeliver(deliveryId)).status).toBe(200);
  });

  it("refuses a delivery whose payload merely aged out, without calling it erased (#329)", async () => {
    const deliveryId = await seedDeliveryForSession("ses_payload_aged_out");
    await markDeliveryDelivered(testDb.db, deliveryId, new Date("2020-01-01T00:00:00.000Z"));
    const [parent] = await testDb.db
      .select({ outboxId: webhookDeliveries.outboxId })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    await markDelivered(testDb.db, parent!.outboxId, new Date("2020-01-01T00:00:00.000Z"));
    await redactAgedOutboxPayloads(testDb.db, new Date("2020-01-02T00:00:00.000Z"));

    const tombstones = await listTombstones(testDb.db, { limit: 100 });
    expect(tombstones.map((t) => t.sessionId)).not.toContain("ses_payload_aged_out");
    const [state] = await testDb.db
      .select({ cancelledAt: webhookDeliveries.cancelledAt })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    expect(state?.cancelledAt).toBeNull();
    expect(await redeliveryRefusalFor(testDb.db, FORM_ERASED, deliveryId)).toBe("payloadRedacted");
    expect(await redeliver(deliveryId)).toEqual({
      status: 409,
      code: "DELIVERY_NOT_REDELIVERABLE",
    });
  });

  it("still redelivers an event that names no session at all", async () => {
    const deliveryId = await seedDeliveryForSession(null);
    expect((await redeliver(deliveryId)).status).toBe(200);
  });
});

describe("POST /admin/forms/:id/deliveries/:deliveryId/redeliver - the delivery id grammar", () => {
  const ABSENT_BUT_WELL_FORMED = "d290f1ee-6c54-4b01-90e6-d701748f0851";

  const FORM_ID_SHAPE = FormId.parse("frm_outbox_id_shape");

  beforeAll(async () => {
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FORM_ID_SHAPE,
      slug: "ops-id-shape",
      defaultLocale: "en",
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  async function redeliverRaw(id: string): Promise<{ status: number; body: unknown }> {
    const res = await app.request(`/admin/forms/${FORM_ID_SHAPE}/deliveries/${id}/redeliver`, {
      method: "POST",
      headers: headers(),
    });
    return { status: res.status, body: await res.json() };
  }

  it("404s with the absent-row body rather than 500ing on the uuid cast", async () => {
    const absent = await redeliverRaw(ABSENT_BUT_WELL_FORMED);
    expect(absent.status).toBe(404);
    expect(absent.body).toEqual({
      error: { code: "DELIVERY_NOT_FOUND", message: "No such webhook delivery" },
    });

    const malformed = await redeliverRaw("not-a-uuid");
    expect(malformed.status).toBe(404);
    expect(malformed.body).toEqual(absent.body);
  });

  it("404s a malformed form id with the same body, keeping the route 400-free (#305/#310)", async () => {
    // "Malformed form", "no such delivery" and "not your form" are one answer, so the
    // response cannot be used to sort them.
    const absent = await redeliverRaw(ABSENT_BUT_WELL_FORMED);
    const res = await app.request(
      `/admin/forms/not-a-form-id/deliveries/${ABSENT_BUT_WELL_FORMED}/redeliver`,
      { method: "POST", headers: headers() },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(absent.body);
  });

  it("404s every shape Postgres would have cast-errored on, and still accepts a real id", async () => {
    // Each of these is rejected by Postgres's own uuid input grammar too.
    const wouldCastError = [
      "d290f1ee-6c54-4b01-90e6-d701748f085",
      "d290f1ee-6c54-4b01-90e6-d701748f08511",
      "z290f1ee-6c54-4b01-90e6-d701748f0851",
      "not%20a%20uuid",
      "0",
    ];
    for (const id of wouldCastError) {
      const res = await redeliverRaw(id);
      expect({ id, status: res.status, body: res.body }).toEqual({
        id,
        status: 404,
        body: { error: { code: "DELIVERY_NOT_FOUND", message: "No such webhook delivery" } },
      });
    }

    expect((await redeliverRaw(await seedDelivery(FORM_ID_SHAPE, new Date()))).status).toBe(200);
  });

  it("404s the alternate uuid spellings Postgres accepts - deliberately, not by oversight", async () => {
    // Postgres accepts all three spellings below for this row; the API deliberately
    // does not, so widening it is a contract change rather than a bug fix.
    const real = await seedDelivery(FORM_ID_SHAPE, new Date());

    // Asserted first, so the negative assertions below cannot pass on a missing row.
    expect((await redeliverRaw(real)).status).toBe(200);

    const hex = real.replaceAll("-", "");
    const alternates = [hex, `{${real}}`, (hex.match(/.{4}/g) ?? []).join("-")];
    for (const id of alternates) {
      const res = await redeliverRaw(id);
      expect({ id, status: res.status, body: res.body }).toEqual({
        id,
        status: 404,
        body: { error: { code: "DELIVERY_NOT_FOUND", message: "No such webhook delivery" } },
      });
    }
  });

  it("is case-insensitive about the hex, so an uppercased real id still resolves", async () => {
    const id = await seedDelivery(FORM_ID_SHAPE, new Date());
    expect((await redeliverRaw(id.toUpperCase())).status).toBe(200);
  });
});

describe("GET /admin/forms/:id/deliveries - the limit", () => {
  it("honours ?limit and falls back to the default for an unusable one", async () => {
    expect((await listDeliveries(FORM_A, "?limit=1")).items.map((d) => d.deliveryId)).toEqual([
      deadLetteredId,
    ]);
    expect((await listDeliveries(FORM_A, "?limit=abc")).items).toHaveLength(3);
    expect((await listDeliveries(FORM_A, "?limit=0")).items).toHaveLength(3);
    expect((await listDeliveries(FORM_A, "?limit=-5")).items).toHaveLength(3);
  });

  it("caps the page at MAX_DELIVERY_LIMIT and defaults to DEFAULT_DELIVERY_LIMIT", async () => {
    seq += 1;
    const webhookId = `whk_ops_bulk_${seq}`;
    await insertWebhook(testDb.db, {
      webhookId,
      formId: FORM_BULK,
      url: "https://consumer.example.com/ops-bulk",
      secretEncrypted: "v1.opaque-ciphertext",
      active: true,
    });
    const events = await testDb.db
      .insert(outbox)
      .values(
        Array.from({ length: MAX_DELIVERY_LIMIT + 1 }, () => ({
          eventType: "response.submitted",
          payload: { formId: FORM_BULK },
        })),
      )
      .returning({ id: outbox.id });
    await testDb.db
      .insert(webhookDeliveries)
      .values(events.map((e) => ({ outboxId: e.id, webhookId })));

    expect((await listDeliveries(FORM_BULK, "?limit=1000")).items).toHaveLength(MAX_DELIVERY_LIMIT);
    expect((await listDeliveries(FORM_BULK)).items).toHaveLength(DEFAULT_DELIVERY_LIMIT);
  });
});

describe("form scope on redeliver (issue #305)", () => {
  const FORM_SCOPE_OWNER = FormId.parse("frm_scope_owner");
  const FORM_SCOPE_OTHER = FormId.parse("frm_scope_other");

  let ownerVersion: number;

  beforeAll(async () => {
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FORM_SCOPE_OWNER,
      slug: "scope-owner",
      defaultLocale: "en",
    });
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FORM_SCOPE_OTHER,
      slug: "scope-other",
      defaultLocale: "en",
    });
    ownerVersion = (
      await insertFormVersion(testDb.db, {
        formId: FORM_SCOPE_OWNER,
        definition: {} as unknown as FormDefinition,
        compiled: {} as unknown as Parameters<typeof insertFormVersion>[1]["compiled"],
        compilerVersion: "1.0.0",
        a2uiSpecVersion: "1.0.0",
        semanticsVersion: "1",
      })
    ).version;
  }, CONTAINER_BOOT_TIMEOUT_MS);

  async function seedOwnerSession(sessionId: string): Promise<SessionId> {
    const parsed = SessionId.parse(sessionId);
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId: parsed,
      formId: FORM_SCOPE_OWNER,
      formVersion: ownerVersion,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await markSubmitted(testDb.db, parsed);
    return parsed;
  }

  async function seedOwnerDeliveryFor(sessionId: SessionId): Promise<string> {
    seq += 1;
    const webhookId = `whk_scope_${seq}`;
    await insertWebhook(testDb.db, {
      webhookId,
      formId: FORM_SCOPE_OWNER,
      url: `https://consumer.example.com/scope-${seq}`,
      secretEncrypted: "v1.opaque-ciphertext",
      active: true,
    });
    const event = await enqueue(testDb.db, {
      eventType: "response.submitted",
      payload: { sessionId, formId: FORM_SCOPE_OWNER, answers: { q_secret: "42" } },
    });
    await insertDelivery(testDb.db, { outboxId: event.id, webhookId });
    const [row] = await testDb.db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.outboxId, event.id), eq(webhookDeliveries.webhookId, webhookId)),
      );
    return row!.id;
  }

  async function deliveryState(deliveryId: string): Promise<{
    attempts: number;
    deadLetteredAt: Date | null;
    nextAttemptAt: Date;
    lastError: string | null;
  }> {
    const [row] = await testDb.db
      .select({
        attempts: webhookDeliveries.attempts,
        deadLetteredAt: webhookDeliveries.deadLetteredAt,
        nextAttemptAt: webhookDeliveries.nextAttemptAt,
        lastError: webhookDeliveries.lastError,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    return row!;
  }

  async function redeliverAs(formId: FormId, deliveryId: string): Promise<number> {
    const res = await app.request(`/admin/forms/${formId}/deliveries/${deliveryId}/redeliver`, {
      method: "POST",
      headers: headers(),
    });
    return res.status;
  }

  async function seedDeadLettered(formId: FormId): Promise<string> {
    const deliveryId = await seedDelivery(formId, new Date("2026-07-21T00:00:00.000Z"));
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) {
      await recordDeliveryFailure(testDb.db, deliveryId, "http_500", new Date(), {
        ...STORED_ATTEMPT,
        lastStatus: 500,
      });
    }
    return deliveryId;
  }

  it("redelivers a delivery named under its own form", async () => {
    const deliveryId = await seedDeadLettered(FORM_SCOPE_OWNER);
    expect((await deliveryState(deliveryId)).deadLetteredAt).not.toBeNull();

    expect(await redeliverAs(FORM_SCOPE_OWNER, deliveryId)).toBe(200);

    const after = await deliveryState(deliveryId);
    expect(after.deadLetteredAt).toBeNull();
    expect(after.attempts).toBe(0);
  });

  it("404s a redeliver naming another form, and resets nothing", async () => {
    const deliveryId = await seedDeadLettered(FORM_SCOPE_OWNER);

    // Without this the 404 below would be satisfied by a uuid that was never issued.
    const before = await deliveryState(deliveryId);
    expect(before.deadLetteredAt).not.toBeNull();
    expect(before.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(before.lastError).toBe("http_500");

    expect(await redeliverAs(FORM_SCOPE_OTHER, deliveryId)).toBe(404);

    expect(await deliveryState(deliveryId)).toEqual(before);

    expect(await redeliverAs(FORM_SCOPE_OWNER, deliveryId)).toBe(200);
    expect((await deliveryState(deliveryId)).deadLetteredAt).toBeNull();
  });

  it("404s rather than 409s for another form's cancelled delivery", async () => {
    const sessionId = await seedOwnerSession("ses_scope_cancelled");
    const deliveryId = await seedOwnerDeliveryFor(sessionId);
    await eraseSession(testDb.db, FORM_SCOPE_OWNER, sessionId, "subject_request");

    // Without this the 404 below could pass on a delivery that was never refusable.
    expect(await redeliveryRefusalFor(testDb.db, FORM_SCOPE_OWNER, deliveryId)).toBe("cancelled");

    expect(await redeliverAs(FORM_SCOPE_OWNER, deliveryId)).toBe(409);
    expect(await redeliverAs(FORM_SCOPE_OTHER, deliveryId)).toBe(404);
    expect(await redeliverAs(FORM_SCOPE_OTHER, "00000000-0000-0000-0000-000000000000")).toBe(404);
  });
});
