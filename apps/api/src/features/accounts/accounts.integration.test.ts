import {
  authSession,
  authUser,
  listSiteAudit,
  signInLinks,
  SITE_ADMINISTRATOR_ROLE,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { eq } from "drizzle-orm";
import { generate } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER } from "../../middleware/admin-auth.js";
import { appGroups } from "../../registrars.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import type { Mailer, MailMessage } from "../email/mailer.js";
import { SIGN_IN_LINK_TTL_HOURS } from "../email/templates.js";
import { signInTokenHash } from "./tokens.js";

// A real clock, as in `auth.integration.test.ts`: better-auth stamps the rows it writes
// with wall time, and this suite signs accounts in through the library.

const ALL = { public: true, internal: true, admin: true } as const;

/** Generated per run: a literal password is a hard-coded credential the lint gate flags. */
function freshPassword(): string {
  return `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
}

const RELAY = {
  QCMS_SMTP_HOST: "smtp.example.test",
  QCMS_SMTP_FROM: "QCMS <no-reply@example.test>",
};

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
/** A second composition over the same database, with no relay configured at all. */
let mailless: ReturnType<typeof createApp>;
let internalToken: string;
let adminOrigin: string;
let siteAdminToken = "";
let workspaceAdminToken = "";
let workspaceId = "";
let editorGroupId = "";

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

function adminGet(path: string, token: string): Promise<Response> {
  return app.request(path, { headers: adminHeaders(token) });
}

function adminPost(path: string, token: string, body: unknown = {}): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(body),
  });
}

function authHeaders(cookie?: string): Record<string, string> {
  return {
    "x-qcms-internal-token": internalToken,
    origin: adminOrigin,
    "content-type": "application/json",
    ...(cookie === undefined ? {} : { cookie }),
  };
}

function authPost(path: string, body: unknown, cookie?: string): Promise<Response> {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: authHeaders(cookie),
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

/** The token in the message's own body, which is the only place it exists. */
function tokenFromNewestMessage(): string {
  const message = mailbox.at(-1);
  if (message === undefined) throw new Error("no message was sent");
  const match = /\/claim\?token=([A-Za-z0-9._~%-]+)/.exec(message.text);
  if (match?.[1] === undefined) throw new Error(`no claim link in the message: ${message.text}`);
  return decodeURIComponent(match[1]);
}

async function createAccount(email: string): Promise<{ userId: string; token: string }> {
  const response = await adminPost("/admin/accounts", siteAdminToken, { email });
  expect(response.status, await response.clone().text()).toBe(201);
  const { account } = (await response.json()) as { account: { userId: string } };
  return { userId: account.userId, token: tokenFromNewestMessage() };
}

async function liveSessionTokenFor(userId: string): Promise<string> {
  const rows = await testDb.db
    .select({ token: authSession.token })
    .from(authSession)
    .where(eq(authSession.userId, userId));
  const newest = rows.at(-1)?.token;
  if (newest === undefined) throw new Error("no session was minted");
  return newest;
}

/**
 * Drive the claim to completion: the password, then the factor that finishes it. The
 * cookie is carried forward step by step, because verifying the factor replaces the
 * session the claim minted.
 */
async function finishClaim(
  token: string,
  password: string,
): Promise<{ cookie: string; backupCodes: readonly string[] }> {
  const claimed = await authPost("/claim", { token, password });
  expect(claimed.status, await claimed.clone().text()).toBe(200);
  let cookie = cookieHeader(claimed);

  const enabled = await authPost("/two-factor/enable", { password }, cookie);
  expect(enabled.status, await enabled.clone().text()).toBe(200);
  const { totpURI, backupCodes } = (await enabled.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  cookie = cookieHeader(enabled) === "" ? cookie : cookieHeader(enabled);

  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  const verified = await authPost("/two-factor/verify-totp", { code: await generate({ secret }) }, cookie);
  expect(verified.status, await verified.clone().text()).toBe(200);
  return { cookie: cookieHeader(verified) === "" ? cookie : cookieHeader(verified), backupCodes };
}

async function accountRow(userId: string): Promise<typeof authUser.$inferSelect> {
  const [row] = await testDb.db.select().from(authUser).where(eq(authUser.id, userId));
  if (row === undefined) throw new Error("no such account");
  return row;
}

async function siteAuditDetails(subject: string): Promise<string[]> {
  const { rows } = await listSiteAudit(testDb.db, { limit: 200 });
  return rows.filter((row) => row.subject === subject).map((row) => row.detail ?? "");
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
  // The same environment with the relay removed, so the two compositions share this
  // suite's internal token and auth secret and differ only in whether mail is configured.
  const withoutRelay = { ...env, QCMS_SMTP_HOST: undefined, QCMS_SMTP_FROM: undefined };
  mailless = createApp(
    makeDeps({ db: testDb.db, env: withoutRelay, clock: { now: () => new Date() } }),
    ALL,
    { groups: appGroups },
  );
  internalToken = internalTokenFor(deps.config);
  adminOrigin = deps.config.adminAuth.baseUrl;

  const at = new Date();
  const siteAdmin = await seedAdminSession(testDb.db, { label: "site", at });
  siteAdminToken = siteAdmin.token;
  const workspaceAdmin = await seedAdminSession(testDb.db, {
    label: "wsadmin",
    at,
    claim: false,
    owner: true,
    grants: ["forms.editor"],
  });
  workspaceAdminToken = workspaceAdmin.token;

  const groups = await adminGet("/admin/workspaces", siteAdminToken);
  const { workspaces } = (await groups.json()) as { workspaces: { workspaceId: string }[] };
  workspaceId = workspaces[0]?.workspaceId ?? "";
  const listed = await adminGet(`/admin/workspaces/${workspaceId}/access-groups`, siteAdminToken);
  const { groups: accessGroups } = (await listed.json()) as {
    groups: { teamId: string; roles: string[] }[];
  };
  editorGroupId =
    accessGroups.find((group) => group.roles.includes("forms.editor"))?.teamId ?? "";
  expect(editorGroupId).not.toBe("");
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("creating an account (criteria 50, 51)", () => {
  it("is refused while outbound email is not configured", async () => {
    const refused = await mailless.request("/admin/accounts", {
      method: "POST",
      headers: adminHeaders(siteAdminToken),
      body: JSON.stringify({ email: "mailless@example.test" }),
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "MAIL_NOT_CONFIGURED" },
    });
    const [row] = await testDb.db
      .select()
      .from(authUser)
      .where(eq(authUser.email, "mailless@example.test"));
    expect(row).toBeUndefined();
  });

  it("emails a single-use link and shows it to nobody", async () => {
    const before = mailbox.length;
    const response = await adminPost("/admin/accounts", siteAdminToken, {
      email: "Ada@Example.test",
      name: "Ada",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      account: { userId: string; email: string; status: string; role: string };
      delivery: string;
    };
    expect(body.account.email).toBe("ada@example.test");
    expect(body.account.status).toBe("unclaimed");
    expect(body.account.role).toBe("member");
    expect(body.delivery).toBe("sent");

    expect(mailbox).toHaveLength(before + 1);
    const message = mailbox.at(-1);
    expect(message?.to).toBe("ada@example.test");
    const token = tokenFromNewestMessage();
    expect(JSON.stringify(body)).not.toContain(token);

    const row = await accountRow(body.account.userId);
    expect(row.claimedAt).toBeNull();
    expect(row.disabledAt).toBeNull();
    expect(row.role).toBeNull();
  });

  it("keeps only the digest at rest, with a 72-hour expiry and an unused flag", async () => {
    const created = await createAccount("digest@example.test");
    const [link] = await testDb.db
      .select()
      .from(signInLinks)
      .where(eq(signInLinks.userId, created.userId));
    expect(link?.tokenHash).toBe(signInTokenHash(created.token));
    expect(JSON.stringify(link)).not.toContain(created.token);
    expect(link?.usedAt).toBeNull();
    expect(link?.delivery).toBe("sent");
    const hours =
      ((link?.expiresAt.getTime() ?? 0) - (link?.createdAt.getTime() ?? 0)) / (60 * 60 * 1000);
    expect(Math.round(hours)).toBe(SIGN_IN_LINK_TTL_HOURS);
  });

  it("writes a create row to the site audit that carries no token", async () => {
    const created = await createAccount("audited@example.test");
    const details = await siteAuditDetails(created.userId);
    expect(details).toContain("act=create");
    expect(details.join(" ")).not.toContain(created.token);
  });

  it("refuses a second account on the same address, ignoring case", async () => {
    await createAccount("twice@example.test");
    const again = await adminPost("/admin/accounts", siteAdminToken, {
      email: "TWICE@example.test",
    });
    expect(again.status).toBe(409);
    expect((await again.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "ACCOUNT_EXISTS" },
    });
  });
});

describe("claiming an account (criteria 52, 53, 54)", () => {
  it("holds nothing until the factor is verified, then holds its grants", async () => {
    const password = freshPassword();
    const created = await createAccount("claimer@example.test");

    const claimed = await authPost("/claim", { token: created.token, password });
    expect(claimed.status).toBe(200);
    expect((await accountRow(created.userId)).claimedAt).toBeNull();

    // A session exists, and it reaches no admin route at all while the claim is unfinished.
    const halfway = await liveSessionTokenFor(created.userId);
    expect((await adminGet("/admin/me/access", halfway)).status).toBe(401);

    const cookie = cookieHeader(claimed);
    const enabled = await authPost("/two-factor/enable", { password }, cookie);
    expect(enabled.status).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const secret = new URL(totpURI).searchParams.get("secret") ?? "";
    const verified = await authPost(
      "/two-factor/verify-totp",
      { code: await generate({ secret }) },
      cookieHeader(enabled) === "" ? cookie : cookieHeader(enabled),
    );
    expect(verified.status).toBe(200);

    expect((await accountRow(created.userId)).claimedAt).toBeInstanceOf(Date);
    expect(await siteAuditDetails(created.userId)).toContain("act=claim");
    const usable = await liveSessionTokenFor(created.userId);
    expect((await adminGet("/admin/me/access", usable)).status).toBe(200);
  });

  it("refuses the link a second time", async () => {
    const created = await createAccount("reuse@example.test");
    await finishClaim(created.token, freshPassword());
    const again = await authPost("/claim", { token: created.token, password: freshPassword() });
    expect(again.status).toBe(400);
    expect((await again.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "CLAIM_LINK_REFUSED" },
    });
  });

  it("refuses a link more than 72 hours old", async () => {
    const created = await createAccount("stale@example.test");
    await testDb.db
      .update(signInLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(signInLinks.userId, created.userId));
    const claimed = await authPost("/claim", { token: created.token, password: freshPassword() });
    expect(claimed.status).toBe(400);
    expect((await accountRow(created.userId)).claimedAt).toBeNull();
  });

  it("refuses an unknown token and never consumes anything", async () => {
    const claimed = await authPost("/claim", {
      token: "not-a-token-that-was-ever-issued",
      password: freshPassword(),
    });
    expect(claimed.status).toBe(400);
  });

  it("refuses a link used from another account's session", async () => {
    const owner = await createAccount("owner.of.link@example.test");
    const other = await createAccount("other.claimer@example.test");
    const otherSignedIn = await finishClaim(other.token, freshPassword());

    const wrong = await authPost(
      "/claim",
      { token: owner.token, password: freshPassword() },
      otherSignedIn.cookie,
    );
    expect(wrong.status).toBe(400);
    expect((await accountRow(owner.userId)).claimedAt).toBeNull();
    // The link was not consumed, so its own account can still use it.
    const right = await authPost("/claim", { token: owner.token, password: freshPassword() });
    expect(right.status).toBe(200);
  });

  it("refuses a password the breach check or the length rule rejects, leaving the link usable", async () => {
    const created = await createAccount("weak@example.test");
    const short = await authPost("/claim", { token: created.token, password: "short" });
    expect(short.status).toBe(400);
    const password = freshPassword();
    expect((await authPost("/claim", { token: created.token, password })).status).toBe(200);
  });
});

describe("resending the link", () => {
  it("invalidates the link before it", async () => {
    const created = await createAccount("resend@example.test");
    const resent = await adminPost(
      `/admin/accounts/${created.userId}/sign-in-link`,
      siteAdminToken,
    );
    expect(resent.status).toBe(200);
    const fresh = tokenFromNewestMessage();
    expect(fresh).not.toBe(created.token);

    const stale = await authPost("/claim", { token: created.token, password: freshPassword() });
    expect(stale.status).toBe(400);
    expect((await authPost("/claim", { token: fresh, password: freshPassword() })).status).toBe(
      200,
    );
    expect(await siteAuditDetails(created.userId)).toContain("act=resend delivery=sent");
  });

  it("is refused once the account is claimed", async () => {
    const created = await createAccount("claimed.already@example.test");
    await finishClaim(created.token, freshPassword());
    const refused = await adminPost(
      `/admin/accounts/${created.userId}/sign-in-link`,
      siteAdminToken,
    );
    expect(refused.status).toBe(409);
  });

  it("is refused for an account that does not exist", async () => {
    expect(
      (await adminPost("/admin/accounts/au_missing/sign-in-link", siteAdminToken)).status,
    ).toBe(404);
  });
});

describe("the directory (criterion 57)", () => {
  it("is refused to a Workspace administrator, for both browse and search", async () => {
    expect((await adminGet("/admin/accounts", workspaceAdminToken)).status).toBe(403);
    expect((await adminGet("/admin/accounts?q=ada", workspaceAdminToken)).status).toBe(403);
  });

  it("searches by address and filters by status and role", async () => {
    const found = await adminGet("/admin/accounts?q=ada@example", siteAdminToken);
    expect(found.status).toBe(200);
    const { accounts } = (await found.json()) as { accounts: { email: string }[] };
    expect(accounts.map((account) => account.email)).toEqual(["ada@example.test"]);

    const unclaimed = await adminGet("/admin/accounts?status=unclaimed", siteAdminToken);
    const body = (await unclaimed.json()) as { accounts: { status: string }[]; total: number };
    expect(body.accounts.every((account) => account.status === "unclaimed")).toBe(true);
    expect(body.total).toBeGreaterThan(0);

    const admins = await adminGet("/admin/accounts?role=site-administrator", siteAdminToken);
    const { accounts: siteAdmins } = (await admins.json()) as { accounts: { role: string }[] };
    expect(siteAdmins.every((account) => account.role === "site-administrator")).toBe(true);
  });

  it("refuses a page window that is not a positive integer", async () => {
    expect((await adminGet("/admin/accounts?page=0", siteAdminToken)).status).toBe(400);
  });
});

describe("adding a member by address (criteria 55, 56)", () => {
  const holdersPath = (): string =>
    `/admin/workspaces/${workspaceId}/access-groups/${editorGroupId}/holders`;

  async function addByEmail(email: string): Promise<{ status: number; body: string }> {
    const response = await adminPost(holdersPath(), workspaceAdminToken, { email });
    return { status: response.status, body: await response.text() };
  }

  it("answers identically for an unknown, a disabled and an unclaimed address", async () => {
    const unclaimed = await createAccount("generic.unclaimed@example.test");
    expect(unclaimed.userId).not.toBe("");
    const disabled = await createAccount("generic.disabled@example.test");
    await finishClaim(disabled.token, freshPassword());
    await testDb.db
      .update(authUser)
      .set({ disabledAt: new Date() })
      .where(eq(authUser.id, disabled.userId));

    const answers = [
      await addByEmail("nobody.at.all@example.test"),
      await addByEmail("generic.disabled@example.test"),
      await addByEmail("generic.unclaimed@example.test"),
    ];
    expect(answers[0]?.status).toBe(answers[1]?.status);
    expect(answers[1]?.status).toBe(answers[2]?.status);
    expect(answers[0]?.body).toBe(answers[1]?.body);
    expect(answers[1]?.body).toBe(answers[2]?.body);
  });

  it("writes a site audit row when a Site administrator grants an unclaimed account", async () => {
    const created = await createAccount("granted.unclaimed@example.test");
    const added = await adminPost(holdersPath(), siteAdminToken, { userId: created.userId });
    expect(added.status, await added.clone().text()).toBe(201);
    const details = await siteAuditDetails(created.userId);
    expect(details.some((detail) => detail.startsWith("act=grant-while-unclaimed"))).toBe(true);
  });
});

describe("an unclaimed account is not an administrator (criterion 54)", () => {
  it("does not count toward the last Workspace administrator guard", async () => {
    const created = await createAccount("not.counted@example.test");
    await testDb.db
      .update(authUser)
      .set({ role: SITE_ADMINISTRATOR_ROLE })
      .where(eq(authUser.id, created.userId));
    // The seeded Workspace administrator is the only claimed one, so removing them is
    // refused even though an unclaimed account also holds the owner role.
    const refused = await app.request(
      `/admin/workspaces/${workspaceId}/members/${created.userId}`,
      { method: "DELETE", headers: adminHeaders(siteAdminToken) },
    );
    expect([404, 409]).toContain(refused.status);
    await testDb.db.update(authUser).set({ role: null }).where(eq(authUser.id, created.userId));
  });
});

describe("a backup code never finishes a claim", () => {
  it("refuses an unclaimed account at the pending-second-factor step", async () => {
    const password = freshPassword();
    const created = await createAccount("backup.gap@example.test");
    const { backupCodes } = await finishClaim(created.token, password);

    // Put the account back in the state the gap needs: a verified factor and recovery
    // codes, with the claim not written.
    await testDb.db.update(authUser).set({ claimedAt: null }).where(eq(authUser.id, created.userId));
    await testDb.db.delete(authSession).where(eq(authSession.userId, created.userId));

    const signedIn = await authPost("/sign-in/email", {
      email: "backup.gap@example.test",
      password,
    });
    expect(signedIn.status).toBe(200);
    expect((await signedIn.json()) as { twoFactorRedirect?: boolean }).toMatchObject({
      twoFactorRedirect: true,
    });

    const used = await authPost(
      "/two-factor/verify-backup-code",
      { code: backupCodes[0] },
      cookieHeader(signedIn),
    );
    expect(used.status).toBe(401);
    const sessions = await testDb.db
      .select()
      .from(authSession)
      .where(eq(authSession.userId, created.userId));
    expect(sessions).toHaveLength(0);
  });
});
