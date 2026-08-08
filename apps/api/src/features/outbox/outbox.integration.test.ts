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
 *
 * The last describe covers the same route's id shape (issue 310): a delivery id is a
 * uuid column value, so a malformed one has to be answered rather than handed to
 * Postgres to cast-error on, and the answer has to be the 404 an absent row already
 * gets - same status, same body, same code.
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
  redactAgedResponseSnippets,
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
/** A form of its own for the response-snippet retention test (#304), so its extra
 * delivery cannot perturb the ordering and limit assertions over form A. */
const FORM_SNIPPET = FormId.parse("frm_outbox_snippet");
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
  responseSnippetRedactedAt: string | null;
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
  await createForm(testDb.db, { formId: FORM_SNIPPET, slug: "ops-snippet", defaultLocale: "en" });
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
    // #304: intact bodies read as not-redacted, so a client can tell the two apart.
    expect(delivered.responseSnippetRedactedAt).toBeNull();
    expect(dead.responseSnippetRedactedAt).toBeNull();
  });

  it("reports a redacted response body as redacted rather than as an empty one", async () => {
    // Issue #304: a consumer echoing the request in a validation error puts the
    // respondent's answers in `responseSnippet`, so it is removed on erasure and by
    // the retention sweep. Both leave the field null - the same value it has when no
    // response arrived or the body was genuinely empty - so the API has to carry the
    // marker, or an operator screen would report an empty body for a deleted one.
    // Its own form, and an attempt stamped far in the past with a horizon just
    // after it, so the sweep touches this row and nothing else this file seeded.
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
    // Nothing in the payload leaks the removed bytes back out.
    expect(JSON.stringify(row)).not.toContain("Ada Lovelace");
    // The value-free record is still there for the audit question.
    expect(row.lastStatus).toBe(400);
    expect(row.lastError).toBe("http_400");
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

  it("still redelivers a delivery whose snippet merely aged out (#304)", async () => {
    // The trap this pins: the refusal maps to an **erasure-specific** message, which
    // is accurate only while erasure is the sole thing it reads. Response-snippet
    // retention adds a second producer of a redaction marker, so if the refusal ever
    // learned to read that one it would tell an operator a response was erased when
    // it merely aged out - and would block a redelivery there is no reason to block.
    const deliveryId = await seedDeliveryForSession("ses_alive_snippet_aged");
    await recordDeliveryFailure(testDb.db, deliveryId, "http_400", new Date(), {
      ...STORED_ATTEMPT,
      lastAttemptAt: new Date("2020-01-01T00:00:00.000Z"),
      lastStatus: 400,
      lastResponseSnippet: '{"error":"invalid","received":{"q_name":"Ada Lovelace"}}',
    });
    await redactAgedResponseSnippets(testDb.db, new Date("2020-01-02T00:00:00.000Z"));

    expect(await redeliveryRefusalFor(testDb.db, deliveryId)).toBeUndefined();
    expect((await redeliver(deliveryId)).status).toBe(200);
  });

  it("still redelivers an event that names no session at all", async () => {
    // `form.published` and friends carry no `sessionId`; the guard must read that as
    // "not erased" rather than refusing every non-response event.
    const deliveryId = await seedDeliveryForSession(null);
    expect((await redeliver(deliveryId)).status).toBe(200);
  });
});

/**
 * Issue 310. `webhook_deliveries.id` is a `uuid` column, so before this an id that
 * was not one reached Postgres and raised `22P02 invalid input syntax for type
 * uuid`, which the envelope rendered as an opaque 500 - on a route that documents
 * 401/404/409 and no 400 at all.
 *
 * These pin two things. First, that an unrecognized id and an absent-but-canonical
 * id are the *same* answer, body and all: "no such delivery" is one fact with one
 * code, and a caller cannot use the response to learn which ids the store keeps.
 * Second, that the API's id grammar is exactly the canonical spelling - narrower
 * than Postgres's input grammar, which also takes unhyphenated, braced and
 * oddly-hyphenated forms of the same value. That narrowing is a decision, so it
 * gets an assertion of its own rather than being left to be read off a regex.
 */
describe("POST /admin/outbox/:id/redeliver - the delivery id grammar", () => {
  /** A well-formed uuid that is not any row's id: the reference 404. */
  const ABSENT_BUT_WELL_FORMED = "d290f1ee-6c54-4b01-90e6-d701748f0851";

  /**
   * A form of this describe's own, for the same reason FORM_ERASED exists: the
   * happy-path cases below seed deliveries at "now", and on FORM_A they would
   * silently become the newest rows the ordering and `?limit` assertions read.
   */
  const FORM_ID_SHAPE = FormId.parse("frm_outbox_id_shape");

  beforeAll(async () => {
    await createForm(testDb.db, {
      formId: FORM_ID_SHAPE,
      slug: "ops-id-shape",
      defaultLocale: "en",
    });
  }, BOOT_TIMEOUT);

  async function redeliverRaw(id: string): Promise<{ status: number; body: unknown }> {
    const res = await app.request(`/admin/outbox/${id}/redeliver`, {
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

    // The whole envelope, not just the status: a malformed id must be
    // indistinguishable from an absent one, so a new third shape here is a defect.
    const malformed = await redeliverRaw("not-a-uuid");
    expect(malformed.status).toBe(404);
    expect(malformed.body).toEqual(absent.body);
  });

  it("404s every shape Postgres would have cast-errored on, and still accepts a real id", async () => {
    // Each of these is rejected by Postgres's own uuid input grammar too, so each
    // one is a 500 on the pre-310 code: too short, too long, non-hex, an encoded
    // segment, a bare number.
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

    // And the guard has not swallowed the happy path: a real id still redelivers.
    expect((await redeliverRaw(await seedDelivery(FORM_ID_SHAPE, new Date()))).status).toBe(200);
  });

  it("404s the alternate uuid spellings Postgres accepts - deliberately, not by oversight", async () => {
    // This is the one place the API's grammar is *narrower* than the column's, so
    // it is pinned rather than left to be inferred from the regex. Postgres 16
    // accepts all three of these as input for the very row seeded below, and a
    // widened predicate really does resolve them to it (verified by widening the
    // predicate and watching these assertions return a 200 `pending` body). This
    // surface answers 404 instead: a delivery id is a machine
    // value that callers round-trip verbatim out of the list responses, and one row
    // answering to four ids is not something an identify-one-delivery endpoint
    // should offer. A future reader who lands here from a 404 is reading a
    // decision. Widening it is a contract change, not a bug fix.
    const real = await seedDelivery(FORM_ID_SHAPE, new Date());

    // The control, asserted *first* and deliberately so: it establishes that the row
    // is present and reachable before anything below claims a spelling of it is not.
    // Ordered the other way this test could go green on a missing fixture, which is
    // the failure mode that makes a negative assertion worthless.
    expect((await redeliverRaw(real)).status).toBe(200);

    const hex = real.replaceAll("-", "");
    const alternates = [
      hex, // unhyphenated
      `{${real}}`, // braced
      // Arbitrary hyphen placement: Postgres takes hyphens between any groups, so
      // this is the same value to the column.
      (hex.match(/.{4}/g) ?? []).join("-"),
    ];
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
    // Postgres compares uuids by value, so the uppercased form of a stored id is
    // the same row - the shape check must not be the thing that hides it.
    const id = await seedDelivery(FORM_ID_SHAPE, new Date());
    expect((await redeliverRaw(id.toUpperCase())).status).toBe(200);
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
