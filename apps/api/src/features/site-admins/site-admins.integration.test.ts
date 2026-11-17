import {
  approvalRequests,
  authSession,
  authUser,
  findHoldSuspension,
  getApprovalRequest,
  insertApprovalRequest,
  listSiteAudit,
  signInLinks,
  SITE_ADMINISTRATOR_ROLE,
  stepUps,
  suspensionMarkers,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { generate } from "otplib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER } from "../../middleware/admin-auth.js";
import { appGroups } from "../../registrars.js";
import { expireDueApprovalRequests } from "../../schedulers/retention-sweep.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import type { Mailer, MailMessage } from "../email/mailer.js";
import { ROUTE_POLICIES } from "../membership/route-policy.js";

const ALL = { public: true, internal: true, admin: true } as const;

const RELAY = {
  QCMS_SMTP_HOST: "smtp.example.test",
  QCMS_SMTP_FROM: "QCMS <no-reply@example.test>",
};

const FLOW_TIMEOUT_MS = 120_000;

/** More than the control pool's ten connections. */
const PARALLEL = 12;

function freshPassword(): string {
  return `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
}

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken = "";
let adminOrigin = "";
let seededAdminId = "";
let seededAdminToken = "";
let memberToken = "";
let workspaceId = "";

const mailbox: MailMessage[] = [];

const recordingMailer: Mailer = {
  configured: true,
  send: (message) => {
    mailbox.push(message);
    return Promise.resolve({ ok: true });
  },
};

function adminHeaders(token: string): Record<string, string> {
  return {
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: token,
    "content-type": "application/json",
  };
}

async function adminGet(path: string, token: string): Promise<Response> {
  return app.request(path, { headers: adminHeaders(token) });
}

async function adminSend(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  token: string,
  body: unknown = {},
): Promise<Response> {
  return app.request(path, { method, headers: adminHeaders(token), body: JSON.stringify(body) });
}

async function errorCodeOf(response: Response): Promise<string> {
  const body = (await response.clone().json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

async function authPost(path: string, body: unknown, cookie?: string): Promise<Response> {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "x-qcms-internal-token": internalToken,
      origin: adminOrigin,
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .filter((value): value is string => value !== undefined && value !== "")
    .join("; ");
}

function sessionTokenOf(cookie: string): string {
  const match = /session_token=([^;]+)/.exec(cookie);
  if (match?.[1] === undefined) throw new Error(`no session cookie in: ${cookie}`);
  return decodeURIComponent(match[1]).split(".")[0] ?? "";
}

function tokenFromNewestMessage(): string {
  const message = mailbox.at(-1);
  const match = /\/claim\?token=([A-Za-z0-9._~%-]+)/.exec(message?.text ?? "");
  if (match?.[1] === undefined) throw new Error("no link in the newest message");
  return decodeURIComponent(match[1]);
}

interface Person {
  readonly userId: string;
  readonly password: string;
  readonly secret: string;
  readonly session: string;
}

async function createAndClaim(email: string): Promise<Person> {
  const created = await adminSend("POST", "/admin/accounts", seededAdminToken, { email });
  expect(created.status, await created.clone().text()).toBe(201);
  const { account } = (await created.json()) as { account: { userId: string } };
  const password = freshPassword();
  const claimed = await authPost("/claim", { token: tokenFromNewestMessage(), password });
  expect(claimed.status, await claimed.clone().text()).toBe(200);
  const cookie = cookieHeader(claimed);
  const enabled = await authPost("/two-factor/enable", { password }, cookie);
  expect(enabled.status, await enabled.clone().text()).toBe(200);
  const { totpURI } = (await enabled.json()) as { totpURI: string };
  const issued = cookieHeader(enabled) === "" ? cookie : cookieHeader(enabled);
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  const verified = await authPost(
    "/two-factor/verify-totp",
    { code: await generate({ secret }) },
    issued,
  );
  expect(verified.status, await verified.clone().text()).toBe(200);
  const final = cookieHeader(verified) === "" ? issued : cookieHeader(verified);
  return { userId: account.userId, password, secret, session: sessionTokenOf(final) };
}

async function createUnclaimed(email: string, token: string): Promise<string> {
  const created = await adminSend("POST", "/admin/accounts", token, { email });
  expect(created.status, await created.clone().text()).toBe(201);
  return ((await created.json()) as { account: { userId: string } }).account.userId;
}

async function stepUp(person: Person, session = person.session): Promise<Response> {
  return adminSend("POST", "/admin/step-up", session, {
    password: person.password,
    code: await generate({ secret: person.secret }),
  });
}

async function steppedUp(person: Person): Promise<void> {
  const response = await stepUp(person);
  expect(response.status, await response.clone().text()).toBe(200);
}

/** Exactly these accounts hold the Site administrator role, each active and claimed. */
async function siteAdministratorsAre(...people: readonly { userId: string }[]): Promise<void> {
  const ids = people.map((person) => person.userId);
  await testDb.db.update(authUser).set({ role: null }).where(ne(authUser.id, "__none__"));
  if (ids.length > 0) {
    await testDb.db
      .update(authUser)
      .set({ role: SITE_ADMINISTRATOR_ROLE, disabledAt: null })
      .where(inArray(authUser.id, ids));
  }
}

async function roleOf(userId: string): Promise<string | null> {
  const [row] = await testDb.db
    .select({ role: authUser.role })
    .from(authUser)
    .where(eq(authUser.id, userId));
  return row?.role ?? null;
}

async function accountRow(userId: string): Promise<typeof authUser.$inferSelect> {
  const [row] = await testDb.db.select().from(authUser).where(eq(authUser.id, userId));
  if (row === undefined) throw new Error("no such account");
  return row;
}

async function siteRows(subject: string): Promise<{ kind: string; detail: string }[]> {
  const { rows } = await listSiteAudit(testDb.db, { limit: 500 });
  return rows
    .filter((row) => row.subject === subject)
    .map((row) => ({ kind: row.kind, detail: row.detail ?? "" }))
    .reverse();
}

async function held(response: Response): Promise<string> {
  expect(response.status, await response.clone().text()).toBe(202);
  const body = (await response.json()) as { request: { requestId: string; status: string } };
  expect(body.request.status).toBe("pending");
  return body.request.requestId;
}

async function approve(person: Person, requestId: string): Promise<Response> {
  return adminSend("POST", `/admin/approval-requests/${requestId}/approve`, person.session);
}

let a: Person;
let b: Person;
let c: Person;
let d: Person;

beforeAll(async () => {
  testDb = await startTestDb();
  const env = validEnv({ DATABASE_URL: testDb.connectionUri, ...RELAY });
  deps = makeDeps({
    db: testDb.db,
    env,
    clock: { now: () => new Date() },
    mailer: recordingMailer,
  });
  app = createApp(deps, ALL, { groups: appGroups });
  internalToken = internalTokenFor(deps.config);
  adminOrigin = deps.config.adminAuth.baseUrl;

  const seeded = await seedAdminSession(testDb.db, { label: "seed", at: new Date() });
  seededAdminId = seeded.userId;
  seededAdminToken = seeded.token;
  const member = await seedAdminSession(testDb.db, {
    label: "member",
    at: new Date(),
    claim: false,
    owner: true,
  });
  memberToken = member.token;
  const listed = await adminGet("/admin/workspaces", seededAdminToken);
  const { workspaces } = (await listed.json()) as { workspaces: { workspaceId: string }[] };
  workspaceId = workspaces[0]?.workspaceId ?? "";

  a = await createAndClaim("site.a@example.test");
  b = await createAndClaim("site.b@example.test");
  c = await createAndClaim("site.c@example.test");
  d = await createAndClaim("site.d@example.test");
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

beforeEach(async () => {
  await testDb.db.delete(stepUps);
  await testDb.db
    .update(approvalRequests)
    .set({ status: "rejected", decidedBy: "test-reset", decidedAt: new Date() })
    .where(eq(approvalRequests.status, "pending"));
});

describe("only a Site administrator reaches a site route (criterion 22)", () => {
  it("refuses a Workspace administrator and a member every installation-only route", async () => {
    const rows = ROUTE_POLICIES.filter((row) => row.installationOnly === true);
    expect(rows.map((row) => `${row.method} ${row.path}`)).toEqual(
      expect.arrayContaining([
        "POST /admin/step-up",
        "POST /admin/accounts/{id}/promote",
        "POST /admin/accounts/{id}/demote",
        "GET /admin/approval-requests",
        "GET /admin/approval-requests/{id}",
        "POST /admin/approval-requests/{id}/approve",
        "POST /admin/approval-requests/{id}/reject",
      ]),
    );
    for (const token of [memberToken, d.session]) {
      for (const row of rows) {
        const path = row.path
          .replaceAll("{id}", workspaceId)
          .replaceAll("{key}", "missing")
          .replace(/^\/admin\/accounts\/[^/]+/, `/admin/accounts/${a.userId}`);
        const response =
          row.method === "GET"
            ? await adminGet(path, token)
            : await adminSend(row.method, path, token, {});
        expect(response.status, `${row.method} ${row.path}`).toBe(403);
      }
    }
  });
});

describe("step-up (criterion 76)", () => {
  beforeEach(async () => {
    await siteAdministratorsAre(a);
  });

  it("is refused on a wrong password or code, and binds to the session that made it", async () => {
    const wrongPassword = await adminSend("POST", "/admin/step-up", a.session, {
      password: freshPassword(),
      code: await generate({ secret: a.secret }),
    });
    expect(wrongPassword.status).toBe(403);
    expect(await errorCodeOf(wrongPassword)).toBe("STEP_UP_FAILED");
    const wrongCode = await adminSend("POST", "/admin/step-up", a.session, {
      password: a.password,
      code: (await generate({ secret: a.secret })) === "000000" ? "111111" : "000000",
    });
    expect(await errorCodeOf(wrongCode)).toBe("STEP_UP_FAILED");

    const ok = await stepUp(a);
    expect(ok.status, await ok.clone().text()).toBe(200);
    const { expiresAt } = (await ok.json()) as { expiresAt: string };
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(4 * 60 * 1000);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);

    const other = `st_other_${crypto.randomUUID()}`;
    const now = new Date();
    await testDb.db.insert(authSession).values({
      id: `ss_other_${crypto.randomUUID().slice(0, 8)}`,
      token: other,
      userId: a.userId,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const fromOther = await adminSend("POST", `/admin/accounts/${d.userId}/promote`, other);
    expect(fromOther.status).toBe(403);
    expect(await errorCodeOf(fromOther)).toBe("STEP_UP_REQUIRED");
    expect(await roleOf(d.userId)).toBeNull();
  });

  it("refuses promote, demote and disable without a step-up, and one older than five minutes", async () => {
    await siteAdministratorsAre(a, b);
    for (const act of ["promote", "demote", "disable"] as const) {
      const target = act === "promote" ? d.userId : b.userId;
      const response = await adminSend("POST", `/admin/accounts/${target}/${act}`, a.session);
      expect(response.status, act).toBe(403);
      expect(await errorCodeOf(response), act).toBe("STEP_UP_REQUIRED");
    }
    await steppedUp(a);
    await testDb.db
      .update(stepUps)
      .set({ verifiedAt: new Date(Date.now() - 6 * 60 * 1000) })
      .where(eq(stepUps.userId, a.userId));
    const stale = await adminSend("POST", `/admin/accounts/${d.userId}/promote`, a.session);
    expect(await errorCodeOf(stale)).toBe("STEP_UP_REQUIRED");
    expect(await roleOf(d.userId)).toBeNull();
    expect(await roleOf(b.userId)).toBe(SITE_ADMINISTRATOR_ROLE);
  });

  it("locks a session out after five failures", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await adminSend("POST", "/admin/step-up", a.session, {
        password: freshPassword(),
        code: "123456",
      });
      expect(await errorCodeOf(response)).toBe("STEP_UP_FAILED");
    }
    const locked = await stepUp(a);
    expect(locked.status).toBe(403);
    expect(await errorCodeOf(locked)).toBe("STEP_UP_LOCKED");
  });
});

describe("promotion (criteria 77, 80, 82)", () => {
  it(
    "promotes on step-up alone with one Site administrator, and audits it",
    async () => {
      await siteAdministratorsAre(a);
      await steppedUp(a);
      const response = await adminSend("POST", `/admin/accounts/${b.userId}/promote`, a.session);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await roleOf(b.userId)).toBe(SITE_ADMINISTRATOR_ROLE);
      expect(await siteRows(b.userId)).toContainEqual({
        kind: "administrator",
        detail: "act=promote approval=step-up-only",
      });
    },
    FLOW_TIMEOUT_MS,
  );

  it("refuses to promote an unclaimed account", async () => {
    await siteAdministratorsAre(a);
    const unclaimed = await createUnclaimed(
      `unclaimed.${crypto.randomUUID()}@example.test`,
      a.session,
    );
    await steppedUp(a);
    const response = await adminSend("POST", `/admin/accounts/${unclaimed}/promote`, a.session);
    expect(response.status).toBe(409);
    expect(await errorCodeOf(response)).toBe("ACCOUNT_UNCLAIMED");
    expect(await roleOf(unclaimed)).toBeNull();
  });

  it(
    "holds a promotion with two Site administrators until the other approves",
    async () => {
      await siteAdministratorsAre(a, b);
      await steppedUp(a);
      const requestId = await held(
        await adminSend("POST", `/admin/accounts/${c.userId}/promote`, a.session),
      );
      expect(await roleOf(c.userId)).toBeNull();

      const own = await approve(a, requestId);
      expect(own.status).toBe(409);
      expect(await errorCodeOf(own)).toBe("OWN_REQUEST");

      const unstepped = await approve(b, requestId);
      expect(await errorCodeOf(unstepped)).toBe("STEP_UP_REQUIRED");

      await steppedUp(b);
      const approved = await approve(b, requestId);
      expect(approved.status, await approved.clone().text()).toBe(200);
      expect(await roleOf(c.userId)).toBe(SITE_ADMINISTRATOR_ROLE);
      expect((await getApprovalRequest(testDb.db, requestId))?.decidedBy).toBe(b.userId);

      const approvalRows = (await siteRows(requestId)).map((row) => row.detail);
      expect(approvalRows[0]).toBe(`act=request kind=promote target=${c.userId}`);
      expect(approvalRows[1]).toContain("act=approve kind=promote");
      expect(await siteRows(c.userId)).toContainEqual({
        kind: "administrator",
        detail: `act=promote request=${requestId} approver=${b.userId}`,
      });
    },
    FLOW_TIMEOUT_MS,
  );

  it("refuses a second pending request for the same act, and applies nothing on reject", async () => {
    await siteAdministratorsAre(a, b);
    await steppedUp(a);
    const requestId = await held(
      await adminSend("POST", `/admin/accounts/${d.userId}/promote`, a.session),
    );
    const again = await adminSend("POST", `/admin/accounts/${d.userId}/promote`, a.session);
    expect(await errorCodeOf(again)).toBe("REQUEST_PENDING");
    const rejected = await adminSend(
      "POST",
      `/admin/approval-requests/${requestId}/reject`,
      b.session,
    );
    expect(rejected.status, await rejected.clone().text()).toBe(200);
    expect(await roleOf(d.userId)).toBeNull();
    expect((await getApprovalRequest(testDb.db, requestId))?.status).toBe("rejected");
    await steppedUp(b);
    expect(await errorCodeOf(await approve(b, requestId))).toBe("REQUEST_NOT_PENDING");
  });
});

describe("demotion and disable (criteria 78, 79, 81, 83)", () => {
  it(
    "with exactly two, demotes and disables the other on step-up alone, and the row says so",
    async () => {
      await siteAdministratorsAre(a, b);
      await steppedUp(a);
      const demoted = await adminSend("POST", `/admin/accounts/${b.userId}/demote`, a.session);
      expect(demoted.status, await demoted.clone().text()).toBe(200);
      expect(await roleOf(b.userId)).toBeNull();
      expect(await siteRows(b.userId)).toContainEqual({
        kind: "administrator",
        detail: "act=demote approval=step-up-only",
      });

      await siteAdministratorsAre(a, d);
      const disabled = await adminSend("POST", `/admin/accounts/${d.userId}/disable`, a.session);
      expect(disabled.status, await disabled.clone().text()).toBe(200);
      const row = await accountRow(d.userId);
      expect(row.disabledAt).not.toBeNull();
      expect(row.role).toBeNull();
      expect((await siteRows(d.userId)).map((entry) => entry.detail)).toContain(
        "act=disable approval=step-up-only",
      );
      await testDb.db.update(authUser).set({ disabledAt: null }).where(eq(authUser.id, d.userId));
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "with three, holds a demotion and a disable for a third Site administrator; the target never approves",
    async () => {
      await siteAdministratorsAre(a, b, c);
      await steppedUp(a);
      const demoteId = await held(
        await adminSend("POST", `/admin/accounts/${c.userId}/demote`, a.session),
      );
      await steppedUp(c);
      const byTarget = await approve(c, demoteId);
      expect(await errorCodeOf(byTarget)).toBe("TARGET_DECIDES");
      const rejectedByTarget = await adminSend(
        "POST",
        `/admin/approval-requests/${demoteId}/reject`,
        c.session,
      );
      expect(await errorCodeOf(rejectedByTarget)).toBe("TARGET_DECIDES");
      expect(await roleOf(c.userId)).toBe(SITE_ADMINISTRATOR_ROLE);
      await steppedUp(b);
      const approved = await approve(b, demoteId);
      expect(approved.status, await approved.clone().text()).toBe(200);
      expect(await roleOf(c.userId)).toBeNull();

      await siteAdministratorsAre(a, b, c);
      const disableId = await held(
        await adminSend("POST", `/admin/accounts/${c.userId}/disable`, a.session),
      );
      expect((await accountRow(c.userId)).disabledAt).toBeNull();
      expect(await errorCodeOf(await approve(c, disableId))).toBe("TARGET_DECIDES");
      const applied = await approve(b, disableId);
      expect(applied.status, await applied.clone().text()).toBe(200);
      expect((await accountRow(c.userId)).disabledAt).not.toBeNull();
      expect((await siteRows(c.userId)).map((entry) => entry.detail)).toContain(
        `act=disable request=${disableId} approver=${b.userId}`,
      );
      await testDb.db.update(authUser).set({ disabledAt: null }).where(eq(authUser.id, c.userId));
    },
    FLOW_TIMEOUT_MS,
  );

  it("counts neither an unclaimed nor a disabled Site administrator, and neither can approve", async () => {
    await siteAdministratorsAre(a, b, c, d);
    await testDb.db.update(authUser).set({ claimedAt: null }).where(eq(authUser.id, c.userId));
    await testDb.db
      .update(authUser)
      .set({ disabledAt: new Date() })
      .where(eq(authUser.id, d.userId));
    try {
      await steppedUp(a);
      const demoted = await adminSend("POST", `/admin/accounts/${b.userId}/demote`, a.session);
      expect(demoted.status, await demoted.clone().text()).toBe(200);

      await siteAdministratorsAre(a, b);
      await testDb.db
        .update(authUser)
        .set({ role: SITE_ADMINISTRATOR_ROLE })
        .where(inArray(authUser.id, [c.userId, d.userId]));
      await testDb.db
        .update(authUser)
        .set({ disabledAt: new Date() })
        .where(eq(authUser.id, d.userId));
      const promoteId = await insertApprovalRequest(testDb.db, {
        kind: "promote",
        target: seededAdminId,
        payload: {},
        requestedBy: a.userId,
        requestedAt: new Date(),
      });
      for (const session of [c.session, d.session]) {
        const response = await adminSend(
          "POST",
          `/admin/approval-requests/${promoteId?.requestId ?? ""}/approve`,
          session,
        );
        expect(response.status).toBe(401);
      }
    } finally {
      await testDb.db
        .update(authUser)
        .set({ claimedAt: new Date(), disabledAt: null })
        .where(inArray(authUser.id, [c.userId, d.userId]));
    }
  });

  it("never demotes the last active Site administrator, and re-checks the requester on approval", async () => {
    await siteAdministratorsAre(a);
    const self = await adminSend("POST", `/admin/accounts/${a.userId}/demote`, a.session);
    expect(self.status).toBe(409);
    expect(await errorCodeOf(self)).toBe("LAST_SITE_ADMINISTRATOR");

    await siteAdministratorsAre(a, b, c);
    await steppedUp(a);
    const requestId = await held(
      await adminSend("POST", `/admin/accounts/${c.userId}/demote`, a.session),
    );
    await testDb.db.update(authUser).set({ claimedAt: null }).where(eq(authUser.id, a.userId));
    try {
      await steppedUp(b);
      const refused = await approve(b, requestId);
      expect(refused.status).toBe(409);
      expect(await errorCodeOf(refused)).toBe("REQUESTER_NOT_SITE_ADMINISTRATOR");
      expect(await roleOf(c.userId)).toBe(SITE_ADMINISTRATOR_ROLE);
      expect((await getApprovalRequest(testDb.db, requestId))?.status).toBe("pending");
    } finally {
      await testDb.db
        .update(authUser)
        .set({ claimedAt: new Date() })
        .where(eq(authUser.id, a.userId));
    }
  });
});

describe("expiry (criterion 84)", () => {
  it("refuses approval after 7 days, and the sweep expires the request and audits it", async () => {
    await siteAdministratorsAre(a, b);
    await steppedUp(a);
    const requestId = await held(
      await adminSend("POST", `/admin/accounts/${d.userId}/promote`, a.session),
    );
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await testDb.db
      .update(approvalRequests)
      .set({
        requestedAt: eightDaysAgo,
        expiresAt: new Date(eightDaysAgo.getTime() + 7 * 24 * 60 * 60 * 1000),
      })
      .where(eq(approvalRequests.requestId, requestId));
    await steppedUp(b);
    const late = await approve(b, requestId);
    expect(late.status).toBe(409);
    expect(await errorCodeOf(late)).toBe("REQUEST_EXPIRED");
    expect(await roleOf(d.userId)).toBeNull();

    expect(await expireDueApprovalRequests(deps, new Date())).toBeGreaterThanOrEqual(1);
    expect((await getApprovalRequest(testDb.db, requestId))?.status).toBe("expired");
    expect((await siteRows(requestId)).map((row) => row.detail)).toContain(
      `act=expire kind=promote target=${d.userId} requester=${a.userId}`,
    );
  });
});

describe("the request table refuses what a request may never hold", () => {
  it("refuses a payload that fails its kind's shape, and a window other than 7 days", async () => {
    for (const [kind, payload] of [
      ["promote", { extra: true }],
      ["reset", { password: false, factor: false }],
      ["self-grant", { roles: "responses.viewer", environments: [] }],
      ["draft-publish", { revision: 1, contentHash: "nothex" }],
      ["move-form", {}],
    ] as const) {
      await expect(
        insertApprovalRequest(testDb.db, {
          kind,
          ...(kind === "promote" || kind === "reset" ? {} : { workspaceId }),
          target: a.userId,
          payload,
          requestedBy: b.userId,
          requestedAt: new Date(),
        }),
        kind,
      ).rejects.toThrow(/payload/);
    }
    const now = new Date();
    await expect(
      testDb.db.insert(approvalRequests).values({
        requestId: `apr_${crypto.randomUUID()}`,
        scope: "site",
        kind: "promote",
        target: a.userId,
        payload: {},
        requestedBy: b.userId,
        requestedAt: now,
        expiresAt: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000),
      }),
    ).rejects.toThrow();
    const stored = await insertApprovalRequest(testDb.db, {
      kind: "promote",
      target: a.userId,
      payload: {},
      requestedBy: b.userId,
      requestedAt: now,
    });
    await expect(
      testDb.db
        .update(approvalRequests)
        .set({ status: "approved", decidedBy: b.userId, decidedAt: now })
        .where(eq(approvalRequests.requestId, stored?.requestId ?? "")),
    ).rejects.toThrow();
  });
});

describe("resetting a Site administrator", () => {
  it(
    "with three, holds the reset; on approval the requester is its performer",
    async () => {
      await siteAdministratorsAre(a, b, c);
      await steppedUp(a);
      const requestId = await held(
        await adminSend("POST", `/admin/accounts/${c.userId}/reset`, a.session, {
          password: false,
          factor: true,
        }),
      );
      expect((await accountRow(c.userId)).claimedAt).not.toBeNull();
      await steppedUp(b);
      const sent = mailbox.length;
      const approved = await approve(b, requestId);
      expect(approved.status, await approved.clone().text()).toBe(200);
      expect(((await approved.json()) as { delivery?: string }).delivery).toBe("sent");
      expect(mailbox.length).toBe(sent + 1);
      expect((await accountRow(c.userId)).claimedAt).toBeNull();
      const [link] = await testDb.db
        .select({ issuedBy: signInLinks.issuedBy })
        .from(signInLinks)
        .where(and(eq(signInLinks.userId, c.userId), isNull(signInLinks.usedAt)));
      expect(link?.issuedBy).toBe(a.userId);
      const markers = await testDb.db
        .select({ performedBy: suspensionMarkers.performedBy })
        .from(suspensionMarkers)
        .where(and(eq(suspensionMarkers.userId, c.userId), isNull(suspensionMarkers.liftedAt)));
      expect(markers.map((row) => row.performedBy)).toEqual([a.userId]);
      expect((await siteRows(c.userId)).map((row) => row.detail).at(-1)).toContain(
        `request=${requestId} approver=${b.userId}`,
      );
    },
    FLOW_TIMEOUT_MS,
  );
});

describe("concurrency", () => {
  it(
    "two Site administrators demoting each other at once leave one, and nothing queues",
    async () => {
      await siteAdministratorsAre(a, b);
      await steppedUp(a);
      await steppedUp(b);
      const started = Date.now();
      const responses = await Promise.all(
        Array.from({ length: PARALLEL }, (_, i) =>
          i % 2 === 0
            ? adminSend("POST", `/admin/accounts/${b.userId}/demote`, a.session)
            : adminSend("POST", `/admin/accounts/${a.userId}/demote`, b.session),
        ),
      );
      const elapsed = Date.now() - started;
      const statuses = responses.map((response) => response.status);
      expect(
        statuses.every((status) => status === 200 || status === 409),
        String(statuses),
      ).toBe(true);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      const [remaining] = await testDb.db
        .select({ total: sql<number>`count(*)::int` })
        .from(authUser)
        .where(eq(authUser.role, SITE_ADMINISTRATOR_ROLE));
      expect(remaining?.total).toBe(1);
      expect(elapsed).toBeLessThan(15_000);
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "parallel promotion requests from one requester leave one pending request",
    async () => {
      await siteAdministratorsAre(a, b);
      await steppedUp(a);
      const responses = await Promise.all(
        Array.from({ length: PARALLEL }, () =>
          adminSend("POST", `/admin/accounts/${d.userId}/promote`, a.session),
        ),
      );
      const statuses = responses.map((response) => response.status);
      expect(
        statuses.every((status) => status === 202 || status === 409),
        String(statuses),
      ).toBe(true);
      const pending = await testDb.db
        .select({ requestId: approvalRequests.requestId })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.status, "pending"),
            eq(approvalRequests.kind, "promote"),
            eq(approvalRequests.target, d.userId),
          ),
        );
      expect(pending).toHaveLength(1);
    },
    FLOW_TIMEOUT_MS,
  );
});

describe("the stored suspension marker", () => {
  it(
    "keeps a removed and re-added hold suspended for anyone, and ends the run once settled",
    async () => {
      await siteAdministratorsAre(a, b, { userId: seededAdminId });
      const group = await adminSend(
        "POST",
        `/admin/workspaces/${workspaceId}/access-groups`,
        seededAdminToken,
        {
          name: `Marker viewers ${crypto.randomUUID().slice(0, 6)}`,
          roles: ["responses.viewer"],
          environments: ["prod"],
        },
      );
      const teamId = ((await group.json()) as { group: { teamId: string } }).group.teamId;
      const path = `/admin/workspaces/${workspaceId}/access-groups/${teamId}/holders`;
      expect((await adminSend("POST", path, seededAdminToken, { userId: d.userId })).status).toBe(
        201,
      );

      const reset = await adminSend("POST", `/admin/accounts/${d.userId}/reset`, a.session, {
        password: true,
        factor: false,
      });
      expect(reset.status, await reset.clone().text()).toBe(200);
      expect((await findHoldSuspension(testDb.db, teamId, d.userId))?.suspendedBy).toBe(a.userId);

      const removed = await adminSend("DELETE", `${path}/${d.userId}`, b.session);
      expect(removed.status).toBe(204);
      expect((await adminSend("POST", path, b.session, { userId: d.userId })).status).toBe(201);
      expect((await findHoldSuspension(testDb.db, teamId, d.userId))?.suspendedAt).not.toBeNull();

      const reconfirmed = await adminSend("POST", `${path}/${d.userId}/reconfirm`, b.session);
      expect(reconfirmed.status, await reconfirmed.clone().text()).toBe(200);
      expect((await findHoldSuspension(testDb.db, teamId, d.userId))?.suspendedAt).toBeNull();

      const password = freshPassword();
      const claimed = await authPost("/claim", { token: tokenFromNewestMessage(), password });
      expect(claimed.status, await claimed.clone().text()).toBe(200);
      const code = await generate({ secret: d.secret });
      const verified = await authPost("/two-factor/verify-totp", { code }, cookieHeader(claimed));
      expect(verified.status, await verified.clone().text()).toBe(200);
      d = { ...d, password, session: sessionTokenOf(cookieHeader(verified)) };
      expect((await accountRow(d.userId)).claimedAt).not.toBeNull();

      const open = await testDb.db
        .select({ id: suspensionMarkers.id })
        .from(suspensionMarkers)
        .where(and(eq(suspensionMarkers.userId, d.userId), isNull(suspensionMarkers.liftedAt)));
      expect(open).toHaveLength(0);

      expect((await adminSend("DELETE", `${path}/${d.userId}`, a.session)).status).toBe(204);
      expect((await adminSend("POST", path, a.session, { userId: d.userId })).status).toBe(201);
      expect((await findHoldSuspension(testDb.db, teamId, d.userId))?.suspendedAt).toBeNull();
    },
    FLOW_TIMEOUT_MS,
  );
});
