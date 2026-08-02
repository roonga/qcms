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
 */

import { FormId } from "@qcms/core";
import {
  createForm,
  enqueue,
  insertDelivery,
  insertWebhook,
  markDeliveryDelivered,
  OUTBOX_MAX_ATTEMPTS,
  outbox,
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
  status: "delivered" | "deadLettered" | "pending";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  deadLetteredAt: string | null;
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

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, { groups: { admin: [registerAdminAuth, registerOutboxOps] } });
  adminSessionToken = (await seedAdminSession(testDb.db)).token;

  await createForm(testDb.db, { formId: FORM_A, slug: "ops-a", defaultLocale: "en" });
  await createForm(testDb.db, { formId: FORM_B, slug: "ops-b", defaultLocale: "en" });
  await createForm(testDb.db, { formId: FORM_BULK, slug: "ops-bulk", defaultLocale: "en" });

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
