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

import { Buffer } from "node:buffer";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SEED_WORKSPACE_ID } from "@roonga/qcms-db/testing";
import {
  addAccessGroupHolder,
  authOrganization,
  createAccessGroup,
  ensureWorkspaceMember,
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
/** Session A's bearer: the "own session" column. */
let sessionToken: string;
/** Session B's bearer: the "other session" column. */
let otherSessionToken: string;
let linkToken: string;
/** A second form, for the cross-form scoping probes (issue #305). */
let otherFormId: string;
/** A submitted session belonging to `otherFormId`. */
let otherFormSessionId: string;
/** The same database and forms, composed with every key list rotated (SEC-7). */
let rotated: ReturnType<typeof composeApi>;
/** The head (signing) entry of each rotated list. */
let freshInternalToken: string;
/** An access group in the seeded workspace, and somebody holding it (task 069). */
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

  // A third composition over the same database, with a fresh key at the head of
  // every list and the original key retained behind it. This is SEC-7's rotation
  // model ("first entry signs, all entries verify") as a running process rather
  // than as a config-parser property.
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

  // A second form over the *same* library questions: `seedInsuranceForm` would
  // re-seed them and collide on the questions primary key, so the form is
  // created through the admin surface and given a published version directly.
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
  // Submitted, so it is a real response row the admin surface can read: the
  // positive control below has to be genuinely servable for the cross-form
  // refusals to mean anything.
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

  // The membership fixtures (task 069). `seedGrants` writes them the way the product's
  // write path does - a team row, a `teamMember` row and the `member` row finding G
  // requires - rather than through the endpoints, because these probes are about the
  // gates in front of those endpoints and a fixture built by the thing under test proves
  // less.
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
    // No delivery exists yet; every probe against this path runs under a
    // credential the gate refuses before any handler resolves the id.
    deliveryId: "dlv_matrix_probe",
    questionId: "q_at_fault_accident",
    // The workspace the seed put the form and its questions in (ADR-41, task 068). A real
    // id, so `GET /admin/workspaces` is genuinely servable as a positive control and the
    // archive and shared-switch probes name a row that exists: a probe against an id that
    // did not would be refused by the handler even where a gate had failed, which is the
    // one way these probes could pass for the wrong reason.
    workspaceId: SEED_WORKSPACE_ID,
    // An access group and a holder in it, so the membership probes name rows that exist:
    // a probe against an id that did not would be refused by the handler even where a
    // gate had failed, which is the one way these probes could pass for the wrong reason
    // (task 069).
    teamId: probeTeamId,
    holderId: probeHolderId,
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

// --- 7. purpose claims are not interchangeable (SEC-2, SEC-7) ---------------

describe("token purposes cannot be cross-used", () => {
  it("refuses a secure-link token presented as a session bearer", async () => {
    const step = SURFACES.find((s) => s.name === "GET /sessions/{id}/step") as Surface;
    const res = await probe(all.app, step, ctx, respondentHeaders(linkToken));
    expect(res.status).toBe(401);
    expectNoPayload(res.text);
  });

  it("refuses a session token presented as a secure link", async () => {
    // The secure-link door is `POST /sessions/link` since task 066 (Q21). Posting a
    // session token to `POST /sessions` would now be refused by the anonymous body's
    // strict object instead, which proves nothing about cross-purpose tokens.
    const res = await all.app.request("/sessions/link", {
      method: "POST",
      headers: { "content-type": "application/json", [INTERNAL_TOKEN_HEADER]: internalToken },
      body: JSON.stringify({ token: sessionToken }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("LINK_INVALID");
  });

  it("proves the link token is a real one before proving it is refused", async () => {
    // Without this, the previous case could pass on any garbage string.
    const res = await all.app.request("/sessions/link", {
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

  /**
   * Alter one segment of a compact token so its **decoded bytes** change.
   *
   * The first version of these two cases mutated the *last* character of the
   * segment, and was flaky at a measured 6 to 25 percent depending on segment
   * length. base64url encodes 6 bits per character, so unless the byte length
   * is a multiple of 3 the final character carries unused padding bits: several
   * distinct final characters decode to identical bytes. Flipping the last
   * character therefore produced, some fraction of runs, a *different string
   * that was still a valid signature* - the request was served 200 and the
   * assertion failed, for exactly the reason the test was supposed to disprove.
   *
   * The first character always carries six significant bits, so mutating it
   * cannot be a no-op. The assertion below proves that per run rather than
   * trusting the argument: if a future edit reintroduces a mutation that does
   * not move the bytes, this fails here rather than intermittently downstream.
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
    // Positive control for this block: without it, a suite-wide breakage of the
    // respondent path would make both tamper cases pass for the wrong reason.
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

// --- 10. key rotation overlap (SEC-7) ---------------------------------------

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
    // `sessionToken` was minted by the pre-rotation composition.
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
    // The discriminator. Without it, every assertion above would also pass if
    // rotation were a no-op that ignored the new head entirely.
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

// --- 11. the two role families, over HTTP (task 069, criteria 1 to 6 and 10) --

/**
 * The role half of the §3.2 matrix, as requests rather than as a pure function.
 *
 * `apps/api/src/features/membership/policy.test.ts` walks every role against **every**
 * action exhaustively, which is what a pure function allows and an e2e suite does not.
 * What this block adds is the thing that file cannot assert: that the refusal is a **403
 * over the wire, from a real route, under a real session**, with no payload in it - and
 * that the enforcement is in the API rather than in a BFF or a screen (criterion 10). A
 * caller here talks to the API directly, which is exactly the bypass that criterion is
 * about.
 *
 * Each account below holds one shape and **no installation claim**, because the claim
 * administers memberships across every workspace (Q29): an account that kept it would be
 * asserting the claim rather than the role.
 */
describe("the two role families refuse across each other (criteria 2 to 5)", () => {
  /** One account holding exactly these roles, scoped to `all` unless narrowed. */
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
   * One access group with a narrow scope, written the way the product's write path writes
   * one: a `team` row carrying the role and the scope, a `teamMember` row that **is** the
   * grant, and the `member` row finding G requires.
   *
   * Written through `@roonga/qcms-db` rather than through the membership endpoints
   * because what this block probes is the gates in front of those endpoints, and a
   * fixture built by the thing under test proves less.
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

  /** A `forms.approver` holding exactly these environments. */
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

  /** A `responses.viewer` limited to one form list (Q28's case officer). */
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

  /** An account whose only grant is a `forms.viewer` in a workspace of its own. */
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
    // The probe the work order says to write first. If this passes before the families
    // exist, the resolver is reading a ladder.
    const token = await accountHolding("probe-editor", ["forms.editor"]);
    for (const environment of ["prod", "test"]) {
      const res = await all.app.request(`/admin/forms/${ctx.formId}/responses`, {
        headers: { ...headersFor(token), "x-qcms-environment": environment },
      });
      expect(res.status, `forms.editor read responses in ${environment}`).toBe(403);
      expectNoPayload(await res.text());
    }
    // And the same account is genuinely served the authoring read, so the refusal above
    // is about the family rather than about the account being broken.
    expect((await get(token, `/admin/forms/${ctx.formId}`)).status).toBe(200);
  });

  it("gives a `forms.owner` no response and no form at all (criterion 2, Q27)", async () => {
    const token = await accountHolding("probe-owner", [], { owner: true });
    expect((await get(token, `/admin/forms/${ctx.formId}/responses`)).status).toBe(403);
    // The owner column touches no form row either: an owner administers a workspace and
    // does nothing inside it.
    expect((await get(token, `/admin/forms/${ctx.formId}`)).status).toBe(403);
    // What it does reach is the membership list, which is its own column.
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
    // It reads each environment's link and endpoint configuration, production included,
    // because authoring roles are workspace-wide and only the writes are scoped.
    expect((await get(token, `/admin/forms/${ctx.formId}/webhooks`)).status).toBe(200);
    expect((await get(token, `/admin/forms/${ctx.formId}/links`)).status).toBe(200);
    // And it changes none of it, and reads no response.
    expect((await post(token, `/admin/forms/${ctx.formId}/publish`, {})).status).toBe(403);
    expect((await get(token, `/admin/forms/${ctx.formId}/responses`)).status).toBe(403);
  });

  it("refuses an environment-scoped act outside the grant's environments (criterion 4)", async () => {
    // A grant scoped to `test` is refused every environment-scoped action in `prod` on
    // the same workspace. The release route names its environment in the body, so this
    // is the one act whose environment does not come from the switcher.
    const scoped = await seedAdminSession(testDb.db, {
      label: "probe-test-only",
      claim: false,
      owner: false,
      // No default grants: the whole point is that this account holds ONE group, scoped
      // to `test`, so the seeded `all`-scoped set would make the refusal untestable.
      grants: [],
    });
    // One group, scoped to `test` alone, written the way the product writes one.
    const narrow = await createScopedApproverGroup(scoped.userId, ["test"]);
    expect(narrow).toBeDefined();

    const toProd = await post(scoped.token, `/admin/forms/${ctx.formId}/releases`, {
      environment: "prod",
      version: 1,
    });
    expect(toProd.status).toBe(403);
    expectNoPayload(await toProd.text());

    // And the same account releasing to the environment it does hold is not refused by
    // the gate: whatever the handler then says, it is not a 403.
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
    // The matrix's `never` row, as a request. The account holds the claim and **no
    // grant**, so what it reaches is settings, memberships and environments - and no
    // response read, no export and no erasure.
    const claimOnly = await seedAdminSession(testDb.db, {
      label: "probe-claim",
      membership: false,
    });
    expect(
      (await get(claimOnly.token, `/admin/workspaces/${ctx.workspaceId}/members`)).status,
    ).toBe(200);
    // The live set, served whole to the claim: administering environments across every
    // workspace is what the claim is for.
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
    // And authoring is not the claim's either: it needs a `forms.` grant in the form's
    // workspace.
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

    // The environment list is the one admin read this account is **served**, and what it
    // is served is **nothing**: the route answers the environments the caller holds in
    // some grant (Q25), so an account holding none gets an empty list rather than a
    // refusal. Same outcome, different shape, and the shape is the route's: a caller has
    // to be able to learn which environments they can act in without first holding a
    // grant to ask.
    const environments = await get(nobody.token, "/admin/environments");
    expect(environments.status).toBe(200);
    expect((await environments.json()) as { environments: unknown[] }).toEqual({
      environments: [],
    });
  });

  it("narrows the library lists to the caller's own workspaces (ADR-41's premise)", async () => {
    // Two groups sharing one installation do not see each other's forms, which is the
    // gap ADR-41 opens with. The account below holds a grant in a workspace of its own.
    const other = await createWorkspaceWithViewer("probe-elsewhere");
    const res = await get(other.token, "/admin/forms");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { forms: { formId: string }[] };
    expect(body.forms.map((form) => form.formId)).not.toContain(ctx.formId);
  });
});

// --- 12. the environment a request is authorised for is the one it acts in ----

/**
 * The two bypasses PR #1061's first review found by probe, as regression tests.
 *
 * Both let a `forms.editor` scoped to `test` perform a **production** write the matrix
 * gives only to a `forms.approver` holding `prod` in scope, and neither was visible to the
 * criterion 4 probe above: that one uses the release route, whose body **is** the
 * handler's source of the environment, so the one route where body and handler already
 * agreed was the one being tested.
 *
 * **B1.** Four environment-naming routes declare no request body at all, so their handler
 * takes the environment from the Q6 switcher. The middleware read the body first and fell
 * back to the switcher, and `@hono/zod-openapi` validates only what a route declares - so
 * a body of `{"environment":"test"}` with `x-qcms-environment: prod` was authorised
 * against `test` and performed in `prod`.
 *
 * **B2.** `publish-and-release` was gated as the publish half alone, with the release half
 * left to a handler that never asked for it.
 *
 * Each case asserts the refusal **and the effect**: a status alone would pass against a
 * handler that refused for an unrelated reason, and what makes this a bypass test is that
 * the production object is untouched afterwards.
 */
describe("the environment a request is authorised for is the environment it acts in", () => {
  /** The editor this block probes with: one grant, `test` only, no claim, no owner row. */
  let testEditor = "";
  /**
   * A `responses.eraser` scoped to `test`, for the unflag row.
   *
   * Unflag is `response: dispose`, which no `forms.editor` holds in any environment, so
   * the editor is refused there for the wrong reason and the forged body proves nothing.
   * The account that makes that row a bypass probe is the one the review named: an eraser
   * who holds the act in `test` and must not reach it in `prod`.
   */
  let testEraser = "";
  /** A production link and a production webhook on the seeded form, minted as the admin. */
  let prodLinkId = "";
  let prodWebhookId = "";

  function headersFor(token: string, environment: string, json = false): Record<string, string> {
    return {
      ...(json ? { "content-type": "application/json" } : {}),
      [INTERNAL_TOKEN_HEADER]: internalToken,
      [ADMIN_SESSION_HEADER]: token,
      [REQUEST_ENVIRONMENT_HEADER]: environment,
    };
  }

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

    // The production objects the editor must not reach. Minted by the fully credentialed
    // admin, in `prod`, which is the environment the interim switcher resolves to.
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

  /** Whether the production link is still active, read as the fully credentialed admin. */
  async function prodLinkIsActive(): Promise<boolean> {
    const listed = await all.app.request(`/admin/forms/${ctx.formId}/links`, {
      headers: headersFor(adminToken, "prod"),
    });
    const body = (await listed.json()) as { links: { linkId: string; state: string }[] };
    return body.links.some((link) => link.linkId === prodLinkId && link.state === "active");
  }

  /** Whether the production webhook is still active. */
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
      // The eraser, not the editor: see `testEraser`.
      "unflag",
      "POST",
      (): string => `/admin/forms/${ctx.formId}/responses/${ctx.sessionId}/unflag`,
      (): string => testEraser,
    ],
  ])(
    "%s refuses a test-scoped holder whether or not the body forges an environment (B1)",
    async (_label, method, path, token) => {
      // Without a body: the matrix, as criterion 4 states it.
      const plain = await all.app.request(path(), {
        method,
        headers: headersFor(token(), "prod"),
      });
      expect(plain.status).toBe(403);
      expectNoPayload(await plain.text());

      // With one: the request names `test` to the gate and `prod` to the handler. Refused,
      // and the refusal is the route's own - it takes its environment from the switcher,
      // so a body naming one is a key nobody can have meant.
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
    // The assertion that makes the four cases above a bypass test rather than a status
    // test: at the first review both of these came back false, because the editor's
    // forged body had revoked the link and deactivated the webhook.
    expect(await prodLinkIsActive(), "the prod link was revoked by a test-scoped editor").toBe(
      true,
    );
    expect(
      await prodWebhookIsActive(),
      "the prod webhook was deactivated by a test-scoped editor",
    ).toBe(true);
  });

  it("refuses a test-scoped editor `publish-and-release` into prod (B2)", async () => {
    // The combined route is two cells of the matrix, and the release half is the one the
    // first version left to a handler that never asked. The refusal has to be the gate's
    // 403 rather than the handler's 409: a 409 means the request reached a handler that
    // would have released to production had a draft been there.
    const refused = await all.app.request(`/admin/forms/${ctx.formId}/publish-and-release`, {
      method: "POST",
      headers: headersFor(testEditor, "test", true),
      body: JSON.stringify({ environment: "prod" }),
    });
    expect(refused.status, await refused.clone().text()).toBe(403);
    expect(await refused.text()).toContain("release: create");
  });

  it("allows the same route to `test`, where that editor does hold the release half", async () => {
    // The positive control, and it is the discriminator: without it the refusal above
    // would also pass against a row that refused everybody. Whatever the handler then
    // says about the draft, it is not a 403.
    const allowed = await all.app.request(`/admin/forms/${ctx.formId}/publish-and-release`, {
      method: "POST",
      headers: headersFor(testEditor, "test", true),
      body: JSON.stringify({ environment: "test" }),
    });
    expect(allowed.status).not.toBe(403);
  });

  it("refuses a body that names no environment on a route whose body carries it", async () => {
    // The other half of the per-row rule: a `body` row authorises against the body, so a
    // body naming nothing is refused here rather than falling back to the switcher, which
    // would authorise against an environment the handler is not going to use.
    const empty = await all.app.request(`/admin/forms/${ctx.formId}/publish-and-release`, {
      method: "POST",
      headers: headersFor(testEditor, "test", true),
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
  });
});
