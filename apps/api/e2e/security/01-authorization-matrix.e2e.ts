/**
 * Two disciplines here are load-bearing. The positive controls run first, because a
 * typo'd path is a 404 that reads as a pass; and each negative block removes exactly one
 * credential from a complete set, so a red attributes to that predicate.
 *
 * With the channel token alone `POST /sessions` by form slug succeeds, which is how the
 * portal starts an anonymous session; that row's control is rate limiting, not
 * authentication.
 */

import { Buffer } from "node:buffer";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SEED_WORKSPACE_ID } from "@roonga/qcms-db/testing";
import { FormId } from "@roonga/qcms-core";
import {
  addAccessGroupHolder,
  authOrganization,
  createAccessGroup,
  createForm,
  ensureWorkspaceMember,
  getReleasedVersion,
  getWebhook,
  insertFormVersion,
  listAccessAudit,
  setRequireSecondApprover,
} from "@roonga/qcms-db";

import { REQUEST_ENVIRONMENT_HEADER } from "../../src/middleware/request-environment.js";
import { seedAdminSession, seedGrants, synthSecret } from "../../src/test-support.js";
import {
  adminLogin,
  AdminClient,
  MOUNT,
  RespondentClient,
  type StartBody,
  buildEnv,
  composeApi,
  mintInsuranceLink,
  publishInsuranceVersion,
  seedInsuranceForm,
  startTestDb,
  type TestDb,
} from "../support/index.js";
import {
  ADMIN_SURFACES,
  GATED_SURFACES,
  INTERNAL_TOKEN_HEADER,
  type PathContext,
  READ_CONTROL_SURFACES,
  SURFACES,
  type Surface,
  probe,
} from "./surfaces.js";

const ADMIN_SESSION_HEADER = "x-qcms-admin-session";
const LINK_ID = "lnk_matrix_probe";
const LINK_EXPIRY = new Date("2026-08-20T00:00:00.000Z");

let testDb: TestDb;
let all: ReturnType<typeof composeApi>;
let publicOnly: ReturnType<typeof composeApi>;
let internalToken: string;
let adminToken: string;
let ctx: PathContext;
let sessionToken: string;
let otherSessionToken: string;
let linkToken: string;
let otherFormId: string;
let otherFormSessionId: string;
/** The same database and forms, composed with every key list rotated (SEC-7). */
let rotated: ReturnType<typeof composeApi>;
/** The head (signing) entry of each rotated list. */
let freshInternalToken: string;
let probeTeamId: string;
let probeHolderId: string;

/** A complete credential set for an admin surface. Negative cases subtract from this. */
function adminHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [INTERNAL_TOKEN_HEADER]: internalToken,
    [ADMIN_SESSION_HEADER]: adminToken,
    ...overrides,
  };
}

function respondentHeaders(bearer: string = sessionToken): Record<string, string> {
  return {
    [INTERNAL_TOKEN_HEADER]: internalToken,
    authorization: `Bearer ${bearer}`,
  };
}

/** A refusal must not be a data leak. */
function expectNoPayload(text: string): void {
  expect(text).not.toMatch(/"answers"|"step"|"documents"|"sessionToken"|"secret"/);
}

beforeAll(async () => {
  testDb = await startTestDb();
  // One env for both compositions, so the public-only process shares the admin process's
  // tokens and keys.
  const env = buildEnv();
  all = composeApi(testDb.db, env, MOUNT.all);
  publicOnly = composeApi(testDb.db, env, MOUNT.publicOnly);
  internalToken = all.internalToken;
  adminToken = await adminLogin(testDb.db);

  const { formId, slug } = await seedInsuranceForm(testDb.db);
  const respondent = new RespondentClient(all.app, internalToken);
  const a = await respondent.start<StartBody>({ formSlug: slug });
  const b = await respondent.start<StartBody>({ formSlug: slug });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  sessionToken = a.body.sessionToken;
  otherSessionToken = b.body.sessionToken;

  linkToken = await mintInsuranceLink(testDb.db, all.deps.config, formId, {
    linkId: LINK_ID,
    expiresAt: LINK_EXPIRY,
  });

  // A fresh key at the head of every list with the original retained behind it: SEC-7's
  // "first entry signs, all entries verify" as a running process.
  freshInternalToken = synthSecret();
  rotated = composeApi(
    testDb.db,
    {
      ...env,
      QCMS_SESSION_KEYS: `${synthSecret()},${env.QCMS_SESSION_KEYS ?? ""}`,
      QCMS_LINK_KEYS: `${synthSecret()},${env.QCMS_LINK_KEYS ?? ""}`,
      QCMS_INTERNAL_TOKEN: `${freshInternalToken},${env.QCMS_INTERNAL_TOKEN ?? ""}`,
    },
    MOUNT.all,
  );

  const admin = new AdminClient(all.app, internalToken, adminToken);

  // Created through the admin surface rather than by `seedInsuranceForm`, which would
  // re-seed the library questions and collide on their primary key.
  otherFormId = "frm_other_tenant";
  const otherForm = await admin.createForm({
    formId: otherFormId,
    slug: "other-tenant",
    defaultLocale: "en",
  });
  expect(otherForm.status).toBe(201);
  await publishInsuranceVersion(testDb.db, otherFormId);
  const otherSession = await respondent.start<StartBody>({ formSlug: "other-tenant" });
  expect(otherSession.status).toBe(201);
  otherFormSessionId = otherSession.body.sessionId;
  // Submitted, so the positive control below is genuinely servable and the cross-form
  // refusals mean something.
  const answered = await respondent.answer(
    otherFormSessionId,
    otherSession.body.sessionToken,
    "q_at_fault_accident",
    false,
  );
  expect(answered.status).toBe(200);
  expect((await respondent.submit(otherFormSessionId, otherSession.body.sessionToken)).status).toBe(
    200,
  );

  const webhook = await admin.createWebhook<{ webhookId: string }>(formId, {
    url: "https://consumer.example/hook",
  });
  expect(webhook.status).toBe(201);

  // Written through `seedGrants` rather than the membership endpoints: these probes are
  // about the gates in front of those endpoints, and a fixture built by the thing under
  // test proves less.
  const holder = await seedAdminSession(testDb.db, { label: "probe-holder", claim: false });
  probeHolderId = holder.userId;
  const seeded = await seedGrants(testDb.db, {
    userId: holder.userId,
    workspaceId: SEED_WORKSPACE_ID,
    grants: ["forms.viewer"],
    owner: false,
  });
  probeTeamId = seeded.teamIds["forms.viewer"] as string;

  ctx = {
    formId,
    formSlug: slug,
    sessionId: a.body.sessionId,
    otherSessionId: b.body.sessionId,
    linkId: LINK_ID,
    webhookId: webhook.body.webhookId,
    // No delivery exists yet; every probe against this path runs under a credential the
    // gate refuses before any handler resolves the id.
    deliveryId: "dlv_matrix_probe",
    questionId: "q_at_fault_accident",
    // Real ids, so a probe cannot pass because the handler refused an id that does not
    // exist where a gate had failed.
    workspaceId: SEED_WORKSPACE_ID,
    teamId: probeTeamId,
    holderId: probeHolderId,
  };
});

afterAll(async () => {
  await testDb?.teardown();
});

describe("positive control: the fully credentialed caller is served", () => {
  it.each(READ_CONTROL_SURFACES.map((s) => [s.name, s] as const))(
    "%s answers 2xx for an admin with a live 2FA session",
    async (_name, surface: Surface) => {
      const res = await probe(all.app, surface, ctx, adminHeaders());
      expect(res.status).toBeLessThan(300);
    },
  );

  it("serves session A its own step with its own bearer", async () => {
    const step = SURFACES.find((s) => s.name === "GET /sessions/{id}/step");
    expect(step).toBeDefined();
    const res = await probe(all.app, step as Surface, ctx, respondentHeaders());
    expect(res.status).toBe(200);
    expect(res.text).toContain("flowState");
  });

  it("health and readiness answer with no credential at all", async () => {
    for (const surface of SURFACES.filter((s) => s.group === "health")) {
      const res = await probe(all.app, surface, ctx, {});
      expect(res.status).toBe(200);
    }
  });
});

describe("no credential at all", () => {
  it.each(GATED_SURFACES.map((s) => [s.name, s] as const))(
    "%s is refused 401 before any handler runs",
    async (_name, surface: Surface) => {
      const res = await probe(all.app, surface, ctx, {});
      expect(res.status).toBe(401);
      expect(res.text).toContain('"unauthorized"');
      expectNoPayload(res.text);
    },
  );
});

describe("wrong internal service token", () => {
  it.each(GATED_SURFACES.map((s) => [s.name, s] as const))(
    "%s is refused 401 (SEC-4 channel gate, constant-time compare)",
    async (_name, surface: Surface) => {
      const res = await probe(all.app, surface, ctx, {
        [INTERNAL_TOKEN_HEADER]: "wrong-internal-token-of-adequate-length-000000",
        [ADMIN_SESSION_HEADER]: adminToken,
        authorization: `Bearer ${sessionToken}`,
      });
      expect(res.status).toBe(401);
      expectNoPayload(res.text);
    },
  );

  it("refuses an empty internal token header as firmly as a missing one", async () => {
    const surface = READ_CONTROL_SURFACES[0] as Surface;
    const res = await probe(all.app, surface, ctx, {
      [INTERNAL_TOKEN_HEADER]: "",
      [ADMIN_SESSION_HEADER]: adminToken,
    });
    expect(res.status).toBe(401);
  });
});

describe("internal service token alone grants nothing", () => {
  const identityBearing = GATED_SURFACES.filter((s) => !s.anonymousReachable && s.group !== "auth");

  it.each(identityBearing.map((s) => [s.name, s] as const))(
    "%s is refused 401 with only the channel token",
    async (_name, surface: Surface) => {
      const res = await probe(all.app, surface, ctx, {
        [INTERNAL_TOKEN_HEADER]: internalToken,
      });
      expect(res.status).toBe(401);
      expectNoPayload(res.text);
    },
  );

  it("does still let an anonymous respondent start a session (the documented exception)", async () => {
    const surface = SURFACES.find((s) => s.name === "POST /sessions (anonymous, by form slug)");
    const res = await probe(all.app, surface as Surface, ctx, {
      [INTERNAL_TOKEN_HEADER]: internalToken,
    });
    // The channel token opens the channel; this row is open to anonymous callers.
    expect(res.status).toBe(201);
  });
});

describe("admin session credentials that must not authenticate", () => {
  const cases: readonly (readonly [string, () => Promise<string>])[] = [
    ["an unknown session token", () => Promise.resolve("ses_not_a_real_admin_session_token")],
    ["an empty session header", () => Promise.resolve("")],
    [
      "a session row past its own expiry",
      async () =>
        (await seedAdminSession(testDb.db, { expiresInMs: -1_000, label: "expired" })).token,
    ],
    [
      "a session past the 12h absolute lifetime",
      async () =>
        (
          await seedAdminSession(testDb.db, {
            at: new Date("2026-07-18T00:00:00.000Z"),
            expiresInMs: 30 * 24 * 60 * 60 * 1_000,
            label: "ancient",
          })
        ).token,
    ],
    [
      "a session whose account never enrolled a second factor",
      async () =>
        (await seedAdminSession(testDb.db, { twoFactorEnabled: false, label: "no2fa" })).token,
    ],
  ];

  it.each(cases.map(([label, make]) => [label, make] as const))(
    "%s is refused on every admin surface",
    async (_label, make: () => Promise<string>) => {
      const token = await make();
      for (const surface of ADMIN_SURFACES) {
        const res = await probe(
          all.app,
          surface,
          ctx,
          adminHeaders({ [ADMIN_SESSION_HEADER]: token }),
        );
        expect(res.status, `${surface.name} accepted a credential it must refuse`).toBe(401);
        expectNoPayload(res.text);
      }
    },
  );

  it("gives the same refusal for an unknown token as for an expired one (no oracle)", async () => {
    const surface = READ_CONTROL_SURFACES[0] as Surface;
    const unknown = await probe(
      all.app,
      surface,
      ctx,
      adminHeaders({ [ADMIN_SESSION_HEADER]: "ses_unknown" }),
    );
    const expired = await probe(
      all.app,
      surface,
      ctx,
      adminHeaders({
        [ADMIN_SESSION_HEADER]: (
          await seedAdminSession(testDb.db, { expiresInMs: -1_000, label: "oracle" })
        ).token,
      }),
    );
    expect(unknown.status).toBe(expired.status);
    expect(unknown.text).toBe(expired.text);
  });
});

describe("a public-only process has no admin surface at all", () => {
  it.each(ADMIN_SURFACES.map((s) => [s.name, s] as const))(
    "%s is 404 (not 403) even with a complete admin credential set",
    async (_name, surface: Surface) => {
      const res = await probe(publicOnly.app, surface, ctx, adminHeaders());
      expect(res.status).toBe(404);
      expectNoPayload(res.text);
    },
  );

  it("has no identity provider either: sign-in is 404, not 401", async () => {
    const signIn = SURFACES.find((s) => s.name === "POST /api/auth/sign-in/email") as Surface;
    const res = await probe(publicOnly.app, signIn, ctx, adminHeaders());
    expect(res.status).toBe(404);
  });

  it("still serves the respondent loop it does mount", async () => {
    const step = SURFACES.find((s) => s.name === "GET /sessions/{id}/step") as Surface;
    const res = await probe(publicOnly.app, step, ctx, respondentHeaders());
    expect(res.status).toBe(200);
  });

  it("never publishes sign-up, in either process shape (SEC-1: no self-registration)", async () => {
    for (const app of [all.app, publicOnly.app]) {
      const res = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", [INTERNAL_TOKEN_HEADER]: internalToken },
        body: JSON.stringify({ email: "intruder@example.test", password: "correct horse battery" }),
      });
      expect(res.status).toBe(404);
      expect((await res.text()).toLowerCase()).not.toContain("sign-up");
    }
  });
});

describe("a session token authorizes exactly one session", () => {
  const perSession = SURFACES.filter((s) => s.row === "step-answer-submit" && s.group === "public");

  it.each(perSession.map((s) => [s.name, s] as const))(
    "%s refuses session B's bearer on session A's id",
    async (_name, surface: Surface) => {
      const res = await probe(all.app, surface, ctx, respondentHeaders(otherSessionToken));
      expect(res.status).toBe(401);
      expectNoPayload(res.text);
    },
  );

  it("returns the same refusal for a nonexistent session id as for someone else's", async () => {
    const stranger = { ...ctx, sessionId: "ses_0000000000000000000000000000000f" };
    const step = SURFACES.find((s) => s.name === "GET /sessions/{id}/step") as Surface;
    const missing = await probe(all.app, step, ctx, respondentHeaders(otherSessionToken));
    const other = await probe(all.app, step, stranger, respondentHeaders(otherSessionToken));
    expect(missing.status).toBe(other.status);
  });

  it("gives a respondent no route that enumerates sessions or forms", async () => {
    for (const path of ["/sessions", "/forms", "/admin/forms"]) {
      const res = await all.app.request(path, { headers: respondentHeaders() });
      expect([401, 404, 405]).toContain(res.status);
    }
  });
});

describe("token purposes cannot be cross-used", () => {
  it("refuses a secure-link token presented as a session bearer", async () => {
    const step = SURFACES.find((s) => s.name === "GET /sessions/{id}/step") as Surface;
    const res = await probe(all.app, step, ctx, respondentHeaders(linkToken));
    expect(res.status).toBe(401);
    expectNoPayload(res.text);
  });

  it("refuses a session token presented as a secure link", async () => {
    // Posting a session token to `POST /sessions` would be refused by the anonymous
    // body's strict object instead, which proves nothing about cross-purpose tokens.
    const res = await all.app.request("/sessions/link", {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_TOKEN_HEADER]: internalToken },
      body: JSON.stringify({ token: sessionToken }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("LINK_INVALID");
  });

  it("proves the link token is a real one before proving it is refused", async () => {
    const res = await all.app.request("/sessions/link", {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_TOKEN_HEADER]: internalToken },
      body: JSON.stringify({ token: linkToken }),
    });
    expect(res.status).toBe(201);
  });
});

describe("tampered and expired session tokens", () => {
  const step = (): Surface => SURFACES.find((s) => s.name === "GET /sessions/{id}/step") as Surface;

  /**
   * The FIRST character is mutated, never the last: base64url's final character can carry
   * unused padding bits, so several of them decode to identical bytes and flipping it is
   * sometimes a no-op that leaves the signature valid.
   */
  function tamperSegment(token: string, index: number): string {
    const parts = token.split(".");
    const segment = parts[index] as string;
    const mutated = `${segment.startsWith("A") ? "B" : "A"}${segment.slice(1)}`;
    expect(
      Buffer.from(mutated, "base64url").toString("hex"),
      "the tamper did not change the decoded bytes, so this proves nothing",
    ).not.toBe(Buffer.from(segment, "base64url").toString("hex"));
    parts[index] = mutated;
    return parts.join(".");
  }

  it("refuses a token whose signature segment was altered", async () => {
    const parts = sessionToken.split(".");
    const tampered = tamperSegment(sessionToken, parts.length - 1);
    expect(tampered).not.toBe(sessionToken);
    const res = await probe(all.app, step(), ctx, respondentHeaders(tampered));
    expect(res.status).toBe(401);
  });

  it("refuses a token whose claims segment was altered", async () => {
    const tampered = tamperSegment(sessionToken, 0);
    expect(tampered).not.toBe(sessionToken);
    const res = await probe(all.app, step(), ctx, respondentHeaders(tampered));
    expect(res.status).toBe(401);
  });

  it("serves the untampered token, so the two refusals above are about the tamper", async () => {
    const res = await probe(all.app, step(), ctx, respondentHeaders());
    expect(res.status).toBe(200);
  });

  it("refuses a bearer that is not a token at all", async () => {
    for (const bogus of ["", "   ", "null", "Bearer", "a.b.c"]) {
      const res = await probe(all.app, step(), ctx, respondentHeaders(bogus));
      expect(res.status).toBe(401);
    }
  });
});

describe("an admin route will not act on a session outside the form it names", () => {
  const crossForm = (path: string): string => path;

  it("proves both forms and both sessions are real before proving the cross is refused", async () => {
    const own = await all.app.request(
      crossForm(`/admin/forms/${otherFormId}/responses/${otherFormSessionId}`),
      { headers: adminHeaders() },
    );
    expect(own.status).toBe(200);
  });

  it.each([
    ["read", "GET", (f: string, s: string) => `/admin/forms/${f}/responses/${s}`],
    ["erase", "POST", (f: string, s: string) => `/admin/forms/${f}/responses/${s}/erase`],
    ["unflag", "POST", (f: string, s: string) => `/admin/forms/${f}/responses/${s}/unflag`],
  ])(
    "refuses to %s another form's session through this form's path",
    async (_label, method, build) => {
      const res = await all.app.request(build(ctx.formId, otherFormSessionId), {
        method,
        headers: { "content-type": "application/json", ...adminHeaders() },
        ...(method === "POST" ? { body: JSON.stringify({ reason: "probe" }) } : {}),
      });
      expect(res.status).toBe(404);
      expectNoPayload(await res.text());
    },
  );
});

describe("rotating a key list keeps the previous key verifying", () => {
  const step = (): Surface => SURFACES.find((s) => s.name === "GET /sessions/{id}/step") as Surface;

  it("the rotated process is a real one: its own new internal token opens the channel", async () => {
    const res = await probe(rotated.app, step(), ctx, {
      [INTERNAL_TOKEN_HEADER]: freshInternalToken,
      authorization: `Bearer ${sessionToken}`,
    });
    expect(res.status).toBe(200);
  });

  it("still accepts an internal token that has been demoted behind a fresh one", async () => {
    const res = await probe(rotated.app, step(), ctx, respondentHeaders());
    expect(res.status).toBe(200);
  });

  it("still accepts a session token signed under the demoted session key", async () => {
    const res = await probe(rotated.app, step(), ctx, {
      [INTERNAL_TOKEN_HEADER]: freshInternalToken,
      authorization: `Bearer ${sessionToken}`,
    });
    expect(res.status).toBe(200);
  });

  it("still redeems a secure link signed under the demoted link key", async () => {
    const res = await rotated.app.request("/sessions/link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_TOKEN_HEADER]: freshInternalToken,
      },
      body: JSON.stringify({ token: linkToken }),
    });
    expect(res.status).toBe(201);
  });

  it("signs new tokens with the head key, which the un-rotated process cannot verify", async () => {
    const started = await rotated.app.request("/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_TOKEN_HEADER]: freshInternalToken,
      },
      body: JSON.stringify({ formSlug: ctx.formSlug }),
    });
    expect(started.status).toBe(201);
    const minted = (await started.json()) as StartBody;

    const onRotated = await all.app.request(`/sessions/${minted.sessionId}/step`, {
      headers: {
        [INTERNAL_TOKEN_HEADER]: internalToken,
        authorization: `Bearer ${minted.sessionToken}`,
      },
    });
    expect(onRotated.status).toBe(401);
  });

  it("refuses an internal token that is on neither list", async () => {
    const res = await probe(rotated.app, step(), ctx, {
      [INTERNAL_TOKEN_HEADER]: synthSecret(),
      authorization: `Bearer ${sessionToken}`,
    });
    expect(res.status).toBe(401);
  });
});

/**
 * Each account below holds one shape and no installation claim: the claim administers
 * memberships across every workspace, so an account that kept it would be asserting the
 * claim rather than the role.
 */
describe("the two role families refuse across each other (criteria 2 to 5)", () => {
  /** Scoped to `all` unless narrowed. */
  async function accountHolding(
    label: string,
    grants: readonly string[],
    options: { readonly owner?: boolean } = {},
  ): Promise<string> {
    const account = await seedAdminSession(testDb.db, {
      label,
      claim: false,
      owner: options.owner ?? false,
      grants,
    });
    return account.token;
  }

  function headersFor(token: string): Record<string, string> {
    return { [INTERNAL_TOKEN_HEADER]: internalToken, [ADMIN_SESSION_HEADER]: token };
  }

  async function get(token: string, path: string): Promise<Response> {
    return all.app.request(path, { headers: headersFor(token) });
  }

  async function post(token: string, path: string, body: unknown): Promise<Response> {
    return all.app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headersFor(token) },
      body: JSON.stringify(body),
    });
  }

  /**
   * Written through `@roonga/qcms-db` rather than the membership endpoints, because this
   * block probes the gates in front of them and a fixture built by the thing under test
   * proves less.
   */
  async function createScopedGroup(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly role: string;
    readonly environments: readonly string[];
    readonly forms: readonly string[];
  }): Promise<string> {
    const group = await createAccessGroup(testDb.db, {
      workspaceId: input.workspaceId,
      name: input.name,
      role: input.role,
      environments: input.environments,
      forms: input.forms,
    });
    await ensureWorkspaceMember(testDb.db, input.workspaceId, input.userId);
    await addAccessGroupHolder(testDb.db, group.teamId, input.userId);
    return group.teamId;
  }

  async function createScopedApproverGroup(
    userId: string,
    environments: readonly string[],
  ): Promise<string> {
    return createScopedGroup({
      userId,
      workspaceId: SEED_WORKSPACE_ID,
      name: `${environments.join("-")}.forms.approver.probe`,
      role: "forms.approver",
      environments,
      forms: ["all"],
    });
  }

  async function createFormScopedViewerGroup(
    userId: string,
    forms: readonly string[],
  ): Promise<string> {
    return createScopedGroup({
      userId,
      workspaceId: SEED_WORKSPACE_ID,
      name: "all.responses.viewer.officer",
      role: "responses.viewer",
      environments: ["all"],
      forms,
    });
  }

  async function createWorkspaceWithViewer(
    label: string,
  ): Promise<{ readonly token: string; readonly workspaceId: string }> {
    const workspaceId = `org_${label.replaceAll("-", "_")}`;
    await testDb.db.insert(authOrganization).values({
      id: workspaceId,
      name: label,
      slug: label,
    });
    const account = await seedAdminSession(testDb.db, { label, claim: false, membership: false });
    await createScopedGroup({
      userId: account.userId,
      workspaceId,
      name: "all.forms.viewer",
      role: "forms.viewer",
      environments: ["all"],
      forms: ["all"],
    });
    return { token: account.token, workspaceId };
  }

  it("gives a `forms.editor` no response in any environment, whatever its scope (criterion 2)", async () => {
    const token = await accountHolding("probe-editor", ["forms.editor"]);
    for (const environment of ["prod", "test"]) {
      const res = await all.app.request(`/admin/forms/${ctx.formId}/responses`, {
        headers: { ...headersFor(token), "x-qcms-environment": environment },
      });
      expect(res.status, `forms.editor read responses in ${environment}`).toBe(403);
      expectNoPayload(await res.text());
    }
    expect((await get(token, `/admin/forms/${ctx.formId}`)).status).toBe(200);
  });

  it("gives a `forms.owner` no response and no form at all (criterion 2, Q27)", async () => {
    const token = await accountHolding("probe-owner", [], { owner: true });
    expect((await get(token, `/admin/forms/${ctx.formId}/responses`)).status).toBe(403);
    expect((await get(token, `/admin/forms/${ctx.formId}`)).status).toBe(403);
    expect((await get(token, `/admin/workspaces/${ctx.workspaceId}/members`)).status).toBe(200);
  });

  it("gives a `responses.viewer` no authoring right (criterion 3)", async () => {
    const token = await accountHolding("probe-handler", ["responses.viewer"]);
    expect((await get(token, `/admin/forms/${ctx.formId}/responses`)).status).toBe(200);
    expect((await post(token, `/admin/forms/${ctx.formId}/publish`, {})).status).toBe(403);
    const draft = await all.app.request(`/admin/forms/${ctx.formId}/draft`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headersFor(token) },
      body: JSON.stringify({ definition: {} }),
    });
    expect(draft.status).toBe(403);
  });

  it("gives a `responses.eraser` no read and no export (criterion 3)", async () => {
    const token = await accountHolding("probe-eraser", ["responses.eraser"]);
    expect((await get(token, `/admin/forms/${ctx.formId}/responses`)).status).toBe(403);
    expect(
      (await get(token, `/admin/forms/${ctx.formId}/export?format=csv&version=1`)).status,
    ).toBe(403);
  });

  it("gives a `forms.viewer` the two read rows and nothing else (criterion 3, Q38)", async () => {
    const token = await accountHolding("probe-viewer", ["forms.viewer"]);
    expect((await get(token, `/admin/forms/${ctx.formId}`)).status).toBe(200);
    // Production included, because authoring roles are workspace-wide and only the writes
    // are scoped.
    expect((await get(token, `/admin/forms/${ctx.formId}/webhooks`)).status).toBe(200);
    expect((await get(token, `/admin/forms/${ctx.formId}/links`)).status).toBe(200);
    expect((await post(token, `/admin/forms/${ctx.formId}/publish`, {})).status).toBe(403);
    expect((await get(token, `/admin/forms/${ctx.formId}/responses`)).status).toBe(403);
  });

  it("refuses an environment-scoped act outside the grant's environments (criterion 4)", async () => {
    // The release route names its environment in the body, so this is the one act whose
    // environment does not come from the switcher.
    const scoped = await seedAdminSession(testDb.db, {
      label: "probe-test-only",
      claim: false,
      owner: false,
      // No default grants: the seeded `all`-scoped set would make the refusal untestable.
      grants: [],
    });
    const narrow = await createScopedApproverGroup(scoped.userId, ["test"]);
    expect(narrow).toBeDefined();

    const toProd = await post(scoped.token, `/admin/forms/${ctx.formId}/releases`, {
      environment: "prod",
      version: 1,
    });
    expect(toProd.status).toBe(403);
    expectNoPayload(await toProd.text());

    const toTest = await post(scoped.token, `/admin/forms/${ctx.formId}/releases`, {
      environment: "test",
      version: 1,
    });
    expect(toTest.status).not.toBe(403);
  });

  it("refuses the responses of a form outside a data grant's form list (criterion 4, Q28)", async () => {
    const officer = await seedAdminSession(testDb.db, {
      label: "probe-officer",
      claim: false,
      owner: false,
      grants: [],
    });
    await createFormScopedViewerGroup(officer.userId, [otherFormId]);

    expect((await get(officer.token, `/admin/forms/${otherFormId}/responses`)).status).toBe(200);
    const elsewhere = await get(officer.token, `/admin/forms/${ctx.formId}/responses`);
    expect(elsewhere.status).toBe(403);
    expectNoPayload(await elsewhere.text());
  });

  it("gives the installation claim administration and no response anywhere (criterion 5, Q29)", async () => {
    const claimOnly = await seedAdminSession(testDb.db, {
      label: "probe-claim",
      membership: false,
    });
    expect(
      (await get(claimOnly.token, `/admin/workspaces/${ctx.workspaceId}/members`)).status,
    ).toBe(200);
    const environments = await get(claimOnly.token, "/admin/environments");
    expect(environments.status).toBe(200);
    expect(
      ((await environments.json()) as { environments: unknown[] }).environments.length,
    ).toBeGreaterThan(0);
    expect((await get(claimOnly.token, `/admin/forms/${ctx.formId}/responses`)).status).toBe(403);
    expect(
      (await get(claimOnly.token, `/admin/forms/${ctx.formId}/export?format=csv&version=1`)).status,
    ).toBe(403);
    const erase = await post(
      claimOnly.token,
      `/admin/forms/${ctx.formId}/responses/${ctx.sessionId}/erase`,
      { reason: "probe" },
    );
    expect(erase.status).toBe(403);
    expect((await post(claimOnly.token, `/admin/forms/${ctx.formId}/publish`, {})).status).toBe(
      403,
    );
  });

  it("gives an administrator with no grant and no claim nothing at all (criterion 5)", async () => {
    const nobody = await seedAdminSession(testDb.db, {
      label: "probe-nobody",
      claim: false,
      membership: false,
    });
    for (const path of [
      "/admin/forms",
      "/admin/questions",
      `/admin/forms/${ctx.formId}`,
      `/admin/forms/${ctx.formId}/responses`,
      `/admin/workspaces/${ctx.workspaceId}/members`,
    ]) {
      const res = await get(nobody.token, path);
      expect(res.status, `${path} was served to an account holding nothing`).toBe(403);
      expectNoPayload(await res.text());
    }

    // Served rather than refused: a caller has to be able to learn which environments they
    // can act in without first holding a grant to ask.
    const environments = await get(nobody.token, "/admin/environments");
    expect(environments.status).toBe(200);
    expect((await environments.json()) as { environments: unknown[] }).toEqual({
      environments: [],
    });
  });

  it("narrows the library lists to the caller's own workspaces (ADR-41's premise)", async () => {
    const other = await createWorkspaceWithViewer("probe-elsewhere");
    const res = await get(other.token, "/admin/forms");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { forms: { formId: string }[] };
    expect(body.forms.map((form) => form.formId)).not.toContain(ctx.formId);
  });
});

function environmentHeaders(
  token: string,
  environment: string,
  json = false,
): Record<string, string> {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    [INTERNAL_TOKEN_HEADER]: internalToken,
    [ADMIN_SESSION_HEADER]: token,
    [REQUEST_ENVIRONMENT_HEADER]: environment,
  };
}

/**
 * Each case asserts the refusal and the effect: a status alone would pass against a
 * handler that refused for an unrelated reason, and the bypass is that the production
 * object was changed.
 */
describe("the environment a request is authorised for is the environment it acts in", () => {
  let testEditor = "";
  /**
   * Unflag is `response: dispose`, which no `forms.editor` holds anywhere, so only an
   * eraser scoped to `test` makes that row a bypass probe.
   */
  let testEraser = "";
  let prodLinkId = "";
  let prodWebhookId = "";

  const headersFor = environmentHeaders;

  beforeAll(async () => {
    const editor = await seedAdminSession(testDb.db, {
      label: "forged-body-editor",
      claim: false,
      owner: false,
      grants: [],
    });
    testEditor = editor.token;
    const group = await createAccessGroup(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      name: "test.forms.editor.forged",
      role: "forms.editor",
      environments: ["test"],
      forms: ["all"],
    });
    await ensureWorkspaceMember(testDb.db, SEED_WORKSPACE_ID, editor.userId);
    await addAccessGroupHolder(testDb.db, group.teamId, editor.userId);

    const eraser = await seedAdminSession(testDb.db, {
      label: "forged-body-eraser",
      claim: false,
      owner: false,
      grants: [],
    });
    testEraser = eraser.token;
    const eraserGroup = await createAccessGroup(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      name: "test.responses.eraser.forged",
      role: "responses.eraser",
      environments: ["test"],
      forms: ["all"],
    });
    await ensureWorkspaceMember(testDb.db, SEED_WORKSPACE_ID, eraser.userId);
    await addAccessGroupHolder(testDb.db, eraserGroup.teamId, eraser.userId);

    // The production objects the editor must not reach, minted by the fully credentialed
    // admin.
    const minted = await all.app.request(`/admin/forms/${ctx.formId}/links`, {
      method: "POST",
      headers: headersFor(adminToken, "prod", true),
      body: JSON.stringify({ environment: "prod", expiresAt: "2099-01-01T00:00:00.000Z" }),
    });
    expect(minted.status, await minted.clone().text()).toBe(201);
    prodLinkId = ((await minted.json()) as { links: { linkId: string }[] }).links[0]?.linkId ?? "";
    expect(prodLinkId).not.toBe("");

    const created = await all.app.request(`/admin/forms/${ctx.formId}/webhooks`, {
      method: "POST",
      headers: headersFor(adminToken, "prod", true),
      body: JSON.stringify({ url: "https://consumer.example/forged" }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    prodWebhookId = ((await created.json()) as { webhookId: string }).webhookId;
  });

  async function prodLinkIsActive(): Promise<boolean> {
    const listed = await all.app.request(`/admin/forms/${ctx.formId}/links`, {
      headers: headersFor(adminToken, "prod"),
    });
    const body = (await listed.json()) as { links: { linkId: string; state: string }[] };
    return body.links.some((link) => link.linkId === prodLinkId && link.state === "active");
  }

  async function prodWebhookIsActive(): Promise<boolean> {
    const listed = await all.app.request(`/admin/forms/${ctx.formId}/webhooks`, {
      headers: headersFor(adminToken, "prod"),
    });
    const body = (await listed.json()) as { webhooks: { webhookId: string; active: boolean }[] };
    return body.webhooks.some((hook) => hook.webhookId === prodWebhookId && hook.active);
  }

  it.each([
    [
      "link revoke",
      "POST",
      (): string => `/admin/forms/${ctx.formId}/links/${prodLinkId}/revoke`,
      (): string => testEditor,
    ],
    [
      "webhook delete",
      "DELETE",
      (): string => `/admin/forms/${ctx.formId}/webhooks/${prodWebhookId}`,
      (): string => testEditor,
    ],
    [
      "redeliver",
      "POST",
      (): string => `/admin/forms/${ctx.formId}/deliveries/${ctx.deliveryId}/redeliver`,
      (): string => testEditor,
    ],
    [
      "unflag",
      "POST",
      (): string => `/admin/forms/${ctx.formId}/responses/${ctx.sessionId}/unflag`,
      (): string => testEraser,
    ],
  ])(
    "%s refuses a test-scoped holder whether or not the body forges an environment (B1)",
    async (_label, method, path, token) => {
      const plain = await all.app.request(path(), {
        method,
        headers: headersFor(token(), "prod"),
      });
      expect(plain.status).toBe(403);
      expectNoPayload(await plain.text());

      // The body names `test` to the gate and the switcher names `prod` to the handler.
      const forged = await all.app.request(path(), {
        method,
        headers: headersFor(token(), "prod", true),
        body: JSON.stringify({ environment: "test" }),
      });
      expect(
        [400, 403],
        `a forged body was served on ${_label}: ${String(forged.status)}`,
      ).toContain(forged.status);
      expectNoPayload(await forged.text());
    },
  );

  it("leaves the production link and webhook exactly as they were (B1's effect)", async () => {
    expect(await prodLinkIsActive(), "the prod link was revoked by a test-scoped editor").toBe(
      true,
    );
    expect(
      await prodWebhookIsActive(),
      "the prod webhook was deactivated by a test-scoped editor",
    ).toBe(true);
  });

  it("refuses a test-scoped editor `publish-and-release` into prod (B2)", async () => {
    // The refusal has to be the gate's 403 rather than the handler's 409: a 409 means the
    // request reached a handler that would have released to production.
    const refused = await all.app.request(`/admin/forms/${ctx.formId}/publish-and-release`, {
      method: "POST",
      headers: headersFor(testEditor, "test", true),
      body: JSON.stringify({ environment: "prod" }),
    });
    expect(refused.status, await refused.clone().text()).toBe(403);
    expect(await refused.text()).toContain("release: create");
  });

  it("allows the same route to `test`, where that editor does hold the release half", async () => {
    const allowed = await all.app.request(`/admin/forms/${ctx.formId}/publish-and-release`, {
      method: "POST",
      headers: headersFor(testEditor, "test", true),
      body: JSON.stringify({ environment: "test" }),
    });
    expect(allowed.status).not.toBe(403);
  });

  it("refuses a body that names no environment on a route whose body carries it", async () => {
    // A `body` row authorises against the body, so a body naming nothing is refused rather
    // than falling back to the switcher the handler is not going to use.
    const empty = await all.app.request(`/admin/forms/${ctx.formId}/publish-and-release`, {
      method: "POST",
      headers: headersFor(testEditor, "test", true),
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
  });
});

/**
 * The masking is asserted on the API's own response bytes, because Q58 masks there and
 * never in the admin's rendering, so a second client of the route cannot see round it.
 * Masking the query string mitigates an operator who put a credential in a URL; it is not
 * a control, and the signing secret is the thing SEC-6 protects.
 */
describe("the production split and the masked endpoint URL (criterion 8)", () => {
  let allEditor = "";
  let prodApprover = "";
  let viewer = "";
  let queryWebhookId = "";

  const WHOLE_URL = "https://consumer.example/hook?token=not-a-real-credential&tenant=acme";

  const headersFor = environmentHeaders;

  async function accountWith(
    label: string,
    role: string,
    environments: readonly string[],
  ): Promise<string> {
    const account = await seedAdminSession(testDb.db, {
      label,
      claim: false,
      owner: false,
      // No default grants: the seeded `all`-scoped set would make every refusal below
      // untestable.
      grants: [],
    });
    const group = await createAccessGroup(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      name: `${environments.join("-")}.${role}.${label}`,
      role,
      environments,
      forms: ["all"],
    });
    await ensureWorkspaceMember(testDb.db, SEED_WORKSPACE_ID, account.userId);
    await addAccessGroupHolder(testDb.db, group.teamId, account.userId);
    return account.token;
  }

  beforeAll(async () => {
    // `all` in both dimensions, so the refusals below are about the role rather than the
    // scope: an editor holding `prod` in scope is still refused a production change.
    allEditor = await accountWith("prod-split-editor", "forms.editor", ["all"]);
    prodApprover = await accountWith("prod-split-approver", "forms.approver", ["prod"]);
    viewer = await accountWith("prod-split-viewer", "forms.viewer", ["all"]);

    // Created by the fully credentialed administrator, so its existence owes nothing to
    // the rules under test.
    const created = await all.app.request(`/admin/forms/${ctx.formId}/webhooks`, {
      method: "POST",
      headers: headersFor(adminToken, "prod", true),
      body: JSON.stringify({ url: WHOLE_URL }),
    });
    expect(created.status).toBe(201);
    queryWebhookId = ((await created.json()) as { webhookId: string }).webhookId;
  });

  async function listEndpoints(
    token: string,
    environment: string,
  ): Promise<{ webhookId: string; url: string }[]> {
    const res = await all.app.request(`/admin/forms/${ctx.formId}/webhooks`, {
      headers: headersFor(token, environment),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { webhooks: { webhookId: string; url: string }[] }).webhooks;
  }

  it("refuses a `forms.editor` a prod endpoint change, scope or no scope (Q30)", async () => {
    const change = await all.app.request(`/admin/forms/${ctx.formId}/webhooks/${queryWebhookId}`, {
      method: "PUT",
      headers: headersFor(allEditor, "prod", true),
      body: JSON.stringify({ url: "https://attacker.example/exfiltrate" }),
    });
    expect(change.status).toBe(403);
    expectNoPayload(await change.text());

    // The effect, not only the status: an editor who can point a production webhook at any
    // URL can route production personal data out of the deployment.
    const after = await listEndpoints(adminToken, "prod");
    expect(after.find((row) => row.webhookId === queryWebhookId)?.url).toBe(WHOLE_URL);
  });

  it("leaves a `test` endpoint change an editor's (Q30's narrowing)", async () => {
    const change = await all.app.request(`/admin/forms/${ctx.formId}/webhooks`, {
      method: "POST",
      headers: headersFor(allEditor, "test", true),
      body: JSON.stringify({ url: "https://test-consumer.example/hook" }),
    });
    // The exact status rather than `not.toBe(403)`, which a 500 would also satisfy.
    expect(change.status).toBe(201);
  });

  it("allows a `forms.approver` holding prod the same prod endpoint change", async () => {
    const change = await all.app.request(`/admin/forms/${ctx.formId}/webhooks`, {
      method: "POST",
      headers: headersFor(prodApprover, "prod", true),
      body: JSON.stringify({ url: "https://approved-consumer.example/hook" }),
    });
    expect(change.status).toBe(201);
  });

  it("refuses a `forms.editor` a prod link mint and allows the approver (Q30)", async () => {
    const body = { environment: "prod", expiresAt: "2099-01-01T00:00:00.000Z" };
    const refused = await all.app.request(`/admin/forms/${ctx.formId}/links`, {
      method: "POST",
      headers: headersFor(allEditor, "prod", true),
      body: JSON.stringify(body),
    });
    expect(refused.status).toBe(403);
    expectNoPayload(await refused.text());

    const allowed = await all.app.request(`/admin/forms/${ctx.formId}/links`, {
      method: "POST",
      headers: headersFor(prodApprover, "prod", true),
      body: JSON.stringify(body),
    });
    expect(allowed.status).toBe(201);

    const inTest = await all.app.request(`/admin/forms/${ctx.formId}/links`, {
      method: "POST",
      headers: headersFor(allEditor, "test", true),
      body: JSON.stringify({ ...body, environment: "test" }),
    });
    expect(inTest.status).not.toBe(403);
  });

  it("refuses a `forms.editor` closing and reopening prod, and allows the approver (Q33)", async () => {
    for (const action of ["close", "reopen"]) {
      const refused = await all.app.request(`/admin/forms/${ctx.formId}/${action}`, {
        method: "POST",
        headers: headersFor(allEditor, "prod", true),
        body: JSON.stringify({ environment: "prod" }),
      });
      expect(refused.status, `${action} in prod as an editor`).toBe(403);

      const allowed = await all.app.request(`/admin/forms/${ctx.formId}/${action}`, {
        method: "POST",
        headers: headersFor(prodApprover, "prod", true),
        body: JSON.stringify({ environment: "prod" }),
      });
      expect(allowed.status, `${action} in prod as an approver`).not.toBe(403);
    }
  });

  it("masks the endpoint URL's query string for a `forms.viewer` (Q58)", async () => {
    const rows = await listEndpoints(viewer, "prod");
    const row = rows.find((entry) => entry.webhookId === queryWebhookId);
    expect(row, "the viewer reads endpoint configuration in every environment").toBeDefined();
    expect(row?.url).toBe("https://consumer.example/hook?(hidden)");
    expect(row?.url).not.toContain("token=");
    expect(row?.url).not.toContain("not-a-real-credential");
  });

  it("returns the whole URL to a `forms.editor` (Q58)", async () => {
    const rows = await listEndpoints(allEditor, "prod");
    expect(rows.find((entry) => entry.webhookId === queryWebhookId)?.url).toBe(WHOLE_URL);
  });

  it("masks the delivery dashboard's copy of the same URL for a `forms.viewer` (Q58)", async () => {
    // The delivery list is `webhook: read` like the endpoint list, so it masks the same way.
    const res = await all.app.request(`/admin/forms/${ctx.formId}/deliveries`, {
      headers: headersFor(viewer, "prod"),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("not-a-real-credential");
  });
});

/**
 * Its own form, so nothing here disturbs the release history or the endpoint set the
 * blocks above assert against, and the switch is turned on in `beforeAll` and off in
 * `afterAll` so a block added after this one inherits the default.
 */
describe("the two-person rule for production (task 070, criteria 1 to 7)", () => {
  const headersFor = environmentHeaders;
  const TWO_PERSON_FORM = "frm_two_person";
  const ORIGINAL_URL = "https://agreed-consumer.example/hook";
  const PROPOSED_URL = "https://second-consumer.example/hook";

  /** The account that published version 1, and a `forms.approver` holding `prod`. */
  let author = { token: "", userId: "" };
  let second = { token: "", userId: "" };
  let foreignApprover = "";
  let testApprover = "";
  let owner = "";
  let viewer = "";
  let claimOnly = "";
  /** The endpoint the pending changes are about, created before the switch went on. */
  let webhookId = "";

  async function approverAccount(
    label: string,
    role: string,
    environments: readonly string[],
    workspaceId: string = SEED_WORKSPACE_ID,
  ): Promise<{ token: string; userId: string }> {
    const account = await seedAdminSession(testDb.db, {
      label,
      claim: false,
      owner: false,
      grants: [],
    });
    const group = await createAccessGroup(testDb.db, {
      workspaceId,
      name: `${environments.join("-")}.${role}.${label}`,
      role,
      environments,
      forms: ["all"],
    });
    await ensureWorkspaceMember(testDb.db, workspaceId, account.userId);
    await addAccessGroupHolder(testDb.db, group.teamId, account.userId);
    return { token: account.token, userId: account.userId };
  }

  async function setSwitch(on: boolean): Promise<void> {
    await setRequireSecondApprover(testDb.db, SEED_WORKSPACE_ID, on);
  }

  async function release(token: string, version: number, environment: string): Promise<Response> {
    return all.app.request(`/admin/forms/${TWO_PERSON_FORM}/releases`, {
      method: "POST",
      headers: headersFor(token, environment, true),
      body: JSON.stringify({ environment, version }),
    });
  }

  async function releasedVersion(environment: string): Promise<number | undefined> {
    const row = await getReleasedVersion(testDb.db, FormId.parse(TWO_PERSON_FORM), environment);
    return row?.version;
  }

  async function liveUrl(): Promise<string | undefined> {
    const row = await getWebhook(testDb.db, FormId.parse(TWO_PERSON_FORM), webhookId);
    return row?.url;
  }

  async function proposeUrl(
    token: string,
    url: string,
  ): Promise<{ status: number; proposalId?: string }> {
    const res = await all.app.request(`/admin/forms/${TWO_PERSON_FORM}/webhooks/${webhookId}`, {
      method: "PUT",
      headers: headersFor(token, "prod", true),
      body: JSON.stringify({ url }),
    });
    if (res.status !== 202) return { status: res.status };
    const body = (await res.json()) as { proposal: { proposalId: string } };
    return { status: res.status, proposalId: body.proposal.proposalId };
  }

  async function confirm(
    token: string,
    proposalId: string,
    environment = "prod",
  ): Promise<Response> {
    return all.app.request(
      `/admin/forms/${TWO_PERSON_FORM}/webhooks/proposals/${proposalId}/confirm`,
      { method: "POST", headers: headersFor(token, environment) },
    );
  }

  beforeAll(async () => {
    // `all` in both dimensions for the two approvers: one scoped to `prod` alone would be
    // refused a `test` release by the scope before the account comparison was reached.
    author = await approverAccount("two-person-author", "forms.approver", ["all"]);
    second = await approverAccount("two-person-second", "forms.approver", ["all"]);
    testApprover = (await approverAccount("two-person-test", "forms.approver", ["test"])).token;
    viewer = (await approverAccount("two-person-viewer", "forms.viewer", ["all"])).token;

    const ownerAccount = await seedAdminSession(testDb.db, {
      label: "two-person-owner",
      claim: false,
      owner: true,
      grants: [],
    });
    owner = ownerAccount.token;

    claimOnly = (
      await seedAdminSession(testDb.db, {
        label: "two-person-claim",
        claim: true,
        membership: false,
      })
    ).token;

    // A real grant in a real second workspace, rather than an absent one.
    const [foreign] = await testDb.db
      .insert(authOrganization)
      .values({
        id: `org_two_person_${synthSecret().slice(0, 8)}`,
        name: "Another workspace",
        slug: `another-${synthSecret().slice(0, 8)}`,
        createdAt: new Date("2026-10-22T00:00:00.000Z"),
      })
      .returning({ id: authOrganization.id });
    foreignApprover = (
      await approverAccount("two-person-foreign", "forms.approver", ["prod"], foreign!.id)
    ).token;

    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FormId.parse(TWO_PERSON_FORM),
      slug: "two-person-rule",
      defaultLocale: "en",
    });
    // Three versions differing only in their publisher, which is what the rule compares.
    for (const publishedBy of [author.userId, second.userId, null]) {
      await insertFormVersion(testDb.db, {
        formId: FormId.parse(TWO_PERSON_FORM),
        definition: { formId: TWO_PERSON_FORM, steps: [] } as never,
        compiled: {} as never,
        compilerVersion: "0.1.0",
        a2uiSpecVersion: "0.1.0",
        semanticsVersion: "1",
        publishedBy,
      });
    }

    // Created before the switch goes on, which is also the rule-off case: a single account
    // configures production at once.
    const created = await all.app.request(`/admin/forms/${TWO_PERSON_FORM}/webhooks`, {
      method: "POST",
      headers: headersFor(author.token, "prod", true),
      body: JSON.stringify({ url: ORIGINAL_URL }),
    });
    expect(created.status, "a prod endpoint with the switch off applies at once").toBe(201);
    webhookId = ((await created.json()) as { webhookId: string }).webhookId;

    await setSwitch(true);
  });

  afterAll(async () => {
    await setSwitch(false);
  });

  it("refuses a prod release by the account that published the version (criterion 1)", async () => {
    const before = await releasedVersion("prod");
    const refused = await release(author.token, 1, "prod");
    expect(refused.status).toBe(403);
    expect(((await refused.clone().json()) as { error?: { code?: string } }).error?.code).toBe(
      "APPROVER_IS_AUTHOR",
    );
    expectNoPayload(await refused.text());
    expect(await releasedVersion("prod")).toBe(before);
  });

  it("allows a different prod approver, in one act, and records the approval (criteria 1, 2)", async () => {
    expect((await release(author.token, 1, "test")).status).toBe(200);
    const allowed = await release(second.token, 1, "prod");
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as { release: { approvedBy: string | null } };
    expect(body.release.approvedBy).toBe(second.userId);
    expect(await releasedVersion("prod")).toBe(1);

    const history = await all.app.request(`/admin/forms/${TWO_PERSON_FORM}/releases`, {
      headers: headersFor(second.token, "prod"),
    });
    expect(history.status).toBe(200);
    const rows = (await history.json()) as {
      releases: { version: number; environment: string; approvedBy: string | null }[];
    };
    expect(
      rows.releases.find((row) => row.environment === "prod" && row.version === 1)?.approvedBy,
    ).toBe(second.userId);
  });

  it("refuses a prod release of a version whose author is unknown", async () => {
    // The rule compares two accounts and one of them is unknown, so the conservative
    // answer is no: "a different account released it" cannot be claimed.
    const refused = await release(second.token, 3, "prod");
    expect(refused.status).toBe(409);
    expect(((await refused.clone().json()) as { error?: { code?: string } }).error?.code).toBe(
      "APPROVER_UNKNOWN_AUTHOR",
    );
    expect(await releasedVersion("prod")).toBe(1);
  });

  it("never asks for an approver outside prod, whatever the switch says (criterion 4)", async () => {
    // The switch is on throughout this block, and a release to `test` stays self-service.
    const released = await release(second.token, 2, "test");
    expect(released.status).toBe(200);
    const body = (await released.json()) as { release: { approvedBy: string | null } };
    expect(body.release.approvedBy).toBeNull();
  });

  it("matches task 065 exactly with the switch off (criterion 3)", async () => {
    await setSwitch(false);
    try {
      const released = await release(author.token, 2, "prod");
      expect(released.status).toBe(200);
      const body = (await released.json()) as { release: { approvedBy: string | null } };
      expect(body.release.approvedBy).toBeNull();
      expect(await releasedVersion("prod")).toBe(2);
    } finally {
      await setSwitch(true);
    }
  });

  it("walks every refusal the rule leaves to the grant model (criterion 5)", async () => {
    const before = await releasedVersion("prod");
    for (const [label, token] of [
      ["an approver from another workspace", foreignApprover],
      ["an approver without prod in scope", testApprover],
      ["a forms.owner with no approver grant", owner],
      ["a forms.viewer", viewer],
    ] as const) {
      const refused = await release(token, 3, "prod");
      expect(refused.status, label).toBe(403);
      expectNoPayload(await refused.text());
    }
    expect(await releasedVersion("prod")).toBe(before);
  });

  it("refuses the installation claim a prod release, with or without an author (criterion 6)", async () => {
    // The claim administers and reads no data anywhere, and a release is not
    // administration.
    const before = await releasedVersion("prod");
    for (const version of [1, 3]) {
      const refused = await release(claimOnly, version, "prod");
      expect(refused.status, `claim releasing v${version}`).toBe(403);
      expectNoPayload(await refused.text());
    }
    expect(await releasedVersion("prod")).toBe(before);
  });

  it("holds a prod endpoint change pending and delivers nothing to the new URL (criterion 7)", async () => {
    const proposed = await proposeUrl(author.token, PROPOSED_URL);
    expect(proposed.status).toBe(202);
    expect(proposed.proposalId).toBeDefined();
    // The live endpoint is untouched, so the deliverer goes on posting to the URL that was
    // already agreed.
    expect(await liveUrl()).toBe(ORIGINAL_URL);

    const pending = await all.app.request(`/admin/forms/${TWO_PERSON_FORM}/webhooks/proposals`, {
      headers: headersFor(second.token, "prod"),
    });
    expect(pending.status).toBe(200);
    const list = (await pending.json()) as {
      proposals: { proposalId: string; url: string | null; proposedBy: string }[];
    };
    expect(list.proposals.map((row) => row.proposalId)).toContain(proposed.proposalId);
    expect(list.proposals[0]?.proposedBy).toBe(author.userId);
  });

  it("refuses the proposer their own confirmation, and refuses every other shape (criterion 7)", async () => {
    const pending = await all.app.request(`/admin/forms/${TWO_PERSON_FORM}/webhooks/proposals`, {
      headers: headersFor(second.token, "prod"),
    });
    const proposalId = ((await pending.json()) as { proposals: { proposalId: string }[] })
      .proposals[0]!.proposalId;

    const own = await confirm(author.token, proposalId);
    expect(own.status).toBe(403);
    expect(((await own.clone().json()) as { error?: { code?: string } }).error?.code).toBe(
      "PROPOSER_CANNOT_CONFIRM",
    );

    // Each is refused by the policy row before the handler runs, so none of them can learn
    // that the proposal exists either.
    for (const [label, token] of [
      ["an approver from another workspace", foreignApprover],
      ["an approver without prod in scope", testApprover],
      ["a forms.owner with no approver grant", owner],
      ["a forms.viewer", viewer],
      ["the installation claim", claimOnly],
    ] as const) {
      const refused = await confirm(token, proposalId);
      expect(refused.status, label).toBe(403);
      expectNoPayload(await refused.text());
    }

    // A forged switcher: the handler compares the proposal's own environment and answers
    // not found, so a caller scoped to `test` learns nothing about what is pending in prod.
    const forged = await confirm(second.token, proposalId, "test");
    expect(forged.status).toBe(404);

    expect(await liveUrl()).toBe(ORIGINAL_URL);
  });

  it("applies the change when a different prod approver confirms it (criterion 7)", async () => {
    const pending = await all.app.request(`/admin/forms/${TWO_PERSON_FORM}/webhooks/proposals`, {
      headers: headersFor(second.token, "prod"),
    });
    const proposalId = ((await pending.json()) as { proposals: { proposalId: string }[] })
      .proposals[0]!.proposalId;

    const confirmed = await confirm(second.token, proposalId);
    expect(confirmed.status).toBe(200);
    const body = (await confirmed.json()) as {
      proposal: { confirmedBy: string | null; appliedAt: string | null };
    };
    expect(body.proposal.confirmedBy).toBe(second.userId);
    expect(body.proposal.appliedAt).not.toBeNull();
    expect(await liveUrl()).toBe(PROPOSED_URL);

    const after = await all.app.request(`/admin/forms/${TWO_PERSON_FORM}/webhooks/proposals`, {
      headers: headersFor(second.token, "prod"),
    });
    expect(((await after.json()) as { proposals: unknown[] }).proposals).toHaveLength(0);
  });

  it("withdraws a pending change without applying it (criterion 7)", async () => {
    const proposed = await proposeUrl(second.token, "https://withdrawn-consumer.example/hook");
    expect(proposed.status).toBe(202);

    const withdrawn = await all.app.request(
      `/admin/forms/${TWO_PERSON_FORM}/webhooks/proposals/${proposed.proposalId}`,
      { method: "DELETE", headers: headersFor(author.token, "prod") },
    );
    expect(withdrawn.status).toBe(200);
    expect(await liveUrl()).toBe(PROPOSED_URL);

    const late = await confirm(author.token, proposed.proposalId!);
    expect(late.status).toBe(404);
  });

  it("refuses a second pending change to the same endpoint", async () => {
    const first = await proposeUrl(author.token, "https://one-consumer.example/hook");
    expect(first.status).toBe(202);
    const secondChange = await proposeUrl(author.token, "https://two-consumer.example/hook");
    // Two pending changes would make "confirm this one" ambiguous, and confirming the
    // second would overwrite a value its own confirmer had read in a different screen.
    expect(secondChange.status).toBe(409);

    const cleared = await all.app.request(
      `/admin/forms/${TWO_PERSON_FORM}/webhooks/proposals/${first.proposalId}`,
      { method: "DELETE", headers: headersFor(author.token, "prod") },
    );
    expect(cleared.status).toBe(200);
  });

  it("leaves no hole when the switch goes off while a change is pending", async () => {
    const proposed = await proposeUrl(author.token, "https://switched-off.example/hook");
    expect(proposed.status).toBe(202);

    await setSwitch(false);
    try {
      // The switch governs whether a change becomes a proposal, not who may confirm one
      // that already is.
      expect(await liveUrl()).toBe(PROPOSED_URL);
      const own = await confirm(author.token, proposed.proposalId!);
      expect(own.status).toBe(403);
      expect(await liveUrl()).toBe(PROPOSED_URL);
    } finally {
      await setSwitch(true);
    }

    const cleared = await all.app.request(
      `/admin/forms/${TWO_PERSON_FORM}/webhooks/proposals/${proposed.proposalId}`,
      { method: "DELETE", headers: headersFor(second.token, "prod") },
    );
    expect(cleared.status).toBe(200);
  });

  it("writes a SEC-15 row for every propose, confirm and withdraw (Q61)", async () => {
    const before = await listAccessAudit(testDb.db, SEED_WORKSPACE_ID, { kind: "setting" });
    const proposed = await proposeUrl(author.token, "https://audited-consumer.example/hook");
    expect(proposed.status).toBe(202);
    const confirmed = await confirm(second.token, proposed.proposalId!);
    expect(confirmed.status).toBe(200);

    const after = await listAccessAudit(testDb.db, SEED_WORKSPACE_ID, { kind: "setting" });
    const added = after.rows.filter((row) => !before.rows.some((earlier) => earlier.id === row.id));
    expect(added.length).toBeGreaterThanOrEqual(2);
    const acts = added.map((row) => row.detail ?? "");
    expect(acts.some((detail) => detail.includes("act=propose"))).toBe(true);
    expect(acts.some((detail) => detail.includes("act=confirm"))).toBe(true);
    for (const row of added) {
      expect(row.environment).toBe("prod");
      expect(row.formId).toBe(TWO_PERSON_FORM);
      // The URL is deliberately absent: the audit is readable by a `forms.owner`, who was
      // never given an unmasked endpoint URL.
      expect(row.detail ?? "").not.toContain("audited-consumer.example");
    }
  });
});
