/**
 * Webhook delivery pass - end-to-end integration (task 025). Boots the 013
 * Testcontainers harness DB and a real in-test HTTP receiver (node:http, test
 * only - the deliverer itself uses the web `fetch`, R4), and proves all five exit
 * criteria against live infrastructure. Requires Docker.
 *
 * 1. submit → a signed request arrives; the signature verifies against the
 *    documented recipe; a tampered body fails verification.
 * 2. failure path: 500 → retries with advancing backoff → dead-lettered with
 *    lastError; the redeliver endpoint → successful delivery → marked delivered.
 * 3. two deliverer instances against one outbox never double-deliver a single
 *    (event, webhook) - `FOR UPDATE SKIP LOCKED`.
 * 4. crash between send and mark-delivered → redelivered on the next pass
 *    (at-least-once; the duplicate is expected).
 * 5. fan-out: two webhooks on one form, one failing - states independent.
 *
 * `node:crypto` appears here only as the verification oracle (the consumer
 * recipe); the production signer never imports it.
 */

import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId, type FormDefinition } from "@qcms/core";
import {
  createForm,
  enqueue,
  insertFormVersion,
  insertWebhook,
  OUTBOX_MAX_ATTEMPTS,
  schema,
  webhookDeliveries,
  type DeliveryRow,
} from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";

import { createApp } from "../app.js";
import { systemClock } from "../clock.js";
import type { Deps } from "../deps.js";
import { encryptWebhookSecret } from "../features/webhooks/crypto.js";
import { registerOutboxOps } from "../features/outbox/route.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, validEnv } from "../test-support.js";
import { runDeliveryPass } from "./outbox-delivery.js";

const { Pool } = pg;
const BOOT_TIMEOUT = 120_000;
const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

// --- in-test HTTP receiver --------------------------------------------------

interface Received {
  readonly path: string;
  readonly header: (name: string) => string | undefined;
  readonly body: string;
}

interface Receiver {
  readonly origin: string;
  readonly received: Received[];
  /** Per-path response status (default 200). */
  readonly status: Map<string, number>;
  setDelay(ms: number): void;
  reset(): void;
  close(): Promise<void>;
}

async function startReceiver(): Promise<Receiver> {
  const received: Received[] = [];
  const status = new Map<string, number>();
  const state = { delayMs: 0 };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const path = req.url ?? "/";
      received.push({
        path,
        body,
        header: (name) => {
          const v = req.headers[name.toLowerCase()];
          return Array.isArray(v) ? v[0] : v;
        },
      });
      const code = status.get(path) ?? 200;
      const respond = (): void => {
        res.writeHead(code, { "content-type": "text/plain" });
        res.end("ok");
      };
      if (state.delayMs > 0) setTimeout(respond, state.delayMs);
      else respond();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    origin: `http://127.0.0.1:${port}`,
    received,
    status,
    setDelay: (ms) => {
      state.delayMs = ms;
    },
    reset: () => {
      received.length = 0;
      status.clear();
      state.delayMs = 0;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// --- fixtures ---------------------------------------------------------------

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as Parameters<typeof insertFormVersion>[1]["compiled"];

let testDb: TestDb;
let receiver: Receiver;
let baseEnv: Record<string, string | undefined>;
let deps: Deps;
let seq = 0;

beforeAll(async () => {
  testDb = await startTestDb();
  receiver = await startReceiver();
  // On-prem override so the localhost receiver passes SSRF at config + delivery
  // time; a single shared env keeps QCMS_APP_KEY stable across the run so the
  // webhook secret we encrypt is decryptable by the deliverer.
  baseEnv = validEnv({ QCMS_WEBHOOK_ALLOW_PRIVATE: "true" });
  deps = makeDeps({ db: testDb.db, env: baseEnv, clock: systemClock });
}, BOOT_TIMEOUT);

afterAll(async () => {
  await receiver.close();
  await testDb.teardown();
}, BOOT_TIMEOUT);

/** Seed a form + published version, and one active webhook per given path. */
async function seed(
  hooks: Array<{ path: string; secret: string }>,
): Promise<{ formId: FormId; version: number; webhookIds: string[] }> {
  seq += 1;
  const formId = FormId.parse(`frm_wd_${seq}`);
  await createForm(testDb.db, { formId, slug: `wd-${seq}`, defaultLocale: "en" });
  const v = await insertFormVersion(testDb.db, {
    formId,
    definition: emptyDef,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  const webhookIds: string[] = [];
  for (let i = 0; i < hooks.length; i++) {
    const webhookId = `whk_wd_${seq}_${i}`;
    const secretEncrypted = await encryptWebhookSecret(hooks[i]!.secret, deps.config.keys.app);
    await insertWebhook(testDb.db, {
      webhookId,
      formId,
      url: `${receiver.origin}${hooks[i]!.path}`,
      secretEncrypted,
      active: true,
    });
    webhookIds.push(webhookId);
  }
  return { formId, version: v.version, webhookIds };
}

/** Enqueue a `response.submitted` event with 020's payload shape. */
async function enqueueSubmitted(formId: FormId, version: number): Promise<string> {
  const event = await enqueue(testDb.db, {
    eventType: "response.submitted",
    payload: {
      sessionId: `ses_wd_${seq}`,
      formId,
      formVersion: version,
      submittedAt: new Date().toISOString(),
      contentHash: `hash_${seq}`,
      answers: { q_name: "Ada" },
    },
  });
  return event.id;
}

async function deliveriesFor(outboxId: string): Promise<DeliveryRow[]> {
  return testDb.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.outboxId, outboxId));
}

/**
 * A `now` a minute ahead of the host clock. Outbox/delivery rows default their
 * `next_attempt_at` to the *database* clock, which in CI can run a few seconds
 * ahead of the host's `Date.now()`; a minute of margin makes freshly enqueued
 * rows reliably "due" regardless of that container skew.
 */
function soon(): Date {
  return new Date(Date.now() + 60_000);
}

/** The documented Node consumer verification recipe. */
function verify(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  return expected === signature;
}

function adminApp(): ReturnType<typeof createApp> {
  return createApp(deps, ADMIN_ONLY, { groups: { admin: [registerAdminAuth, registerOutboxOps] } });
}

function adminHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalTokenFor(deps.config),
    [ADMIN_SESSION_HEADER]: "operator-1",
  };
}

// --- exit criterion 1 -------------------------------------------------------

describe("exit 1: signed delivery arrives and verifies; tamper fails", () => {
  it("delivers a signed response.submitted request the recipe verifies", async () => {
    receiver.reset();
    const secret = "whsec_e2e_sign_0123456789";
    const { formId, version } = await seed([{ path: "/hook1", secret }]);
    const outboxId = await enqueueSubmitted(formId, version);

    const metrics = await runDeliveryPass(deps, { now: soon() });
    expect(metrics.materialized).toBe(1);
    expect(metrics.delivered).toBe(1);

    const hits = receiver.received.filter((r) => r.path === "/hook1");
    expect(hits).toHaveLength(1);
    const req = hits[0]!;

    expect(req.header("x-qcms-event")).toBe("response.submitted");
    expect(req.header("x-qcms-delivery")).toBeTruthy();
    const timestamp = req.header("x-qcms-timestamp")!;
    const signature = req.header("x-qcms-signature")!;
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);

    // The signature verifies over the exact received bytes...
    expect(verify(secret, timestamp, req.body, signature)).toBe(true);
    // ...and a tampered body does not.
    expect(verify(secret, timestamp, req.body + "x", signature)).toBe(false);

    const envelope = JSON.parse(req.body) as {
      eventId: string;
      eventType: string;
      payload: { contentHash: string; formId: string };
    };
    expect(envelope.eventId).toBe(outboxId);
    expect(envelope.eventType).toBe("response.submitted");
    expect(envelope.payload.formId).toBe(formId);

    const [delivery] = await deliveriesFor(outboxId);
    expect(delivery?.deliveredAt).toBeInstanceOf(Date);
  });
});

// --- exit criterion 2 -------------------------------------------------------

describe("exit 2: failure → advancing backoff → dead-letter → redeliver → delivered", () => {
  it("retries with advancing backoff, dead-letters, then the admin endpoint redelivers", async () => {
    receiver.reset();
    receiver.status.set("/fail", 500);
    const secret = "whsec_e2e_fail_0123456789";
    const { formId, version } = await seed([{ path: "/fail", secret }]);
    const outboxId = await enqueueSubmitted(formId, version);

    // Drive attempts, advancing `now` past each scheduled retry, until dead-letter.
    let now = soon();
    const nextAttemptTimes: number[] = [];
    let delivery: DeliveryRow | undefined;
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i++) {
      await runDeliveryPass(deps, { now });
      [delivery] = await deliveriesFor(outboxId);
      if (delivery === undefined) continue;
      nextAttemptTimes.push(delivery.nextAttemptAt.getTime());
      if (delivery.deadLetteredAt) break;
      now = new Date(delivery.nextAttemptAt.getTime());
    }

    expect(delivery?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(delivery?.deadLetteredAt).toBeInstanceOf(Date);
    expect(delivery?.lastError).toBe("http_500");
    // Backoff timestamps advance across attempts (strictly increasing).
    for (let i = 1; i < nextAttemptTimes.length; i++) {
      expect(nextAttemptTimes[i]!).toBeGreaterThan(nextAttemptTimes[i - 1]!);
    }

    // The admin dead-letters view lists it with its attempt history.
    const app = adminApp();
    const listRes = await app.request("/admin/outbox/dead-letters", { headers: adminHeaders() });
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      deadLetters: Array<{
        deliveryId: string;
        eventId: string;
        lastError: string;
        attempts: number;
      }>;
    };
    const mine = listed.deadLetters.find((d) => d.eventId === outboxId);
    expect(mine).toBeDefined();
    expect(mine!.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(mine!.lastError).toBe("http_500");

    // Fix the receiver, redeliver via the admin endpoint, then run a pass.
    receiver.status.set("/fail", 200);
    receiver.received.length = 0;
    const redeliverRes = await app.request(`/admin/outbox/${mine!.deliveryId}/redeliver`, {
      method: "POST",
      headers: adminHeaders(),
    });
    expect(redeliverRes.status).toBe(200);
    expect((await redeliverRes.json()) as { status: string }).toMatchObject({ status: "pending" });

    await runDeliveryPass(deps, { now: soon() });
    expect(receiver.received.filter((r) => r.path === "/fail")).toHaveLength(1);
    [delivery] = await deliveriesFor(outboxId);
    expect(delivery?.deliveredAt).toBeInstanceOf(Date);
    expect(delivery?.deadLetteredAt).toBeNull();
  }, 30_000);

  it("404s redeliver for an unknown delivery id", async () => {
    const res = await adminApp().request(
      "/admin/outbox/00000000-0000-0000-0000-000000000000/redeliver",
      { method: "POST", headers: adminHeaders() },
    );
    expect(res.status).toBe(404);
  });
});

// --- exit criterion 3 -------------------------------------------------------

describe("exit 3: two instances, one outbox - no double-delivery (SKIP LOCKED)", () => {
  let pool: pg.Pool;
  let pooledDeps: Deps;

  beforeAll(() => {
    pool = new Pool({ connectionString: testDb.connectionUri, max: 8 });
    const db = drizzle(pool, { schema }) as unknown as Deps["db"];
    pooledDeps = makeDeps({ db, env: baseEnv, clock: systemClock });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("two concurrent passes deliver a single (event, webhook) exactly once", async () => {
    receiver.reset();
    receiver.setDelay(400); // hold the delivery lock across the POST so the race is real
    const secret = "whsec_e2e_race_0123456789";
    const { formId, version } = await seed([{ path: "/race", secret }]);
    const outboxId = await enqueueSubmitted(formId, version);

    const now = soon();
    const [a, b] = await Promise.all([
      runDeliveryPass(pooledDeps, { now }),
      runDeliveryPass(pooledDeps, { now }),
    ]);

    receiver.setDelay(0);
    // Exactly one POST reached the receiver for this (event, webhook).
    expect(receiver.received.filter((r) => r.path === "/race")).toHaveLength(1);
    expect(a.delivered + b.delivered).toBe(1);

    const rows = await deliveriesFor(outboxId);
    expect(rows).toHaveLength(1); // materialized exactly once too
    expect(rows[0]!.deliveredAt).toBeInstanceOf(Date);
  }, 20_000);
});

// --- exit criterion 4 -------------------------------------------------------

describe("exit 4: crash between send and mark-delivered → redelivered (at-least-once)", () => {
  it("rolls back an interrupted delivery and redelivers it (a duplicate) next pass", async () => {
    receiver.reset();
    const secret = "whsec_e2e_crash_0123456789";
    const { formId, version } = await seed([{ path: "/crash", secret }]);
    const outboxId = await enqueueSubmitted(formId, version);

    // Simulate a crash after the POST but before mark-delivered: the delivery
    // transaction aborts, so the send happened but the row stays pending.
    await expect(
      runDeliveryPass(deps, {
        now: soon(),
        afterSend: () => {
          throw new Error("simulated crash before markDelivered");
        },
      }),
    ).rejects.toThrow("simulated crash");

    expect(receiver.received.filter((r) => r.path === "/crash")).toHaveLength(1);
    let [delivery] = await deliveriesFor(outboxId);
    expect(delivery?.deliveredAt).toBeNull(); // rolled back - still pending

    // Next pass redelivers (the consumer sees a duplicate - at-least-once).
    await runDeliveryPass(deps, { now: soon() });
    expect(receiver.received.filter((r) => r.path === "/crash")).toHaveLength(2);
    [delivery] = await deliveriesFor(outboxId);
    expect(delivery?.deliveredAt).toBeInstanceOf(Date);
  });
});

// --- exit criterion 5 -------------------------------------------------------

describe("exit 5: fan-out - two webhooks, one failing, states independent", () => {
  it("delivers to the healthy webhook while the failing one retries independently", async () => {
    receiver.reset();
    receiver.status.set("/bad", 500);
    const goodSecret = "whsec_e2e_good_0123456789";
    const badSecret = "whsec_e2e_bad_00123456789";
    const { formId, version, webhookIds } = await seed([
      { path: "/good", secret: goodSecret },
      { path: "/bad", secret: badSecret },
    ]);
    const outboxId = await enqueueSubmitted(formId, version);

    const metrics = await runDeliveryPass(deps, { now: soon() });
    expect(metrics.materialized).toBe(2);
    expect(metrics.delivered).toBe(1);
    expect(metrics.failed).toBe(1);

    expect(receiver.received.filter((r) => r.path === "/good")).toHaveLength(1);
    expect(receiver.received.filter((r) => r.path === "/bad")).toHaveLength(1);

    const rows = await deliveriesFor(outboxId);
    const good = rows.find((r) => r.webhookId === webhookIds[0]);
    const bad = rows.find((r) => r.webhookId === webhookIds[1]);
    // Independent states: healthy delivered, failing one pending with a recorded
    // error and no dead-letter yet - neither affects the other.
    expect(good?.deliveredAt).toBeInstanceOf(Date);
    expect(good?.attempts).toBe(0);
    expect(bad?.deliveredAt).toBeNull();
    expect(bad?.attempts).toBe(1);
    expect(bad?.lastError).toBe("http_500");
    expect(bad?.deadLetteredAt).toBeNull();
  });
});
