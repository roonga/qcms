import {
  authMember,
  authSession,
  authUser,
  disableAccount,
  listAccessAudit,
  listSiteAudit,
  makeSiteAdministrator,
  signInLinks,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { and, eq, isNull } from "drizzle-orm";
import { generate } from "otplib";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER } from "../../middleware/admin-auth.js";
import { appGroups } from "../../registrars.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { ROUTE_POLICIES } from "../membership/route-policy.js";
import type { Mailer, MailMessage } from "../email/mailer.js";

// A real clock, as in `accounts.integration.test.ts`: better-auth stamps the rows it writes
// with wall time, and this suite signs accounts in through the library.

const ALL = { public: true, internal: true, admin: true } as const;

const RELAY = {
  QCMS_SMTP_HOST: "smtp.example.test",
  QCMS_SMTP_FROM: "QCMS <no-reply@example.test>",
};

/** Several password hashes and verifies per case; five seconds is no budget on a loaded host. */
const FLOW_TIMEOUT_MS = 60_000;

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
let siteAdminId = "";
let siteAdminToken = "";
let secondSiteAdminId = "";
let secondSiteAdminToken = "";
let workspaceAdminId = "";
let workspaceAdminToken = "";
let workspaceId = "";
let viewersGroupId = "";
let editorsGroupId = "";

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
  const body = (await response.json()) as { error?: { code?: string } };
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

function newestMessage(): MailMessage {
  const message = mailbox.at(-1);
  if (message === undefined) throw new Error("no message was sent");
  return message;
}

function tokenFromNewestMessage(): string {
  const match = /\/claim\?token=([A-Za-z0-9._~%-]+)/.exec(newestMessage().text);
  if (match?.[1] === undefined) throw new Error("no link in the newest message");
  return decodeURIComponent(match[1]);
}

/** A TOTP code for the window after `previous`, so a replay guard never sees one twice. */
async function freshCode(secret: string, previous?: string): Promise<string> {
  for (let attempt = 0; attempt < 70; attempt += 1) {
    const code = await generate({ secret });
    if (code !== previous) return code;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("no fresh TOTP window");
}

interface Person {
  readonly userId: string;
  readonly email: string;
  password: string;
  secret: string;
  lastCode: string;
  session: string;
}

/** Enrol a factor on a session that has none yet, which writes the claim. */
async function enrolFactor(
  cookie: string,
  password: string,
): Promise<{ cookie: string; secret: string; code: string }> {
  const enabled = await authPost("/two-factor/enable", { password }, cookie);
  expect(enabled.status, await enabled.clone().text()).toBe(200);
  const { totpURI } = (await enabled.json()) as { totpURI: string };
  const issued = cookieHeader(enabled) === "" ? cookie : cookieHeader(enabled);
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  const code = await generate({ secret });
  const verified = await authPost("/two-factor/verify-totp", { code }, issued);
  expect(verified.status, await verified.clone().text()).toBe(200);
  return {
    cookie: cookieHeader(verified) === "" ? issued : cookieHeader(verified),
    secret,
    code,
  };
}

async function createAndClaim(email: string): Promise<Person> {
  const created = await adminSend("POST", "/admin/accounts", siteAdminToken, { email });
  expect(created.status, await created.clone().text()).toBe(201);
  const { account } = (await created.json()) as { account: { userId: string } };
  const password = freshPassword();
  const claimed = await authPost("/claim", { token: tokenFromNewestMessage(), password });
  expect(claimed.status, await claimed.clone().text()).toBe(200);
  const enrolled = await enrolFactor(cookieHeader(claimed), password);
  return {
    userId: account.userId,
    email,
    password,
    secret: enrolled.secret,
    lastCode: enrolled.code,
    session: sessionTokenOf(enrolled.cookie),
  };
}

async function grant(group: string, userId: string, workspace = workspaceId): Promise<void> {
  const response = await adminSend(
    "POST",
    `/admin/workspaces/${workspace}/access-groups/${group}/holders`,
    siteAdminToken,
    { userId },
  );
  expect(response.status, await response.clone().text()).toBe(201);
}

async function appoint(userId: string, workspace = workspaceId): Promise<void> {
  const response = await adminSend(
    "PUT",
    `/admin/workspaces/${workspace}/members/${userId}`,
    siteAdminToken,
    { role: "forms.owner" },
  );
  expect(response.status, await response.clone().text()).toBe(200);
}

async function createGroup(
  workspace: string,
  name: string,
  roles: string[],
  environments: string[],
): Promise<string> {
  const response = await adminSend(
    "POST",
    `/admin/workspaces/${workspace}/access-groups`,
    siteAdminToken,
    { name, roles, environments },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { group: { teamId: string } }).group.teamId;
}

async function myAccess(
  session: string,
): Promise<{ installationAdmin: boolean; workspaces: Map<string, { role: string | null; groups: string[] }> }> {
  const response = await adminGet("/admin/me/access", session);
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as {
    installationAdmin: boolean;
    workspaces: { workspaceId: string; memberRole: string | null; grants: { name: string }[] }[];
  };
  return {
    installationAdmin: body.installationAdmin,
    workspaces: new Map(
      body.workspaces.map((row) => [
        row.workspaceId,
        { role: row.memberRole, groups: row.grants.map((held) => held.name).sort() },
      ]),
    ),
  };
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await testDb.db
    .select({ id: authSession.id })
    .from(authSession)
    .where(eq(authSession.userId, userId));
  return rows.length;
}

async function liveLinks(userId: string): Promise<number> {
  const rows = await testDb.db
    .select({ id: signInLinks.id })
    .from(signInLinks)
    .where(
      and(
        eq(signInLinks.userId, userId),
        isNull(signInLinks.usedAt),
        isNull(signInLinks.invalidatedAt),
      ),
    );
  return rows.length;
}

async function accountRow(userId: string): Promise<typeof authUser.$inferSelect> {
  const [row] = await testDb.db.select().from(authUser).where(eq(authUser.id, userId));
  if (row === undefined) throw new Error("no such account");
  return row;
}

async function siteActs(subject: string): Promise<string[]> {
  const { rows } = await listSiteAudit(testDb.db, { limit: 500 });
  return rows
    .filter((row) => row.subject === subject)
    .map((row) => row.detail ?? "")
    .reverse();
}

async function mirroredActs(workspace: string, subject: string): Promise<string[]> {
  const { rows } = await listAccessAudit(testDb.db, workspace, { limit: 500, kind: "account" });
  return rows
    .map((row) => row.detail ?? "")
    .filter((detail) => detail.includes(`subject=${subject}`))
    .reverse();
}

async function grantRows(workspace: string, subject: string): Promise<string[]> {
  const { rows } = await listAccessAudit(testDb.db, workspace, { limit: 500, kind: "grant" });
  return rows
    .map((row) => row.detail ?? "")
    .filter((detail) => detail.includes(`subject=${subject}`) && detail.includes("act=reconfirm"));
}

/** Sign in again after a reset or reactivation, through the newest emailed link. */
async function signInThroughLink(
  person: Person,
  kind: "set-password" | "keep-password",
  options: { readonly factorKept: boolean },
): Promise<void> {
  const password = kind === "set-password" ? freshPassword() : person.password;
  const claimed = await authPost("/claim", { token: tokenFromNewestMessage(), password });
  expect(claimed.status, await claimed.clone().text()).toBe(200);
  const { twoFactorRedirect } = (await claimed.json()) as { twoFactorRedirect: boolean };
  expect(twoFactorRedirect).toBe(options.factorKept);
  person.password = password;
  if (options.factorKept) {
    const code = await freshCode(person.secret, person.lastCode);
    const verified = await authPost("/two-factor/verify-totp", { code }, cookieHeader(claimed));
    expect(verified.status, await verified.clone().text()).toBe(200);
    person.lastCode = code;
    person.session = sessionTokenOf(cookieHeader(verified));
    return;
  }
  const enrolled = await enrolFactor(cookieHeader(claimed), password);
  person.secret = enrolled.secret;
  person.lastCode = enrolled.code;
  person.session = sessionTokenOf(enrolled.cookie);
}

async function reconfirm(token: string, group: string, userId: string, workspace = workspaceId) {
  return adminSend(
    "POST",
    `/admin/workspaces/${workspace}/access-groups/${group}/holders/${userId}/reconfirm`,
    token,
  );
}

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

  const at = new Date();
  const siteAdmin = await seedAdminSession(testDb.db, { label: "site", at });
  siteAdminId = siteAdmin.userId;
  siteAdminToken = siteAdmin.token;
  const secondSiteAdmin = await seedAdminSession(testDb.db, {
    label: "site2",
    at,
    membership: false,
  });
  secondSiteAdminId = secondSiteAdmin.userId;
  secondSiteAdminToken = secondSiteAdmin.token;
  const workspaceAdmin = await seedAdminSession(testDb.db, {
    label: "wsadmin",
    at,
    claim: false,
    owner: true,
    grants: ["forms.editor"],
  });
  workspaceAdminId = workspaceAdmin.userId;
  workspaceAdminToken = workspaceAdmin.token;

  const listed = await adminGet("/admin/workspaces", siteAdminToken);
  const { workspaces } = (await listed.json()) as { workspaces: { workspaceId: string }[] };
  workspaceId = workspaces[0]?.workspaceId ?? "";
  viewersGroupId = await createGroup(workspaceId, "Lifecycle viewers", ["responses.viewer"], [
    "prod",
  ]);
  editorsGroupId = await createGroup(workspaceId, "Lifecycle editors", ["forms.editor"], []);
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("who may act on an account (criteria 73, 74)", () => {
  it("refuses a Workspace administrator every lifecycle route", async () => {
    const subject = workspaceAdminId;
    for (const [method, path] of [
      ["GET", `/admin/accounts/${subject}/holdings`],
      ["POST", `/admin/accounts/${subject}/disable`],
      ["POST", `/admin/accounts/${subject}/reactivate`],
      ["POST", `/admin/accounts/${subject}/reset`],
    ] as const) {
      const response =
        method === "GET"
          ? await adminGet(path, workspaceAdminToken)
          : await adminSend(method, path, workspaceAdminToken, { password: true, factor: false });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("serves no route that deletes an account", async () => {
    expect(
      ROUTE_POLICIES.filter((row) => row.method === "DELETE" && row.path.includes("/accounts")),
    ).toEqual([]);
    const response = await adminSend("DELETE", `/admin/accounts/${siteAdminId}`, siteAdminToken);
    expect(response.status).toBe(404);
    expect(await accountRow(siteAdminId)).toBeDefined();
  });
});

describe("disabling an account (criteria 68, 70, 72)", () => {
  it(
    "ends every session and link at once, keeps memberships, lists what it held and audits",
    async () => {
      const person = await createAndClaim("disable.subject@example.test");
      const created = await adminSend("POST", "/admin/workspaces", siteAdminToken, {
        name: "Disable only admin",
        slug: "disable-only-admin",
        firstAdministratorEmail: person.email,
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const soleWorkspace = ((await created.json()) as { workspace: { workspaceId: string } })
        .workspace.workspaceId;
      await grant(viewersGroupId, person.userId);
      await grant(editorsGroupId, person.userId);
      expect((await adminGet("/admin/me/access", person.session)).status).toBe(200);

      const preview = await adminGet(`/admin/accounts/${person.userId}/holdings`, siteAdminToken);
      expect(preview.status).toBe(200);
      const { holdings } = (await preview.json()) as {
        holdings: {
          responseGroups: { groupId: string }[];
          administratorOf: { workspaceId: string; last: boolean }[];
        };
      };
      expect(holdings.responseGroups.map((group) => group.groupId)).toEqual([viewersGroupId]);
      expect(holdings.administratorOf).toEqual([
        expect.objectContaining({ workspaceId: soleWorkspace, last: true }),
      ]);

      const disabled = await adminSend("POST", `/admin/accounts/${person.userId}/disable`, siteAdminToken);
      expect(disabled.status, await disabled.clone().text()).toBe(200);
      const body = (await disabled.json()) as {
        account: { status: string };
        holdings: { administratorOf: { workspaceId: string; last: boolean }[] };
      };
      expect(body.account.status).toBe("disabled");
      expect(body.holdings.administratorOf).toEqual([
        expect.objectContaining({ workspaceId: soleWorkspace, last: true }),
      ]);

      expect(await sessionCount(person.userId)).toBe(0);
      expect((await adminGet("/admin/me/access", person.session)).status).toBe(401);
      expect(await liveLinks(person.userId)).toBe(0);
      const signIn = await authPost("/sign-in/email", {
        email: person.email,
        password: person.password,
      });
      expect(signIn.status).toBe(401);

      const members = await testDb.db
        .select({ workspace: authMember.organizationId })
        .from(authMember)
        .where(eq(authMember.userId, person.userId));
      expect(members.map((row) => row.workspace).sort()).toEqual(
        [workspaceId, soleWorkspace].sort(),
      );

      expect((await siteActs(person.userId)).filter((act) => act === "act=disable")).toHaveLength(1);
      for (const workspace of [workspaceId, soleWorkspace]) {
        expect(await mirroredActs(workspace, person.userId)).toEqual([
          `subject=${person.userId} act=disable`,
        ]);
      }

      const again = await adminSend("POST", `/admin/accounts/${person.userId}/disable`, siteAdminToken);
      expect(again.status).toBe(409);
    },
    FLOW_TIMEOUT_MS,
  );

  it("refuses to disable a Site administrator, and the last one with its own reason", async () => {
    const other = await adminSend(
      "POST",
      `/admin/accounts/${secondSiteAdminId}/disable`,
      siteAdminToken,
    );
    expect(other.status).toBe(409);
    expect(await errorCodeOf(other)).toBe("SITE_ADMINISTRATOR_DISABLE_REFUSED");
    expect((await accountRow(secondSiteAdminId)).disabledAt).toBeNull();

    await testDb.db.update(authUser).set({ claimedAt: null }).where(eq(authUser.id, secondSiteAdminId));
    try {
      const last = await adminSend("POST", `/admin/accounts/${siteAdminId}/disable`, siteAdminToken);
      expect(last.status).toBe(409);
      expect(await errorCodeOf(last)).toBe("LAST_SITE_ADMINISTRATOR");
      expect((await accountRow(siteAdminId)).disabledAt).toBeNull();
    } finally {
      await testDb.db
        .update(authUser)
        .set({ claimedAt: new Date() })
        .where(eq(authUser.id, secondSiteAdminId));
    }
  });
});

describe("reactivating an account (criteria 64, 68, 69, 71)", () => {
  it(
    "needs a new password and factor through the link, restores the rest and keeps responses suspended",
    async () => {
      const person = await createAndClaim("reactivate.subject@example.test");
      await appoint(person.userId);
      await grant(viewersGroupId, person.userId);
      await grant(editorsGroupId, person.userId);
      const before = await myAccess(person.session);
      expect(before.workspaces.get(workspaceId)?.groups).toEqual([
        "Lifecycle editors",
        "Lifecycle viewers",
      ]);

      expect(
        (await adminSend("POST", `/admin/accounts/${person.userId}/disable`, siteAdminToken)).status,
      ).toBe(200);
      const refusedUnlessDisabled = await adminSend(
        "POST",
        `/admin/accounts/${workspaceAdminId}/reactivate`,
        siteAdminToken,
      );
      expect(await errorCodeOf(refusedUnlessDisabled)).toBe("ACCOUNT_NOT_DISABLED");

      const reactivated = await adminSend(
        "POST",
        `/admin/accounts/${person.userId}/reactivate`,
        siteAdminToken,
      );
      expect(reactivated.status, await reactivated.clone().text()).toBe(200);
      expect(((await reactivated.json()) as { account: { status: string } }).account.status).toBe(
        "unclaimed",
      );
      expect(newestMessage().subject).toBe("Your QCMS account has been reactivated");
      expect(await liveLinks(person.userId)).toBe(1);

      const oldPassword = await authPost("/sign-in/email", {
        email: person.email,
        password: person.password,
      });
      expect(oldPassword.status).toBe(401);

      await signInThroughLink(person, "set-password", { factorKept: false });
      const after = await myAccess(person.session);
      expect(after.installationAdmin).toBe(false);
      expect(after.workspaces.get(workspaceId)).toEqual({
        role: "forms.owner",
        groups: ["Lifecycle editors"],
      });

      expect(await siteActs(person.userId)).toEqual(
        expect.arrayContaining(["act=disable", "act=reactivate suspended=1"]),
      );
      expect(await mirroredActs(workspaceId, person.userId)).toEqual([
        `subject=${person.userId} act=disable`,
        `subject=${person.userId} act=reactivate suspended=1`,
      ]);

      const confirmed = await reconfirm(workspaceAdminToken, viewersGroupId, person.userId);
      expect(confirmed.status, await confirmed.clone().text()).toBe(200);
      expect((await myAccess(person.session)).workspaces.get(workspaceId)?.groups).toEqual([
        "Lifecycle editors",
        "Lifecycle viewers",
      ]);
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "never restores the Site administrator role a disable took away",
    async () => {
      const person = await createAndClaim("former.site.admin@example.test");
      await makeSiteAdministrator(testDb.db, person.userId);
      expect((await myAccess(person.session)).installationAdmin).toBe(true);

      await disableAccount(testDb.db, person.userId, new Date());
      expect((await accountRow(person.userId)).role).toBeNull();

      const reactivated = await adminSend(
        "POST",
        `/admin/accounts/${person.userId}/reactivate`,
        siteAdminToken,
      );
      expect(reactivated.status, await reactivated.clone().text()).toBe(200);
      await signInThroughLink(person, "set-password", { factorKept: false });
      expect((await myAccess(person.session)).installationAdmin).toBe(false);
      expect((await accountRow(person.userId)).role).toBeNull();
    },
    FLOW_TIMEOUT_MS,
  );
});

describe("resetting a password or a factor (criteria 58, 59, 64, 65)", () => {
  it(
    "revokes every session, suspends response memberships and needs a new password through the link",
    async () => {
      const person = await createAndClaim("password.reset@example.test");
      await appoint(person.userId);
      await grant(viewersGroupId, person.userId);
      await grant(editorsGroupId, person.userId);
      const second = await authPost("/sign-in/email", {
        email: person.email,
        password: person.password,
      });
      expect(second.status).toBe(200);
      expect(await sessionCount(person.userId)).toBeGreaterThanOrEqual(1);

      const reset = await adminSend("POST", `/admin/accounts/${person.userId}/reset`, siteAdminToken, {
        password: true,
        factor: false,
      });
      expect(reset.status, await reset.clone().text()).toBe(200);
      expect(newestMessage().subject).toBe("Sign in to QCMS again");
      expect(await sessionCount(person.userId)).toBe(0);
      expect((await adminGet("/admin/me/access", person.session)).status).toBe(401);

      const oldPassword = await authPost("/sign-in/email", {
        email: person.email,
        password: person.password,
      });
      expect(oldPassword.status).toBe(401);

      await signInThroughLink(person, "set-password", { factorKept: true });
      expect((await myAccess(person.session)).workspaces.get(workspaceId)).toEqual({
        role: "forms.owner",
        groups: ["Lifecycle editors"],
      });
      expect(await siteActs(person.userId)).toContain("act=reset reset=password suspended=1");
      expect(await mirroredActs(workspaceId, person.userId)).toEqual([
        `subject=${person.userId} act=reset reset=password suspended=1`,
      ]);
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "keeps the password on a factor-only reset, and refuses it without the link",
    async () => {
      const person = await createAndClaim("factor.reset@example.test");
      await grant(editorsGroupId, person.userId);

      const refusedBody = await adminSend(
        "POST",
        `/admin/accounts/${person.userId}/reset`,
        siteAdminToken,
        { password: false, factor: false },
      );
      expect(refusedBody.status).toBe(400);

      const reset = await adminSend("POST", `/admin/accounts/${person.userId}/reset`, siteAdminToken, {
        password: false,
        factor: true,
      });
      expect(reset.status, await reset.clone().text()).toBe(200);
      expect(await sessionCount(person.userId)).toBe(0);

      const withoutLink = await authPost("/sign-in/email", {
        email: person.email,
        password: person.password,
      });
      expect(withoutLink.status).toBe(401);

      const wrong = await authPost("/claim", {
        token: tokenFromNewestMessage(),
        password: freshPassword(),
      });
      expect(wrong.status).toBe(400);
      expect(await errorCodeOf(wrong)).toBe("CLAIM_PASSWORD_INCORRECT");
      expect(await liveLinks(person.userId)).toBe(1);

      const kept = person.password;
      await signInThroughLink(person, "keep-password", { factorKept: false });
      expect(person.password).toBe(kept);
      expect((await myAccess(person.session)).workspaces.get(workspaceId)?.groups).toEqual([
        "Lifecycle editors",
      ]);
      const again = await authPost("/sign-in/email", { email: person.email, password: kept });
      expect(again.status).toBe(200);
    },
    FLOW_TIMEOUT_MS,
  );

  it("refuses an unclaimed, a disabled and your own account", async () => {
    const unclaimed = await adminSend("POST", "/admin/accounts", siteAdminToken, {
      email: "never.claimed@example.test",
    });
    const { account } = (await unclaimed.json()) as { account: { userId: string } };
    const body = { password: true, factor: true };
    const refusedUnclaimed = await adminSend(
      "POST",
      `/admin/accounts/${account.userId}/reset`,
      siteAdminToken,
      body,
    );
    expect(await errorCodeOf(refusedUnclaimed)).toBe("ACCOUNT_UNCLAIMED");
    const own = await adminSend("POST", `/admin/accounts/${siteAdminId}/reset`, siteAdminToken, body);
    expect(await errorCodeOf(own)).toBe("OWN_ACCOUNT");
    expect(await sessionCount(siteAdminId)).toBe(1);
  });
});

describe("re-confirming a suspended membership (criteria 60, 61, 62, 63)", () => {
  it(
    "refuses the resetter while another administrator exists, a Site administrator included",
    async () => {
      const person = await createAndClaim("reconfirm.default@example.test");
      await grant(viewersGroupId, person.userId);
      await adminSend("POST", `/admin/accounts/${person.userId}/reset`, siteAdminToken, {
        password: false,
        factor: true,
      });

      const byResetter = await reconfirm(siteAdminToken, viewersGroupId, person.userId);
      expect(byResetter.status).toBe(409);
      expect(await errorCodeOf(byResetter)).toBe("RECONFIRM_BY_PERFORMER_REFUSED");

      const bySiteAdministrator = await reconfirm(
        secondSiteAdminToken,
        viewersGroupId,
        person.userId,
      );
      expect(bySiteAdministrator.status, await bySiteAdministrator.clone().text()).toBe(200);
      const rows = await grantRows(workspaceId, person.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).not.toContain("byPerformer");

      const notSuspended = await reconfirm(secondSiteAdminToken, viewersGroupId, person.userId);
      expect(await errorCodeOf(notSuspended)).toBe("NOT_SUSPENDED");
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "lets the resetter re-confirm where the only other administrator is unclaimed or disabled, and records it",
    async () => {
      const person = await createAndClaim("reconfirm.sole@example.test");
      const created = await adminSend("POST", "/admin/workspaces", siteAdminToken, {
        name: "Reconfirm sole",
        slug: "reconfirm-sole",
        firstAdministratorEmail: person.email,
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const sole = ((await created.json()) as { workspace: { workspaceId: string } }).workspace
        .workspaceId;
      const viewers = await createGroup(sole, "Sole viewers", ["responses.viewer"], ["prod"]);
      await grant(viewers, person.userId, sole);

      for (const [label, state] of [
        ["unclaimed", { claimedAt: null }],
        ["disabled", { disabledAt: new Date() }],
      ] as const) {
        const reset = await adminSend("POST", `/admin/accounts/${person.userId}/reset`, siteAdminToken, {
          password: false,
          factor: true,
        });
        expect(reset.status, label).toBe(200);
        await testDb.db.update(authUser).set(state).where(eq(authUser.id, secondSiteAdminId));
        try {
          const byResetter = await reconfirm(siteAdminToken, viewers, person.userId, sole);
          expect(byResetter.status, `${label}: ${await byResetter.clone().text()}`).toBe(200);
        } finally {
          await testDb.db
            .update(authUser)
            .set({ claimedAt: new Date(), disabledAt: null })
            .where(eq(authUser.id, secondSiteAdminId));
        }
      }
      const rows = await grantRows(sole, person.userId);
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toContain("byPerformer=1");
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "refuses the subject, as a Workspace administrator or a Site administrator, on a sole-administrator site too",
    async () => {
      const person = await createAndClaim("reconfirm.subject@example.test");
      const created = await adminSend("POST", "/admin/workspaces", siteAdminToken, {
        name: "Reconfirm subject",
        slug: "reconfirm-subject",
        firstAdministratorEmail: person.email,
      });
      const own = ((await created.json()) as { workspace: { workspaceId: string } }).workspace
        .workspaceId;
      const viewers = await createGroup(own, "Own viewers", ["responses.viewer"], ["prod"]);
      await grant(viewers, person.userId, own);
      await makeSiteAdministrator(testDb.db, person.userId);
      try {
        await adminSend("POST", `/admin/accounts/${person.userId}/reset`, siteAdminToken, {
          password: false,
          factor: true,
        });
        await signInThroughLink(person, "keep-password", { factorKept: false });
        const access = await myAccess(person.session);
        expect(access.installationAdmin).toBe(true);
        expect(access.workspaces.get(own)?.role).toBe("forms.owner");

        await testDb.db.update(authUser).set({ claimedAt: null }).where(eq(authUser.id, secondSiteAdminId));
        try {
          const refused = await reconfirm(person.session, viewers, person.userId, own);
          expect(refused.status).toBe(409);
          expect(await errorCodeOf(refused)).toBe("RECONFIRM_OWN_REFUSED");
        } finally {
          await testDb.db
            .update(authUser)
            .set({ claimedAt: new Date() })
            .where(eq(authUser.id, secondSiteAdminId));
        }
      } finally {
        await testDb.db.update(authUser).set({ role: null }).where(eq(authUser.id, person.userId));
      }
    },
    FLOW_TIMEOUT_MS,
  );
});

describe("concurrent acts on one account", () => {
  it(
    "fails fast behind a held account lock, and the API keeps answering",
    async () => {
      const person = await createAndClaim("parallel.subject@example.test");
      const holder = testDb.register(
        new pg.Client({ connectionString: testDb.connectionUri }),
        "account lock holder",
      );
      await holder.connect();
      await holder.query("begin");
      await holder.query(
        "select pg_advisory_xact_lock(hashtext('qcms.account'), hashtext($1))",
        [person.userId],
      );
      try {
        const started = performance.now();
        const acts = Promise.all(
          Array.from({ length: PARALLEL }, async (_unused, index) => {
            const response =
              index % 2 === 0
                ? await adminSend("POST", `/admin/accounts/${person.userId}/disable`, siteAdminToken)
                : await adminSend("POST", `/admin/accounts/${person.userId}/reset`, siteAdminToken, {
                    password: false,
                    factor: true,
                  });
            return { status: response.status, code: await errorCodeOf(response) };
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        const unrelated = await adminGet("/admin/me/access", siteAdminToken);
        expect(unrelated.status).toBe(200);
        expect(await acts).toEqual(
          Array.from({ length: PARALLEL }, () => ({ status: 409, code: "ACCOUNT_BUSY" })),
        );
        expect(performance.now() - started).toBeLessThan(5_000);
      } finally {
        await holder.query("rollback");
      }
      expect(await sessionCount(person.userId)).toBeGreaterThan(0);
      expect((await accountRow(person.userId)).disabledAt).toBeNull();
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "applies one of many parallel disables and leaves one live link after parallel resets",
    async () => {
      const resetSubject = await createAndClaim("parallel.reset@example.test");
      const resets = await Promise.all(
        Array.from({ length: PARALLEL }, async () => {
          const response = await adminSend(
            "POST",
            `/admin/accounts/${resetSubject.userId}/reset`,
            siteAdminToken,
            { password: true, factor: true },
          );
          return response.status === 200 ? "applied" : await errorCodeOf(response);
        }),
      );
      expect(resets).toContain("applied");
      for (const result of resets.filter((value) => value !== "applied")) {
        expect(result).toBe("ACCOUNT_BUSY");
      }
      expect(await liveLinks(resetSubject.userId)).toBe(1);
      expect(await sessionCount(resetSubject.userId)).toBe(0);

      const disableSubject = await createAndClaim("parallel.disable@example.test");
      const disables = Promise.all(
        Array.from({ length: PARALLEL }, async () => {
          const response = await adminSend(
            "POST",
            `/admin/accounts/${disableSubject.userId}/disable`,
            siteAdminToken,
          );
          return response.status === 200 ? "applied" : await errorCodeOf(response);
        }),
      );
      const unrelated = await adminGet("/admin/me/access", siteAdminToken);
      expect(unrelated.status).toBe(200);
      const settled = await disables;
      expect(settled.filter((result) => result === "applied")).toHaveLength(1);
      for (const result of settled.filter((value) => value !== "applied")) {
        expect(["ACCOUNT_BUSY", "ACCOUNT_DISABLED"]).toContain(result);
      }
      expect((await siteActs(disableSubject.userId)).filter((act) => act === "act=disable")).toHaveLength(1);
    },
    FLOW_TIMEOUT_MS,
  );
});
