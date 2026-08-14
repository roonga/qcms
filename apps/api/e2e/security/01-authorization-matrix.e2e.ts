/**
 * Security scenario 1 - the SEC-3 authorization matrix, asserted over HTTP.
 *
 * `docs/SECURITY_DESIGN.md` §3.2 tabulates eight action rows against four
 * credential columns and §3.2's closing line says "Enforcement tests for this
 * matrix are part of 040". Until this file existed, every cell rested on a
 * per-slice unit test: each slice was right about itself, and nothing asserted
 * the composition. That is the exact shape the project keeps finding defects in.
 *
 * The rows live in `surfaces.ts` as data; this file walks them once per
 * credential shape. Two disciplines are load-bearing and worth stating so a
 * later reader does not quietly drop them:
 *
 * 1. **Positive controls first.** A file full of 401s proves nothing if the URLs
 *    are wrong - a typo'd path is a 404 that reads as a pass under a careless
 *    assertion. `describe("positive control")` runs first and requires the fully
 *    credentialed caller to be *served* on every probe used as a negative case.
 * 2. **One predicate removed at a time.** Each negative describe block removes
 *    exactly one credential from a complete set and leaves the rest intact, so a
 *    red attributes to that predicate rather than to "the set matters".
 *
 * A note on §3.2's "Internal service token alone" column, because the code and
 * the table read differently for one cell and the difference is real: with only
 * the SEC-4 channel token, `POST /sessions` by form slug **succeeds** (201). It
 * has to: that is precisely how the portal BFF starts a session for an anonymous
 * respondent, and the matrix's first column already marks that row reachable by
 * anonymous callers. The column means "the service token confers no identity and
 * therefore no *authorized* action", not "every request carrying it alone is
 * refused". The row's actual control is rate limiting (026), not authentication.
 * This is recorded in `docs/security-review-2026-08-14.md` as an observation
 * against the table, not as a defect in the code.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedAdminSession } from "../../src/test-support.js";
import {
  adminLogin,
  AdminClient,
  MOUNT,
  RespondentClient,
  type StartBody,
  buildEnv,
  composeApi,
  mintInsuranceLink,
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
/** Session A's bearer: the "own session" column. */
let sessionToken: string;
/** Session B's bearer: the "other session" column. */
let otherSessionToken: string;
let linkToken: string;
/** A second form, for the cross-form scoping probes (issue #305). */
let otherFormId: string;
/** A submitted session belonging to `otherFormId`. */
let otherFormSessionId: string;

/** A complete credential set for an admin surface. Negative cases subtract from this. */
function adminHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [INTERNAL_TOKEN_HEADER]: internalToken,
    [ADMIN_SESSION_HEADER]: adminToken,
    ...overrides,
  };
}

/** A complete credential set for a respondent surface bound to session A. */
function respondentHeaders(bearer: string = sessionToken): Record<string, string> {
  return {
    [INTERNAL_TOKEN_HEADER]: internalToken,
    authorization: `Bearer ${bearer}`,
  };
}

/**
 * A refusal must not be a data leak. Nothing an unauthorized caller sees may
 * carry respondent content, a form definition, or a credential.
 */
function expectNoPayload(text: string): void {
  expect(text).not.toMatch(/"answers"|"step"|"documents"|"sessionToken"|"secret"/);
}

beforeAll(async () => {
  testDb = await startTestDb();
  // ONE env for both compositions so the public-only process shares the admin
  // process's tokens and keys (04-mount-split's rule: validEnv regenerates).
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

  const other = await seedInsuranceForm(testDb.db, {
    formId: "frm_other_tenant",
    slug: "other-tenant",
  });
  otherFormId = other.formId;
  const otherSession = await respondent.start<StartBody>({ formSlug: other.slug });
  expect(otherSession.status).toBe(201);
  otherFormSessionId = otherSession.body.sessionId;

  const admin = new AdminClient(all.app, internalToken, adminToken);
  const webhook = await admin.createWebhook<{ webhookId: string }>(formId, {
    url: "https://consumer.example/hook",
  });
  expect(webhook.status).toBe(201);

  ctx = {
    formId,
    formSlug: slug,
    sessionId: a.body.sessionId,
    otherSessionId: b.body.sessionId,
    linkId: LINK_ID,
    webhookId: webhook.body.webhookId,
    // No delivery exists yet; every probe against this path runs under a
    // credential the gate refuses before any handler resolves the id.
    deliveryId: "dlv_matrix_probe",
    questionId: "q_at_fault_accident",
  };
});

afterAll(async () => {
  await testDb?.teardown();
});

// --- 0. positive controls ---------------------------------------------------

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

// --- 1. column: no credential ----------------------------------------------

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

// --- 2. column: wrong channel credential ------------------------------------

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

// --- 3. column: internal service token alone --------------------------------

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
    // See the header comment: the channel token opens the channel, and this row
    // is open to anonymous callers by design. Recorded, not silently asserted.
    expect(res.status).toBe(201);
  });
});

// --- 4. column: wrong / stale / unqualified admin credential ----------------

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
        const res = await probe(all.app, surface, ctx, adminHeaders({ [ADMIN_SESSION_HEADER]: token }));
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

// --- 5. ADR-09: an unmounted group does not exist ---------------------------

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
      // The refusal must not name the endpoint it declined to publish.
      expect((await res.text()).toLowerCase()).not.toContain("sign-up");
    }
  });
});

// --- 6. column: another respondent's session token ---------------------------

describe("a session token authorizes exactly one session", () => {
  const perSession = SURFACES.filter(
    (s) => s.row === "step-answer-submit" && s.group === "public",
  );

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

// --- 7. purpose claims are not interchangeable (SEC-2, SEC-7) ---------------

describe("token purposes cannot be cross-used", () => {
  it("refuses a secure-link token presented as a session bearer", async () => {
    const step = SURFACES.find((s) => s.name === "GET /sessions/{id}/step") as Surface;
    const res = await probe(all.app, step, ctx, respondentHeaders(linkToken));
    expect(res.status).toBe(401);
    expectNoPayload(res.text);
  });

  it("refuses a session token presented as a secure link", async () => {
    const res = await all.app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_TOKEN_HEADER]: internalToken },
      body: JSON.stringify({ token: sessionToken }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("LINK_INVALID");
  });

  it("proves the link token is a real one before proving it is refused", async () => {
    // Without this, the previous case could pass on any garbage string.
    const res = await all.app.request("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_TOKEN_HEADER]: internalToken },
      body: JSON.stringify({ token: linkToken }),
    });
    expect(res.status).toBe(201);
  });
});

// --- 8. tampered and expired bearers ----------------------------------------

describe("tampered and expired session tokens", () => {
  const step = (): Surface => SURFACES.find((s) => s.name === "GET /sessions/{id}/step") as Surface;

  it("refuses a token whose signature segment was altered", async () => {
    const parts = sessionToken.split(".");
    const sig = parts[parts.length - 1] as string;
    const flipped = `${sig.slice(0, -1)}${sig.at(-1) === "A" ? "B" : "A"}`;
    const tampered = [...parts.slice(0, -1), flipped].join(".");
    expect(tampered).not.toBe(sessionToken);
    const res = await probe(all.app, step(), ctx, respondentHeaders(tampered));
    expect(res.status).toBe(401);
  });

  it("refuses a token whose claims segment was altered", async () => {
    const parts = sessionToken.split(".");
    const claims = parts[0] as string;
    const tampered = [`${claims.slice(0, -1)}${claims.at(-1) === "a" ? "b" : "a"}`, ...parts.slice(1)].join(
      ".",
    );
    expect(tampered).not.toBe(sessionToken);
    const res = await probe(all.app, step(), ctx, respondentHeaders(tampered));
    expect(res.status).toBe(401);
  });

  it("refuses a bearer that is not a token at all", async () => {
    for (const bogus of ["", "   ", "null", "Bearer", "a.b.c"]) {
      const res = await probe(all.app, step(), ctx, respondentHeaders(bogus));
      expect(res.status).toBe(401);
    }
  });
});

// --- 9. admin authority is scoped to the form in the path (issue #305) -------

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
  ])("refuses to %s another form's session through this form's path", async (_label, method, build) => {
    const res = await all.app.request(build(ctx.formId, otherFormSessionId), {
      method,
      headers: { "content-type": "application/json", ...adminHeaders() },
      ...(method === "POST" ? { body: JSON.stringify({ reason: "probe" }) } : {}),
    });
    expect(res.status).toBe(404);
    expectNoPayload(await res.text());
  });
});
