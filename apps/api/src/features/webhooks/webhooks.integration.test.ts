/**
 * Webhook-config admin slice tests (task 024, SEC-6), driven through
 * `app.request()` against the 013 Testcontainers harness DB. Requires Docker.
 *
 * Covers exit criterion 3: webhook CRUD; the secret is shown exactly once (create
 * + explicit rotate) and masked on reads; SSRF cases (localhost, 10.x,
 * link-local) rejected by default and allowed under the override flag; and the
 * at-rest round-trip - the stored ciphertext decrypts back to the shown secret
 * (proving 025 can recover it to sign deliveries). Every app key is synthetic.
 */

import { FormId } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createForm,
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
// A real better-auth session row seeded per suite (031): the admin-auth
// middleware verifies it against the database, so a made-up marker no longer
// authenticates anything.
let adminSessionToken: string;
/** The account that token belongs to, which every propose below is the act of. */
let adminUserId: string;
// A fixed base env so the on-prem-override app shares the internal token and app
// key with the default app - only QCMS_WEBHOOK_ALLOW_PRIVATE varies.
let baseEnv: Record<string, string | undefined>;

/** Build an admin app over the shared db with the given env overrides. */
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

// --- request helpers --------------------------------------------------------

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
    // decrypts under QCMS_APP_KEY back to exactly the shown secret (SEC-6 - 025
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

  /**
   * One case per rejection reason, with the reason the envelope must carry (issue #756).
   *
   * The 422 has carried `details.reason` since task 024 and nothing asserted it, so
   * nothing stopped the field from being dropped or renamed. It is now read: the admin
   * picks one of four catalog sentences from it (`apps/admin/lib/forms/errors.ts`, the
   * half of #312 that PR #755 deferred), so the field is contract rather than colour and
   * this is the test that says so.
   *
   * `unsupported-scheme` has no `privateTargets` entry above because it is not an SSRF
   * case at all: `ftp://` is refused whatever the override says.
   */
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

  /**
   * SEC-8 and ADR-24 on the refusal envelope, asserted on the serialized bytes.
   *
   * Two promises, and the reason both are checked here rather than trusted: this body is
   * built from author input at a boundary that has just refused it, which is exactly the
   * shape that grows an echo ("the URL you sent was ..."). It carries no secret and no
   * echo of the request, and it names no environment variable - the two `allowPrivate`
   * messages used to end "set QCMS_WEBHOOK_ALLOW_PRIVATE for on-prem targets", and ADR-24
   * has been absolute since 2026-08-31.
   */
  it("echoes no secret, no request body and no flag name in the refusal (SEC-8, ADR-24)", async () => {
    for (const [, url] of REJECTIONS) {
      const res = await req(app, `/forms/${FORM_ID}/webhooks`, "POST", { url });
      const raw = await res.text();
      expect(raw, `for ${url}`).not.toContain("whsec_");
      expect(raw, `for ${url}`).not.toContain("QCMS_");
      // The refused URL itself: harmless here, but an envelope that starts quoting the
      // request is how a body comes to carry a credential in a query string.
      expect(raw, `for ${url}`).not.toContain(url);
      expect(Object.keys(JSON.parse(raw) as { error: object }).length).toBe(1);
    }
  });

  /**
   * Each refusal sentence claims only what its own check established.
   *
   * `https-required` shipped for one review round reading "must use https, because this
   * deployment does not allow private targets", which tells a consumer refused on a
   * public host to go looking for a private address their URL does not have. One flag
   * lifts both rules, so the sentence was reachable from the code and still wrong about
   * the caller. Nothing pinned the prose, which is why it drifted; this is the pin.
   *
   * Asserted as "does not mention privacy" rather than by matching the whole sentence:
   * the wording is allowed to improve, the false claim is not.
   */
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
  /** A second `forms.approver` holding `prod`: the account the rule needs. */
  let secondToken = "";
  let secondUserId = "";
  /** A `forms.viewer`, for Q58's masking of a **proposed** URL. */
  let viewerToken = "";

  const AGREED = "https://agreed-consumer.example/hook";
  const PROPOSED = "https://proposed-consumer.example/hook?token=not-a-real-credential";

  /** This suite's requests as one named account. */
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
    // A `202` rather than a `201`: the operator performed the same act and the answer is
    // "stored, waiting for a second approver" instead of "done".
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      pending: true;
      secret: string;
      proposal: { proposalId: string; webhookId: string; kind: string; rotatesSecret: boolean };
    };
    expect(body.pending).toBe(true);
    // The plaintext exists only at this moment, so it is revealed here (SEC-6) - and
    // nothing signs with it until the change applies, which is what `pending` says.
    expect(body.secret.startsWith("whsec_")).toBe(true);
    expect(body.proposal.kind).toBe("create");
    expect(body.proposal.rotatesSecret).toBe(true);

    // **Nothing live.** The endpoint does not exist yet, so the deliverer has nothing to
    // post to and the proposed URL receives nothing at all.
    expect(await getWebhook(testDb.db, FORM_ID, body.proposal.webhookId)).toBeUndefined();
    const list = await req(app, `/forms/${FORM_ID}/webhooks`, "GET");
    const rows = (await list.json()) as { webhooks: { webhookId: string }[] };
    expect(rows.webhooks.map((row) => row.webhookId)).not.toContain(body.proposal.webhookId);

    // Confirmed by the second account, the endpoint is created - with the id the proposal
    // minted, which is what makes a repeated apply idempotent.
    const confirmed = await as(
      secondToken,
      `/forms/${FORM_ID}/webhooks/proposals/${body.proposal.proposalId}/confirm`,
      "POST",
    );
    expect(confirmed.status).toBe(200);
    const stored = await getWebhook(testDb.db, FORM_ID, body.proposal.webhookId);
    expect(stored?.url).toBe(AGREED);
    // The secret that was shown once is the secret the endpoint now holds, which is what
    // makes a pending create usable at all (025 signs with it).
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
    // Still active: a deactivation stops a consumer an agreed configuration feeds, and
    // whether that is right is the question a second approver reads.
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

    // The pending list hands a stored URL to a caller who may not be allowed to set it,
    // which is the one property that decides whether a URL is masked. So it masks the
    // same way the endpoint list does.
    const asViewer = await as(viewerToken, `/forms/${FORM_ID}/webhooks/proposals`, "GET");
    expect(asViewer.status).toBe(200);
    const viewerRows = (await asViewer.json()) as { proposals: { url: string | null }[] };
    const viewerRow = viewerRows.proposals.find(() => true);
    expect(viewerRow?.url).toContain("(hidden)");
    expect(JSON.stringify(viewerRows)).not.toContain("not-a-real-credential");

    // And whole for an account that may configure it.
    const asApprover = await as(secondToken, `/forms/${FORM_ID}/webhooks/proposals`, "GET");
    const approverRows = (await asApprover.json()) as { proposals: { url: string | null }[] };
    expect(approverRows.proposals.some((row) => row.url === PROPOSED)).toBe(true);

    // Clean up so the next case starts with nothing pending on this endpoint.
    expect(
      (await as(secondToken, `/forms/${FORM_ID}/webhooks/proposals/${pendingId}`, "DELETE")).status,
    ).toBe(200);
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
      // Q61: both are filled in because the act names both.
      expect(row.environment).toBe("prod");
      expect(row.formId).toBe(FORM_ID);
      // The withdrawal is the second account's act, so the actor is that account.
      expect([adminUserId, secondUserId]).toContain(row.actor);
      // The URL stays out of the audit: a `forms.owner` reads the audit and Q58 never
      // gave that role an unmasked endpoint URL.
      expect(row.detail ?? "").not.toContain("agreed-consumer.example");
    }
  });
});
