import { FormId } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  confirmEndpointProposal,
  createForm,
  getEndpointProposal,
  getWebhook,
  listAccessAudit,
  setRequireSecondApprover,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { decryptWebhookSecret } from "./crypto.js";
import { registerWebhooks } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

const FORM_ID = FormId.parse("frm_webhooks_it");
let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let adminSessionToken: string;
let adminUserId: string;
let baseEnv: Record<string, string | undefined>;

function buildApp(env: Record<string, string | undefined>): {
  deps: Deps;
  app: ReturnType<typeof createApp>;
} {
  const d = makeDeps({ db: testDb.db, env });
  const a = createApp(d, ADMIN_ONLY, {
    groups: { admin: [registerAdminAuth, registerGrantCheck, registerWebhooks] },
  });
  return { deps: d, app: a };
}

beforeAll(async () => {
  testDb = await startTestDb();
  baseEnv = validEnv();
  ({ deps, app } = buildApp(baseEnv));
  internalToken = internalTokenFor(deps.config);
  const seeded = await seedAdminSession(testDb.db);
  adminSessionToken = seeded.token;
  adminUserId = seeded.userId;
  await createForm(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    formId: FORM_ID,
    slug: "webhooks-it",
    defaultLocale: "en",
  });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: adminSessionToken,
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

    const plain = await req(app, `/forms/${FORM_ID}/webhooks/${webhookId}`, "PUT", {
      url: "https://consumer.example.com/rotate-v2",
    });
    expect(plain.status).toBe(200);
    expect((await plain.json()) as Record<string, unknown>).not.toHaveProperty("secret");
    expect((await getWebhook(testDb.db, FORM_ID, webhookId))?.secretEncrypted).toBe(
      originalRow?.secretEncrypted,
    );

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
    "http://consumer.example.com/hook",
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

  // `unsupported-scheme` is absent from `privateTargets` above because it is refused
  // whatever the override says.
  const REJECTIONS: readonly (readonly [string, string])[] = [
    ["not-a-url", "example.com/hook"],
    ["unsupported-scheme", "ftp://consumer.example.com/hook"],
    ["https-required", "http://consumer.example.com/hook"],
    ["private-host", "https://169.254.169.254/latest/meta-data"],
  ];

  it("names which rule the target broke, in a closed enum", async () => {
    for (const [reason, url] of REJECTIONS) {
      const res = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url });
      expect(res.status, `expected 422 for ${url}`).toBe(422);
      const body = (await res.json()) as { error: { details?: Record<string, unknown> } };
      expect(body.error.details, `expected reason ${reason} for ${url}`).toStrictEqual({ reason });
    }
  });

  it("echoes no secret, no request body and no flag name in the refusal (SEC-8, ADR-24)", async () => {
    for (const [, url] of REJECTIONS) {
      const res = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url });
      const raw = await res.text();
      expect(raw, `for ${url}`).not.toContain("whsec_");
      expect(raw, `for ${url}`).not.toContain("QCMS_");
      // An envelope that quotes the request is how a body comes to carry a credential
      // out of a query string.
      expect(raw, `for ${url}`).not.toContain(url);
      expect(Object.keys(JSON.parse(raw) as { error: object }).length).toBe(1);
    }
  });

  it("does not tell an https refusal it was refused for being private", async () => {
    const res = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", {
      url: "http://consumer.example.com/hook",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { message: string; details?: { reason?: string } };
    };
    expect(body.error.details?.reason).toBe("https-required");
    expect(body.error.message).toContain("https");
    expect(body.error.message.toLowerCase()).not.toContain("private");
    expect(body.error.message.toLowerCase()).not.toContain("reserved");
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

describe("the pending `prod` endpoint change (task 070, Q30, Q51)", () => {
  let secondToken = "";
  let secondUserId = "";
  let viewerToken = "";

  const AGREED = "https://agreed-consumer.example/hook";
  const PROPOSED = "https://proposed-consumer.example/hook?token=not-a-real-credential";

  async function as(
    token: string,
    path: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    return app.request(`/admin${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalToken,
        [ADMIN_SESSION_HEADER]: token,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  beforeAll(async () => {
    const second = await seedAdminSession(testDb.db, { label: "second-approver" });
    secondToken = second.token;
    secondUserId = second.userId;
    const viewer = await seedAdminSession(testDb.db, {
      label: "pending-viewer",
      claim: false,
      owner: false,
      grants: ["forms.viewer"],
    });
    viewerToken = viewer.token;
    await setRequireSecondApprover(testDb.db, SEED_WORKSPACE_ID, true);
  });

  afterAll(async () => {
    await setRequireSecondApprover(testDb.db, SEED_WORKSPACE_ID, false);
  });

  it("holds a new prod endpoint pending, with its secret shown once and nothing live", async () => {
    const res = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url: AGREED });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      pending: true;
      secret: string;
      proposal: { proposalId: string; webhookId: string; kind: string; rotatesSecret: boolean };
    };
    expect(body.pending).toBe(true);
    expect(body.secret.startsWith("whsec_")).toBe(true);
    expect(body.proposal.kind).toBe("create");
    expect(body.proposal.rotatesSecret).toBe(true);

    expect(await getWebhook(testDb.db, FORM_ID, body.proposal.webhookId)).toBeUndefined();
    const list = await req(app, `/forms/${FORM_ID}/webhooks`, "GET");
    const rows = (await list.json()) as { webhooks: { webhookId: string }[] };
    expect(rows.webhooks.map((row) => row.webhookId)).not.toContain(body.proposal.webhookId);

    const confirmed = await as(
      secondToken,
      `/forms/${FORM_ID}/webhooks/proposals/${body.proposal.proposalId}/confirm`,
      "POST",
    );
    expect(confirmed.status).toBe(200);
    const stored = await getWebhook(testDb.db, FORM_ID, body.proposal.webhookId);
    expect(stored?.url).toBe(AGREED);
    expect(await decryptWebhookSecret(stored!.secretEncrypted, deps.config.keys.app)).toBe(
      body.secret,
    );
  });

  it("holds a deactivation pending, so the endpoint keeps delivering until it is agreed", async () => {
    const created = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url: AGREED });
    const first = (await created.json()) as { proposal: { proposalId: string; webhookId: string } };
    await as(
      secondToken,
      `/forms/${FORM_ID}/webhooks/proposals/${first.proposal.proposalId}/confirm`,
      "POST",
    );
    const webhookId = first.proposal.webhookId;

    const removed = await req(app, `/forms/${FORM_ID}/webhooks/${webhookId}`, "DELETE");
    expect(removed.status).toBe(202);
    const pending = (await removed.json()) as { proposal: { proposalId: string; kind: string } };
    expect(pending.proposal.kind).toBe("deactivate");
    expect((await getWebhook(testDb.db, FORM_ID, webhookId))?.active).toBe(true);

    const confirmed = await as(
      secondToken,
      `/forms/${FORM_ID}/webhooks/proposals/${pending.proposal.proposalId}/confirm`,
      "POST",
    );
    expect(confirmed.status).toBe(200);
    expect((await getWebhook(testDb.db, FORM_ID, webhookId))?.active).toBe(false);
  });

  it("masks a proposed URL's query string for a `forms.viewer` (Q58)", async () => {
    const created = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url: AGREED });
    const first = (await created.json()) as { proposal: { proposalId: string; webhookId: string } };
    await as(
      secondToken,
      `/forms/${FORM_ID}/webhooks/proposals/${first.proposal.proposalId}/confirm`,
      "POST",
    );
    const proposed = await req(
      app,
      `/forms/${FORM_ID}/webhooks/${first.proposal.webhookId}`,
      "PUT",
      {
        url: PROPOSED,
      },
    );
    expect(proposed.status).toBe(202);
    const pendingId = ((await proposed.json()) as { proposal: { proposalId: string } }).proposal
      .proposalId;

    const asViewer = await as(viewerToken, `/forms/${FORM_ID}/webhooks/proposals`, "GET");
    expect(asViewer.status).toBe(200);
    const viewerRows = (await asViewer.json()) as { proposals: { url: string | null }[] };
    const viewerRow = viewerRows.proposals.find(() => true);
    expect(viewerRow?.url).toContain("(hidden)");
    expect(JSON.stringify(viewerRows)).not.toContain("not-a-real-credential");

    const asApprover = await as(secondToken, `/forms/${FORM_ID}/webhooks/proposals`, "GET");
    const approverRows = (await asApprover.json()) as { proposals: { url: string | null }[] };
    expect(approverRows.proposals.some((row) => row.url === PROPOSED)).toBe(true);

    // Leaves nothing pending on this endpoint for the next case.
    expect(
      (await as(secondToken, `/forms/${FORM_ID}/webhooks/proposals/${pendingId}`, "DELETE")).status,
    ).toBe(200);
  });

  it("withdraws a confirmed change whose apply never landed, and frees the endpoint", async () => {
    // `confirmed_at` set with `applied_at` null is written by hand here: it is what a
    // confirmation whose endpoint write failed leaves behind.
    const created = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url: AGREED });
    const first = (await created.json()) as { proposal: { proposalId: string; webhookId: string } };
    await as(
      secondToken,
      `/forms/${FORM_ID}/webhooks/proposals/${first.proposal.proposalId}/confirm`,
      "POST",
    );
    const webhookId = first.proposal.webhookId;

    const stuck = await req(app, `/forms/${FORM_ID}/webhooks/${webhookId}`, "PUT", {
      url: PROPOSED,
    });
    expect(stuck.status).toBe(202);
    const stuckId = ((await stuck.json()) as { proposal: { proposalId: string } }).proposal
      .proposalId;
    await confirmEndpointProposal(testDb.db, {
      proposalId: stuckId,
      confirmedBy: secondUserId,
      confirmedAt: new Date("2026-10-22T00:00:00.000Z"),
    });

    const blocked = await req(app, `/forms/${FORM_ID}/webhooks/${webhookId}`, "PUT", {
      url: "https://third-consumer.example/hook",
    });
    expect(blocked.status).toBe(409);

    const withdrawn = await as(
      secondToken,
      `/forms/${FORM_ID}/webhooks/proposals/${stuckId}`,
      "DELETE",
    );
    expect(withdrawn.status).toBe(200);
    expect((await getWebhook(testDb.db, FORM_ID, webhookId))?.url).toBe(AGREED);
    const row = await getEndpointProposal(testDb.db, stuckId);
    expect(row?.confirmedBy).toBe(secondUserId);
    expect(row?.withdrawnBy).toBe(secondUserId);
    expect(row?.appliedAt).toBeNull();

    const freed = await req(app, `/forms/${FORM_ID}/webhooks/${webhookId}`, "PUT", {
      url: "https://fourth-consumer.example/hook",
    });
    expect(freed.status).toBe(202);
    const freedId = ((await freed.json()) as { proposal: { proposalId: string } }).proposal
      .proposalId;
    expect(
      (await as(secondToken, `/forms/${FORM_ID}/webhooks/proposals/${freedId}`, "DELETE")).status,
    ).toBe(200);
  });

  it("answers both of two concurrent resumes of a `create` cleanly (review finding 7)", async () => {
    const created = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url: AGREED });
    const proposal = (await created.json()) as {
      proposal: { proposalId: string; webhookId: string };
    };
    await confirmEndpointProposal(testDb.db, {
      proposalId: proposal.proposal.proposalId,
      confirmedBy: secondUserId,
      confirmedAt: new Date("2026-10-22T00:00:00.000Z"),
    });

    const [left, right] = await Promise.all([
      as(
        secondToken,
        `/forms/${FORM_ID}/webhooks/proposals/${proposal.proposal.proposalId}/confirm`,
        "POST",
      ),
      as(
        secondToken,
        `/forms/${FORM_ID}/webhooks/proposals/${proposal.proposal.proposalId}/confirm`,
        "POST",
      ),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 200]);
    expect((await getWebhook(testDb.db, FORM_ID, proposal.proposal.webhookId))?.url).toBe(AGREED);
    expect(
      (await getEndpointProposal(testDb.db, proposal.proposal.proposalId))?.appliedAt,
    ).not.toBeNull();

    // The two-account rule still holds after the apply: the proposer is refused even on
    // an applied row.
    const byProposer = await req(
      app,
      `/forms/${FORM_ID}/webhooks/proposals/${proposal.proposal.proposalId}/confirm`,
      "POST",
    );
    expect(byProposer.status).toBe(403);
    expect(((await byProposer.json()) as { error: { code: string } }).error.code).toBe(
      "PROPOSER_CANNOT_CONFIRM",
    );
  });

  it("writes one SEC-15 `setting` row per act, with the environment and the form (Q61)", async () => {
    const before = await listAccessAudit(testDb.db, SEED_WORKSPACE_ID, { kind: "setting" });
    const created = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url: AGREED });
    const proposalId = ((await created.json()) as { proposal: { proposalId: string } }).proposal
      .proposalId;
    expect(
      (await as(secondToken, `/forms/${FORM_ID}/webhooks/proposals/${proposalId}`, "DELETE"))
        .status,
    ).toBe(200);

    const after = await listAccessAudit(testDb.db, SEED_WORKSPACE_ID, { kind: "setting" });
    const added = after.rows.filter((row) => !before.rows.some((old) => old.id === row.id));
    expect(added).toHaveLength(2);
    const details = added.map((row) => row.detail ?? "").join("\n");
    expect(details).toContain("act=propose");
    expect(details).toContain("act=withdraw");
    for (const row of added) {
      expect(row.environment).toBe("prod");
      expect(row.formId).toBe(FORM_ID);
      expect([adminUserId, secondUserId]).toContain(row.actor);
      // A `forms.owner` reads the audit and is never shown an unmasked endpoint URL.
      expect(row.detail ?? "").not.toContain("agreed-consumer.example");
    }
  });
});
