/**
 * Outbox delivery-operations admin slice tests (task 035), driven through
 * `app.request()` against the 013 Testcontainers harness DB. Requires Docker.
 *
 * Covers `GET /admin/forms/:id/deliveries` - the operator dashboard's read: a
 * malformed or unknown form id, form scoping (one form's delivery history is not
 * another's), the derived `status` for each lifecycle, the limit's default and its
 * ceiling, and that the request headers the response carries are the masked ones.
 *
 * The masking itself is proven at its source in
 * `apps/api/src/schedulers/webhook-delivery.integration.test.ts`; what this file
 * proves is that the read path passes through what was stored rather than
 * re-deriving (and so re-leaking) anything.
 *
 * It also covers `POST /admin/outbox/:id/redeliver` refusing a delivery erasure has
 * reached (ADR-17 as amended 2026-08-02; task 059 replaced 035's version of this).
 * The refusal is now a property of the data: `eraseSession` cancels the session's
 * still-sendable deliveries and redacts the outbox payload they would carry, and the
 * handler reads exactly the two columns `claimDueDeliveries` filters on. These cases
 * drive real erasures rather than hand-writing a tombstone, so what they pin is the
 * whole chain from the erase call to the 409.
 */

import { FormId, SessionId, type FormDefinition } from "@qcms/core";
import {
  createForm,
  createSession,
  enqueue,
  eraseSession,
  insertDelivery,
  insertFormVersion,
  insertWebhook,
  markDeliveryDelivered,
  DELIVERY_CANCELLED_SESSION_ERASED,
  OUTBOX_MAX_ATTEMPTS,
  outbox,
  redeliveryRefusalFor,
  recordDeliveryFailure,
  webhookDeliveries,
  type DeliveryAttemptRecord,
} from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerOutboxOps } from "./route.js";

const BOOT_TIMEOUT = 120_000;
const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

/** The handler's own ceiling on `?limit`, restated so a change to it fails here. */
const MAX_DELIVERY_LIMIT = 200;
/** The handler's default page size when the caller names no usable limit. */
const DEFAULT_DELIVERY_LIMIT = 50;

const FORM_A = FormId.parse("frm_outbox_a");
const FORM_B = FormId.parse("frm_outbox_b");
const FORM_BULK = FormId.parse("frm_outbox_bulk");
/**
 * A form of its own for the ADR-17 refusal cases.
 *
 * Not FORM_A: those fixtures are stamped `created_at` values that the newest-first
 * and `?limit` assertions read positionally, and a delivery seeded here at "now"
 * silently became the newest row of that form. A separate form keeps each describe's
 * fixtures its own.
 */
const FORM_ERASED = FormId.parse("frm_outbox_erased");

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let adminSessionToken: string;

/** One delivery as the dashboard reads it. Mirrors `DeliveryItem` in `schema.ts`. */
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
}

/**
 * The stored attempt record, already masked - the deliverer masks before writing,
 * so a record seeded by hand has to look the same or the read-path assertion would
 * be testing a fiction.
 */
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

/**
 * Materialize one delivery for `formId` on a fresh webhook and event, stamping its
 * `created_at` so the newest-first ordering is a property of the query rather than
 * of how fast the inserts happened to run.
 */
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

/** Form A's three deliveries, oldest first: pending, delivered, dead-lettered. */
let pendingId: string;
let deliveredId: string;
let deadLetteredId: string;
/** Form B's single delivery - the one that must never appear under form A. */
let otherFormId: string;
let erasedFormVersion: number;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, { groups: { admin: [registerAdminAuth, registerOutboxOps] } });
  adminSessionToken = (await seedAdminSession(testDb.db)).token;

  await createForm(testDb.db, { formId: FORM_A, slug: "ops-a", defaultLocale: "en" });
  await createForm(testDb.db, { formId: FORM_B, slug: "ops-b", defaultLocale: "en" });
  await createForm(testDb.db, { formId: FORM_BULK, slug: "ops-bulk", defaultLocale: "en" });
  await createForm(testDb.db, { formId: FORM_ERASED, slug: "ops-erased", defaultLocale: "en" });
  // A published version, so the ADR-17 cases can create real sessions and erase them
  // rather than hand-writing a tombstone for a session that never existed.
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
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb?.teardown();
}, BOOT_TIMEOUT);

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
    // Form B's delivery is absent, and form B sees only its own: the scope is the
    // webhook's form, so one author's operations tab cannot read another's.
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
    // A first-time success leaves the failed-attempt counter at 0 by design.
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
  });

  it("carries the masked signature through, never an HMAC", async () => {
    const { items } = await listDeliveries(FORM_A);
    const delivered = items.find((d) => d.deliveryId === deliveredId)!;
    expect(delivered.requestHeaders?.["x-qcms-signature"]).toBe("v1=<masked>");
    expect(delivered.requestHeaders?.["x-qcms-event"]).toBe("response.submitted");
    // The whole response, not just the one field: no HMAC-shaped value anywhere.
    expect(JSON.stringify(items)).not.toMatch(/v1=[0-9a-f]{64}/);
  });
});

describe("POST /admin/outbox/:id/redeliver - the ADR-17 refusal", () => {
  /**
   * A real, submitted session on FORM_ERASED, so `eraseSession` has something to
   * erase. Returns the id it was created under.
   */
  async function seedErasableSession(sessionId: string): Promise<SessionId> {
    const parsed = SessionId.parse(sessionId);
    await createSession(testDb.db, {
      sessionId: parsed,
      formId: FORM_ERASED,
      formVersion: erasedFormVersion,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    return parsed;
  }

  /**
   * A delivery on FORM_ERASED whose event names `sessionId` (or none).
   * `sessionId: null` seeds an event with no session at all, which is what every
   * non-`response.submitted` type looks like.
   */
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
      // The shape the submit slice enqueues: the whole locked answer set travels
      // with the event, which is exactly why an erased session's copy matters.
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
    const res = await app.request(`/admin/outbox/${deliveryId}/redeliver`, {
      method: "POST",
      headers: headers(),
    });
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
    // Redeliverable right up to the erasure - so the 409 below is the erasure's
    // doing and not some pre-existing state of the fixture.
    expect(await redeliveryRefusalFor(testDb.db, deliveryId)).toBeUndefined();

    await eraseSession(testDb.db, sessionId, "subject_request");

    expect(await redeliver(deliveryId)).toEqual({ status: 409, code: "DELIVERY_SESSION_ERASED" });

    // A typed 409, not a 500: the refusal is a modelled outcome the admin renders,
    // and the payload carries a code rather than a stack.
    const [after] = await testDb.db
      .select({
        attempts: webhookDeliveries.attempts,
        deadLetteredAt: webhookDeliveries.deadLetteredAt,
        cancelledAt: webhookDeliveries.cancelledAt,
        cancelledReason: webhookDeliveries.cancelledReason,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    // Refused, not reset: the row keeps its attempt history and its dead-letter
    // stamp, and now carries the cancelled state on top of them.
    expect(after?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(after?.deadLetteredAt).not.toBeNull();
    expect(after?.cancelledAt).not.toBeNull();
    expect(after?.cancelledReason).toBe(DELIVERY_CANCELLED_SESSION_ERASED);
  });

  it("409s a delivery that was already delivered when its session was erased", async () => {
    // Erasure cancels only the still-sendable rows, so this one is not cancelled -
    // its payload is redacted instead. Both halves must reach the same refusal, or
    // an operator could re-post an event with no answers left in it.
    const sessionId = await seedErasableSession("ses_erased_after_delivery");
    const deliveryId = await seedDeliveryForSession(sessionId);
    await markDeliveryDelivered(testDb.db, deliveryId, new Date());
    await eraseSession(testDb.db, sessionId, "subject_request");

    expect(await redeliveryRefusalFor(testDb.db, deliveryId)).toBe("payloadRedacted");
    expect(await redeliver(deliveryId)).toEqual({ status: 409, code: "DELIVERY_SESSION_ERASED" });
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

    await eraseSession(testDb.db, sessionId, "subject_request");

    // Off the worklist - every row there is being offered for redelivery, and this
    // one may never be sent.
    expect(await onQueue(), "cancelled, so off the queue").toBe(false);

    // But not hidden: the dashboard shows it with the cancelled status and reason,
    // so "what happened to that delivery" has an answer.
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

  it("still redelivers an event that names no session at all", async () => {
    // `form.published` and friends carry no `sessionId`; the guard must read that as
    // "not erased" rather than refusing every non-response event.
    const deliveryId = await seedDeliveryForSession(null);
    expect((await redeliver(deliveryId)).status).toBe(200);
  });
});

describe("GET /admin/forms/:id/deliveries - the limit", () => {
  it("honours ?limit and falls back to the default for an unusable one", async () => {
    expect((await listDeliveries(FORM_A, "?limit=1")).items.map((d) => d.deliveryId)).toEqual([
      deadLetteredId,
    ]);
    // Garbage and non-positive limits are a page-size default, not a 400: the
    // parameter is a convenience, and a broken one should not break the screen.
    expect((await listDeliveries(FORM_A, "?limit=abc")).items).toHaveLength(3);
    expect((await listDeliveries(FORM_A, "?limit=0")).items).toHaveLength(3);
    expect((await listDeliveries(FORM_A, "?limit=-5")).items).toHaveLength(3);
  });

  it("caps the page at MAX_DELIVERY_LIMIT and defaults to DEFAULT_DELIVERY_LIMIT", async () => {
    // One webhook, many events: enough history that both the default and the cap
    // bite. Inserted in bulk because this is fixture volume, not behaviour.
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
