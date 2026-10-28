import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminLogin,
  AdminClient,
  MOUNT,
  RespondentClient,
  type Receipt,
  type StartBody,
  buildEnv,
  composeApi,
  drainWebhooks,
  seedInsuranceForm,
  startTestDb,
  type TestDb,
  verifyWebhookSignature,
  WebhookReceiver,
} from "../support/index.js";
import { INTERNAL_TOKEN_HEADER } from "./surfaces.js";

const receiver = new WebhookReceiver();

let testDb: TestDb;
let composed: ReturnType<typeof composeApi>;
let admin: AdminClient;
let respondent: RespondentClient;
let formId: string;
let formSlug: string;
let webhookId: string;
let firstSecret: string;
let adminToken: string;

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await composed.app.request(`/admin${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      [INTERNAL_TOKEN_HEADER]: composed.internalToken,
      "x-qcms-admin-session": adminToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, text: await res.text() };
}

beforeAll(async () => {
  testDb = await startTestDb();
  await receiver.start();
  composed = composeApi(testDb.db, buildEnv(), MOUNT.all);
  adminToken = await adminLogin(testDb.db);
  admin = new AdminClient(composed.app, composed.internalToken, adminToken);
  respondent = new RespondentClient(composed.app, composed.internalToken);
  ({ formId, slug: formSlug } = await seedInsuranceForm(testDb.db));

  const hook = await admin.createWebhook<{ webhookId: string; secret: string }>(formId, {
    url: receiver.url("/hook"),
  });
  expect(hook.status).toBe(201);
  webhookId = hook.body.webhookId;
  firstSecret = hook.body.secret;
  expect(firstSecret).toMatch(/^whsec_/);
});

afterAll(async () => {
  await receiver.stop();
  await testDb?.teardown();
});

const REQUIRED_HEADERS: readonly (readonly [string, RegExp])[] = [
  ["content-security-policy", /(^|;\s*)frame-ancestors 'none'/],
  ["content-security-policy", /(^|;\s*)default-src 'none'/],
  ["x-content-type-options", /^nosniff$/],
  ["referrer-policy", /^no-referrer$/],
  ["x-frame-options", /^DENY$/],
];

describe("SEC-9 response headers are set on every API response", () => {
  const responses: { label: string; get: () => Response | Promise<Response> }[] = [
    { label: "a served health check", get: () => composed.app.request("/health") },
    {
      label: "an unauthenticated refusal",
      get: () => composed.app.request("/admin/forms"),
    },
    {
      label: "a route that does not exist",
      get: () => composed.app.request("/no/such/route"),
    },
    {
      label: "a served respondent call",
      get: () =>
        composed.app.request("/sessions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [INTERNAL_TOKEN_HEADER]: composed.internalToken,
          },
          body: JSON.stringify({ formSlug }),
        }),
    },
  ];

  for (const { label, get } of responses) {
    it.each(REQUIRED_HEADERS.map(([name, pattern]) => [name, pattern] as const))(
      `${label} carries %s`,
      async (name: string, pattern: RegExp) => {
        const res = await get();
        const value = res.headers.get(name);
        expect(value, `${name} absent on ${label}`).not.toBeNull();
        expect(value as string).toMatch(pattern);
      },
    );
  }

  it("carries no CSP source list that could hold unsafe-inline", async () => {
    const csp = (await composed.app.request("/health")).headers.get("content-security-policy");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("does not emit HSTS: the ingress owns it (SEC-9, ADR-20)", async () => {
    const res = await composed.app.request("/health");
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });
});

describe("the API sets no CORS header on any response (SEC-9)", () => {
  const CORS_HEADERS = [
    "access-control-allow-origin",
    "access-control-allow-credentials",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-expose-headers",
    "access-control-max-age",
  ];

  it.each(CORS_HEADERS)("never sets %s on a served response", async (header) => {
    const res = await composed.app.request("/health", {
      headers: { origin: "https://attacker.example" },
    });
    expect(res.headers.get(header)).toBeNull();
  });

  it("answers a preflight with no CORS grant at all", async () => {
    const res = await composed.app.request("/admin/forms", {
      method: "OPTIONS",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
      },
    });
    for (const header of CORS_HEADERS) {
      expect(res.headers.get(header), `preflight granted ${header}`).toBeNull();
    }
  });
});

describe("request body size limit (SEC-9)", () => {
  it("accepts a body inside the limit", async () => {
    const res = await composed.app.request("/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_TOKEN_HEADER]: composed.internalToken,
      },
      body: JSON.stringify({ formSlug }),
    });
    expect(res.status).toBe(201);
  });

  it("refuses a body over the configured cap with 413", async () => {
    const oversize = JSON.stringify({ formSlug, padding: "x".repeat(1_100_000) });
    expect(oversize.length).toBeGreaterThan(composed.deps.config.bodyLimitBytes);
    const res = await composed.app.request("/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_TOKEN_HEADER]: composed.internalToken,
      },
      body: oversize,
    });
    expect(res.status).toBe(413);
  });

  it("applies the cap before the credential gate, so an unauthenticated flood is cheap", async () => {
    const oversize = JSON.stringify({ padding: "x".repeat(1_100_000) });
    const res = await composed.app.request("/admin/forms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversize,
    });
    expect(res.status).toBe(413);
  });
});

describe("respondent credentials never travel as cookies from the API", () => {
  it("returns the session token in the body and sets no cookie", async () => {
    const res = await composed.app.request("/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_TOKEN_HEADER]: composed.internalToken,
      },
      body: JSON.stringify({ formSlug }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toContain("sessionToken");
  });
});

describe("refusals carry no internal detail", () => {
  it("never returns a stack trace or a file path in an error body", async () => {
    const probes = [
      composed.app.request("/admin/forms"),
      composed.app.request("/sessions/ses_nope/step", {
        headers: { [INTERNAL_TOKEN_HEADER]: composed.internalToken },
      }),
      composed.app.request("/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [INTERNAL_TOKEN_HEADER]: composed.internalToken,
        },
        body: "{ not json",
      }),
    ];
    for (const promise of probes) {
      const text = await (await promise).text();
      expect(text).not.toMatch(/\bat .+\.(ts|js):\d+/);
      expect(text).not.toContain("node_modules");
      expect(text).not.toContain(composed.internalToken);
    }
  });
});

// `X-QCMS-Timestamp` is unix seconds as a decimal string, not an ISO instant.
function sentAt(timestamp: string): Date {
  expect(timestamp).toMatch(/^\d{10}$/);
  return new Date(Number(timestamp) * 1_000);
}

// The verification `docs/webhooks.md` tells a consumer to implement.
function consumerAccepts(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
  now: Date,
  skewMs = 5 * 60 * 1_000,
): boolean {
  const age = now.getTime() - Number(timestamp) * 1_000;
  if (!Number.isFinite(age) || Math.abs(age) > skewMs) return false;
  return verifyWebhookSignature(secret, timestamp, body, signature);
}

async function submitOnce(): Promise<void> {
  const start = await respondent.start<StartBody>({ formSlug });
  expect(start.status).toBe(201);
  const { sessionId, sessionToken } = start.body;
  const answered = await respondent.answer(sessionId, sessionToken, "q_at_fault_accident", false);
  expect(answered.status).toBe(200);
  const receipt = await respondent.submit<Receipt>(sessionId, sessionToken);
  expect(receipt.status).toBe(200);
}

describe("SEC-6 webhook signatures", () => {
  let firstDelivery: { timestamp: string; signature: string; body: string };

  it("delivers exactly one signature the documented recipe accepts", async () => {
    receiver.reset();
    await submitOnce();
    const metrics = await drainWebhooks(composed.deps);
    expect(metrics.delivered).toBe(1);

    const hits = receiver.received.filter((r) => r.path === "/hook");
    expect(hits).toHaveLength(1);
    const req = hits[0] as (typeof hits)[number];

    const raw = req.headers["x-qcms-signature"];
    // A dual-signing window would need two headers or a comma list here.
    expect(Array.isArray(raw)).toBe(false);
    const signature = req.header("x-qcms-signature") as string;
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(signature).not.toContain(",");

    const timestamp = req.header("x-qcms-timestamp") as string;
    firstDelivery = { timestamp, signature, body: req.body };
    expect(consumerAccepts(firstSecret, timestamp, req.body, signature, sentAt(timestamp))).toBe(
      true,
    );
  });

  it("rejects a tampered body", () => {
    const { timestamp, signature, body } = firstDelivery;
    expect(consumerAccepts(firstSecret, timestamp, `${body} `, signature, sentAt(timestamp))).toBe(
      false,
    );
  });

  it("rejects a tampered timestamp", () => {
    const { timestamp, signature, body } = firstDelivery;
    const shifted = String(Number(timestamp) + 1);
    expect(consumerAccepts(firstSecret, shifted, body, signature, sentAt(shifted))).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const { timestamp, signature, body } = firstDelivery;
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;
    expect(consumerAccepts(firstSecret, timestamp, body, flipped, sentAt(timestamp))).toBe(false);
  });

  it("rejects a replay outside the 5-minute skew bound, byte-identical though it is", () => {
    const { timestamp, signature, body } = firstDelivery;
    const later = new Date(sentAt(timestamp).getTime() + 6 * 60 * 1_000);
    expect(verifyWebhookSignature(firstSecret, timestamp, body, signature)).toBe(true);
    expect(consumerAccepts(firstSecret, timestamp, body, signature, later)).toBe(false);
  });

  it("rejects a signature from another webhook's secret", () => {
    const { timestamp, signature, body } = firstDelivery;
    expect(
      consumerAccepts(
        "whsec_someone_elses_secret_value",
        timestamp,
        body,
        signature,
        sentAt(timestamp),
      ),
    ).toBe(false);
  });

  it("re-issuing a secret is a hard cutover: the old secret stops verifying, with no overlap", async () => {
    const rotated = await adminRequest("PUT", `/forms/${formId}/webhooks/${webhookId}`, {
      rotateSecret: true,
    });
    expect(rotated.status).toBe(200);
    const secondSecret = (JSON.parse(rotated.text) as { secret: string }).secret;
    expect(secondSecret).not.toBe(firstSecret);

    receiver.reset();
    await submitOnce();
    const metrics = await drainWebhooks(composed.deps);
    expect(metrics.delivered).toBe(1);

    const hits = receiver.received.filter((r) => r.path === "/hook");
    expect(hits).toHaveLength(1);
    const req = hits[0] as (typeof hits)[number];
    const timestamp = req.header("x-qcms-timestamp") as string;
    const signature = req.header("x-qcms-signature") as string;

    expect(consumerAccepts(secondSecret, timestamp, req.body, signature, sentAt(timestamp))).toBe(
      true,
    );
    // No overlap window: a consumer still holding the previous secret fails every
    // delivery until the operator hands over the new one.
    expect(consumerAccepts(firstSecret, timestamp, req.body, signature, sentAt(timestamp))).toBe(
      false,
    );
    expect(signature.split("v1=")).toHaveLength(2);
  });

  it("keeps the secret out of every listing (shown once, SEC-6)", async () => {
    const listed = await adminRequest("GET", `/forms/${formId}/webhooks`);
    expect(listed.status).toBe(200);
    expect(listed.text).not.toContain(firstSecret);
    expect(listed.text).not.toMatch(/whsec_/);
  });
});
