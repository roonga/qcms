/**
 * Webhook-config admin slice tests (task 024, SEC-6), driven through
 * `app.request()` against the 013 Testcontainers harness DB. Requires Docker.
 *
 * Covers exit criterion 3: webhook CRUD; the secret is shown exactly once (create
 * + explicit rotate) and masked on reads; SSRF cases (localhost, 10.x,
 * link-local) rejected by default and allowed under the override flag; and the
 * at-rest round-trip — the stored ciphertext decrypts back to the shown secret
 * (proving 025 can recover it to sign deliveries). Every app key is synthetic.
 */

import { FormId } from "@qcms/core";
import { createForm, getWebhook } from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, validEnv } from "../../test-support.js";
import { decryptWebhookSecret } from "./crypto.js";
import { registerWebhooks } from "./route.js";

const BOOT_TIMEOUT = 120_000;
const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

const FORM_ID = FormId.parse("frm_webhooks_it");
let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
// A fixed base env so the on-prem-override app shares the internal token and app
// key with the default app — only QCMS_WEBHOOK_ALLOW_PRIVATE varies.
let baseEnv: Record<string, string | undefined>;

/** Build an admin app over the shared db with the given env overrides. */
function buildApp(env: Record<string, string | undefined>): {
  deps: Deps;
  app: ReturnType<typeof createApp>;
} {
  const d = makeDeps({ db: testDb.db, env });
  const a = createApp(d, ADMIN_ONLY, {
    groups: { admin: [registerAdminAuth, registerWebhooks] },
  });
  return { deps: d, app: a };
}

beforeAll(async () => {
  testDb = await startTestDb();
  baseEnv = validEnv();
  ({ deps, app } = buildApp(baseEnv));
  internalToken = internalTokenFor(deps.config);
  await createForm(testDb.db, { formId: FORM_ID, slug: "webhooks-it", defaultLocale: "en" });
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

// --- request helpers --------------------------------------------------------

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: "editor-1",
  };
}

async function req(
  targetApp: ReturnType<typeof createApp>,
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return targetApp.request(`/admin${path}`, {
    method,
    headers: headers(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// --- tests ------------------------------------------------------------------

describe("webhook CRUD, secret reveal/mask, and at-rest round-trip", () => {
  it("creates a webhook, shows the secret once, and encrypts it at rest (decryptable)", async () => {
    const res = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", {
      url: "https://consumer.example.com/hook",
      active: true,
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      webhookId: string;
      url: string;
      active: boolean;
      secret: string;
    };
    expect(created.webhookId.startsWith("whk_")).toBe(true);
    expect(created.secret.startsWith("whsec_")).toBe(true);

    // At-rest round-trip: the stored ciphertext is NOT the plaintext, and it
    // decrypts under QCMS_APP_KEY back to exactly the shown secret (SEC-6 — 025
    // recovers it to sign). This proves encryption, not a one-way hash.
    const row = await getWebhook(testDb.db, FORM_ID, created.webhookId);
    expect(row?.secretEncrypted.startsWith("v1.")).toBe(true);
    expect(row?.secretEncrypted).not.toContain(created.secret);
    const decrypted = await decryptWebhookSecret(row!.secretEncrypted, deps.config.keys.app);
    expect(decrypted).toBe(created.secret);
  });

  it("masks the secret on GET (never returns it after creation)", async () => {
    await req(app, `/forms/${FORM_ID}/webhooks`, "POST", {
      url: "https://consumer.example.com/hook2",
    });
    const res = await req(app, `/forms/${FORM_ID}/webhooks`, "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      webhooks: Array<Record<string, unknown>>;
    };
    expect(body.webhooks.length).toBeGreaterThanOrEqual(2);
    for (const wh of body.webhooks) {
      expect(wh).not.toHaveProperty("secret");
      expect(wh.hasSecret).toBe(true);
    }
  });

  it("rotates the secret on explicit PUT (shown once, changes at rest); no reveal otherwise", async () => {
    const createRes = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", {
      url: "https://consumer.example.com/rotate",
    });
    const { webhookId, secret: original } = (await createRes.json()) as {
      webhookId: string;
      secret: string;
    };
    const originalRow = await getWebhook(testDb.db, FORM_ID, webhookId);

    // A plain update (url only) does NOT reveal or change the secret.
    const plain = await req(app, `/forms/${FORM_ID}/webhooks/${webhookId}`, "PUT", {
      url: "https://consumer.example.com/rotate-v2",
    });
    expect(plain.status).toBe(200);
    expect((await plain.json()) as Record<string, unknown>).not.toHaveProperty("secret");
    expect((await getWebhook(testDb.db, FORM_ID, webhookId))?.secretEncrypted).toBe(
      originalRow?.secretEncrypted,
    );

    // An explicit rotate reveals a NEW secret once and re-encrypts at rest.
    const rotate = await req(app, `/forms/${FORM_ID}/webhooks/${webhookId}`, "PUT", {
      rotateSecret: true,
    });
    const rotated = (await rotate.json()) as { secret?: string };
    expect(rotated.secret).toBeDefined();
    expect(rotated.secret).not.toBe(original);
    const rotatedRow = await getWebhook(testDb.db, FORM_ID, webhookId);
    expect(await decryptWebhookSecret(rotatedRow!.secretEncrypted, deps.config.keys.app)).toBe(
      rotated.secret,
    );
  });

  it("soft-deactivates on DELETE (row retained, active false)", async () => {
    const createRes = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", {
      url: "https://consumer.example.com/del",
    });
    const { webhookId } = (await createRes.json()) as { webhookId: string };

    const del = await req(app, `/forms/${FORM_ID}/webhooks/${webhookId}`, "DELETE");
    expect(del.status).toBe(200);
    expect((await del.json()) as { active: boolean }).toMatchObject({ active: false });

    const row = await getWebhook(testDb.db, FORM_ID, webhookId);
    expect(row?.active).toBe(false);
    expect(row?.deactivatedAt).toBeInstanceOf(Date);
  });

  it("404s create for a missing form and update/delete for a missing webhook", async () => {
    expect(
      (await req(app, `/forms/frm_nope/webhooks`, "POST", { url: "https://x.example.com/h" }))
        .status,
    ).toBe(404);
    expect(
      (await req(app, `/forms/${FORM_ID}/webhooks/whk_nope`, "PUT", { active: false })).status,
    ).toBe(404);
    expect((await req(app, `/forms/${FORM_ID}/webhooks/whk_nope`, "DELETE")).status).toBe(404);
  });

  it("requires admin auth (401 without a session marker)", async () => {
    const res = await app.request(`/admin/forms/${FORM_ID}/webhooks`, {
      method: "GET",
      headers: { "x-qcms-internal-token": internalToken },
    });
    expect(res.status).toBe(401);
  });
});

describe("SSRF guardrail (SEC-6): default-deny, override-allow", () => {
  const privateTargets = [
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://10.1.2.3/hook",
    "https://169.254.169.254/latest/meta-data",
    "http://consumer.example.com/hook", // plain http rejected by default too
  ];

  it("rejects private/reserved and non-https targets by default (422)", async () => {
    for (const url of privateTargets) {
      const res = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url });
      expect(res.status, `expected 422 for ${url}`).toBe(422);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "WEBHOOK_URL_REJECTED" },
      });
    }
  });

  it("allows private/http targets when QCMS_WEBHOOK_ALLOW_PRIVATE is set (on-prem override)", async () => {
    const onPrem = buildApp({ ...baseEnv, QCMS_WEBHOOK_ALLOW_PRIVATE: "true" });
    const res = await req(onPrem.app, `/forms/${FORM_ID}/webhooks`, "POST", {
      url: "http://10.1.2.3:9000/hook",
    });
    expect(res.status).toBe(201);
    const { secret } = (await res.json()) as { secret: string };
    expect(secret.startsWith("whsec_")).toBe(true);
  });
});
