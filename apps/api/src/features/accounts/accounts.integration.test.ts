import { authSession, authUser, issueSignInLink, listSiteAudit, signInLinks } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { and, eq, isNull } from "drizzle-orm";
import { generate } from "otplib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER } from "../../middleware/admin-auth.js";
import { appGroups } from "../../registrars.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import type { Mailer, MailMessage } from "../email/mailer.js";
import { SIGN_IN_LINK_TTL_HOURS } from "../email/templates.js";
import { mintSignInToken, signInTokenHash } from "./tokens.js";

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

/**
 * Every claim hashes a password and then verifies it to sign in, which is two deliberately
 * slow derivations; the default five seconds is not a realistic budget for one on a loaded
 * machine (issue #604).
 */
const CLAIM_TIMEOUT_MS = 30_000;

const HIBP_PREFIX = "https://api.pwnedpasswords.com/range/";

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Stand in for the corpus so the suite depends on no live third party, and record every
 * prefix asked for, which is what proves the lookup ran at all.
 */
function stubCorpus(breached: readonly string[]): { prefixes: string[]; restore: () => void } {
  const prefixes: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(HIBP_PREFIX)) return original(input, init);
    prefixes.push(url.slice(HIBP_PREFIX.length));
    const lines = [...breached.map((hash) => `${hash.slice(5)}:42`), `${"0".repeat(35)}:0`];
    return new Response(lines.join("\r\n"), { status: 200 });
  };
  return {
    prefixes,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
/** A second composition over the same database, with no relay configured at all. */
let mailless: ReturnType<typeof createApp>;
/** A third with the SEC-1 breach check on, which is the shipped default. */
let breachChecked: ReturnType<typeof createApp>;
/** A fourth with the second-factor escape hatch on, which never relaxes a claim. */
let factorOptional: ReturnType<typeof createApp>;
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

async function adminGet(path: string, token: string): Promise<Response> {
  return app.request(path, { headers: adminHeaders(token) });
}

async function adminPost(path: string, token: string, body: unknown = {}): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(body),
  });
}

async function adminPut(path: string, token: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "PUT",
    headers: adminHeaders(token),
    body: JSON.stringify(body),
  });
}

async function adminDelete(path: string, token: string): Promise<Response> {
  return app.request(path, { method: "DELETE", headers: adminHeaders(token) });
}

async function errorCodeOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

function authHeaders(cookie?: string): Record<string, string> {
  return {
    "x-qcms-internal-token": internalToken,
    origin: adminOrigin,
    "content-type": "application/json",
    ...(cookie === undefined ? {} : { cookie }),
  };
}

async function authPost(path: string, body: unknown, cookie?: string): Promise<Response> {
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
): Promise<{ cookie: string; backupCodes: readonly string[]; secret: string }> {
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
  const verified = await authPost(
    "/two-factor/verify-totp",
    { code: await generate({ secret }) },
    cookie,
  );
  expect(verified.status, await verified.clone().text()).toBe(200);
  return {
    cookie: cookieHeader(verified) === "" ? cookie : cookieHeader(verified),
    backupCodes,
    secret,
  };
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
  breachChecked = createApp(
    makeDeps({
      db: testDb.db,
      env: { ...env, QCMS_ADMIN_PASSWORD_BREACH_CHECK: "true" },
      clock: { now: () => new Date() },
      mailer: recordingMailer,
    }),
    ALL,
    { groups: appGroups },
  );
  factorOptional = createApp(
    makeDeps({
      db: testDb.db,
      env: { ...env, QCMS_ADMIN_2FA: "optional" },
      clock: { now: () => new Date() },
      mailer: recordingMailer,
    }),
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
  editorGroupId = accessGroups.find((group) => group.roles.includes("forms.editor"))?.teamId ?? "";
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
    expect(link?.tokenHash).toBe(await signInTokenHash(created.token));
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

  it("refuses a link issued for anything other than a creation", async () => {
    const created = await createAccount("wrong.purpose@example.test");
    const other = mintSignInToken();
    await issueSignInLink(testDb.db, {
      userId: created.userId,
      tokenHash: await signInTokenHash(other),
      purpose: "reset",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      issuedBy: created.userId,
      now: new Date(),
    });
    const claimed = await authPost("/claim", { token: other, password: freshPassword() });
    expect(claimed.status).toBe(400);
    expect(await errorCodeOf(claimed)).toBe("CLAIM_LINK_REFUSED");
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

  it(
    "refuses a password the length rule rejects, leaving the link usable",
    async () => {
      const created = await createAccount("weak@example.test");
      const short = await authPost("/claim", { token: created.token, password: "short" });
      expect(short.status).toBe(400);
      const password = freshPassword();
      expect((await authPost("/claim", { token: created.token, password })).status).toBe(200);
    },
    CLAIM_TIMEOUT_MS,
  );

  it(
    "always needs the second factor, and the escape hatch does not stand in for it",
    async () => {
      const password = freshPassword();
      const created = await createAccount("optional.factor@example.test");
      const claimed = await factorOptional.request("/api/auth/claim", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ token: created.token, password }),
      });
      expect(claimed.status, await claimed.clone().text()).toBe(200);
      expect((await accountRow(created.userId)).claimedAt).toBeNull();
      expect(await siteAuditDetails(created.userId)).not.toContain("act=claim");

      // Read back through the same composition, so the only thing refusing this session
      // is the claim the hatch did not write.
      const session = await liveSessionTokenFor(created.userId);
      const refused = await factorOptional.request("/admin/me/access", {
        headers: adminHeaders(session),
      });
      expect(refused.status).toBe(401);
    },
    CLAIM_TIMEOUT_MS,
  );

  it(
    "completes a claim whose write did not land, on the next sign-in and factor check",
    async () => {
      const password = freshPassword();
      const created = await createAccount("late.claim@example.test");
      const { secret } = await finishClaim(created.token, password);

      // The state a failed claim write leaves behind: the factor is enrolled and nothing
      // on the account says so.
      await testDb.db
        .update(authUser)
        .set({ claimedAt: null })
        .where(eq(authUser.id, created.userId));
      await testDb.db.delete(authSession).where(eq(authSession.userId, created.userId));

      const signedIn = await authPost("/sign-in/email", {
        email: "late.claim@example.test",
        password,
      });
      expect(signedIn.status).toBe(200);
      const verified = await authPost(
        "/two-factor/verify-totp",
        { code: await generate({ secret }) },
        cookieHeader(signedIn),
      );
      expect(verified.status, await verified.clone().text()).toBe(200);
      expect((await accountRow(created.userId)).claimedAt).toBeInstanceOf(Date);
    },
    CLAIM_TIMEOUT_MS,
  );
});

describe("the SEC-1 breach lookup runs on the chosen password", () => {
  let corpus: { prefixes: string[]; restore: () => void } | undefined;

  afterEach(() => {
    corpus?.restore();
    corpus = undefined;
  });

  async function claimWithCheck(token: string, password: string): Promise<Response> {
    return breachChecked.request("/api/auth/claim", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ token, password }),
    });
  }

  it(
    "refuses a password the corpus holds and leaves the link unspent",
    async () => {
      const password = freshPassword();
      corpus = stubCorpus([await sha1Hex(password)]);
      const created = await createAccount("breached@example.test");

      const refused = await claimWithCheck(created.token, password);
      expect(refused.status).toBe(400);
      expect(await errorCodeOf(refused)).toBe("PASSWORD_COMPROMISED");
      expect(corpus.prefixes).toHaveLength(1);
      expect(corpus.prefixes[0]).toBe((await sha1Hex(password)).slice(0, 5));

      const [link] = await testDb.db
        .select()
        .from(signInLinks)
        .where(eq(signInLinks.userId, created.userId));
      expect(link?.usedAt).toBeNull();
      expect((await accountRow(created.userId)).claimedAt).toBeNull();
    },
    CLAIM_TIMEOUT_MS,
  );

  it(
    "accepts a password the corpus does not hold, having asked",
    async () => {
      const password = freshPassword();
      corpus = stubCorpus([await sha1Hex(`other-${password}`)]);
      const created = await createAccount("not.breached@example.test");

      const claimed = await claimWithCheck(created.token, password);
      expect(claimed.status, await claimed.clone().text()).toBe(200);
      expect(corpus.prefixes).toHaveLength(1);

      const signedIn = await authPost("/sign-in/email", {
        email: "not.breached@example.test",
        password,
      });
      expect(signedIn.status).toBe(200);
    },
    CLAIM_TIMEOUT_MS,
  );
});

describe("resending the link", () => {
  const linkPath = (userId: string): string => `/admin/accounts/${userId}/sign-in-link`;

  async function liveLinkCount(userId: string): Promise<number> {
    const rows = await testDb.db
      .select()
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

  it(
    "invalidates the link before it",
    async () => {
      const created = await createAccount("resend@example.test");
      const resent = await adminPost(linkPath(created.userId), siteAdminToken);
      expect(resent.status).toBe(200);
      const fresh = tokenFromNewestMessage();
      expect(fresh).not.toBe(created.token);

      const stale = await authPost("/claim", { token: created.token, password: freshPassword() });
      expect(stale.status).toBe(400);
      expect((await authPost("/claim", { token: fresh, password: freshPassword() })).status).toBe(
        200,
      );
      expect(await siteAuditDetails(created.userId)).toContain("act=resend delivery=sent");
    },
    CLAIM_TIMEOUT_MS,
  );

  it("leaves one live link however many resends run at once", async () => {
    const created = await createAccount("parallel.resend@example.test");
    const results = await Promise.all(
      Array.from({ length: 6 }, () => adminPost(linkPath(created.userId), siteAdminToken)),
    );
    expect(results.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await liveLinkCount(created.userId)).toBe(1);
  });

  it(
    "is refused once the account is claimed, and the link it crossed is dead",
    async () => {
      const password = freshPassword();
      const created = await createAccount("claimed.already@example.test");

      // The window the resend guard alone does not close: the password is set and the
      // factor is not, so the account is still unclaimed and a resend is still allowed.
      const claimed = await authPost("/claim", { token: created.token, password });
      expect(claimed.status, await claimed.clone().text()).toBe(200);
      const crossing = await adminPost(linkPath(created.userId), siteAdminToken);
      expect(crossing.status).toBe(200);
      const second = tokenFromNewestMessage();

      let cookie = cookieHeader(claimed);
      const enabled = await authPost("/two-factor/enable", { password }, cookie);
      expect(enabled.status, await enabled.clone().text()).toBe(200);
      const { totpURI } = (await enabled.json()) as { totpURI: string };
      cookie = cookieHeader(enabled) === "" ? cookie : cookieHeader(enabled);
      const secret = new URL(totpURI).searchParams.get("secret") ?? "";
      const verified = await authPost("/two-factor/verify-totp", { code: await generate({ secret }) }, cookie);
      expect(verified.status).toBe(200);
      expect((await accountRow(created.userId)).claimedAt).toBeInstanceOf(Date);

      // The claim killed it, so the password it was emailed for cannot be replaced.
      expect(await liveLinkCount(created.userId)).toBe(0);
      const replacement = freshPassword();
      const reused = await authPost("/claim", { token: second, password: replacement });
      expect(reused.status).toBe(400);
      expect(await errorCodeOf(reused)).toBe("CLAIM_LINK_REFUSED");

      const withNew = await authPost("/sign-in/email", {
        email: "claimed.already@example.test",
        password: replacement,
      });
      expect(withNew.status).toBe(401);
      const withOld = await authPost("/sign-in/email", {
        email: "claimed.already@example.test",
        password,
      });
      expect(withOld.status).toBe(200);

      expect((await adminPost(linkPath(created.userId), siteAdminToken)).status).toBe(409);
    },
    CLAIM_TIMEOUT_MS,
  );

  it("is refused for an account that does not exist", async () => {
    expect((await adminPost("/admin/accounts/au_missing/sign-in-link", siteAdminToken)).status).toBe(
      404,
    );
  });
});

describe("the directory (criterion 57)", () => {
  it("is refused to a Workspace administrator, for browse, search, create and resend", async () => {
    expect((await adminGet("/admin/accounts", workspaceAdminToken)).status).toBe(403);
    expect((await adminGet("/admin/accounts?q=ada", workspaceAdminToken)).status).toBe(403);
    const created = await adminPost("/admin/accounts", workspaceAdminToken, {
      email: "by.workspace.admin@example.test",
    });
    expect(created.status).toBe(403);
    const [row] = await testDb.db
      .select()
      .from(authUser)
      .where(eq(authUser.email, "by.workspace.admin@example.test"));
    expect(row).toBeUndefined();

    const target = await createAccount("resend.target@example.test");
    expect(
      (await adminPost(`/admin/accounts/${target.userId}/sign-in-link`, workspaceAdminToken))
        .status,
    ).toBe(403);
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

  it("refuses a page window that is not a positive integer, or is past the last page", async () => {
    expect((await adminGet("/admin/accounts?page=0", siteAdminToken)).status).toBe(400);
    expect((await adminGet("/admin/accounts?page=10001", siteAdminToken)).status).toBe(400);
    expect((await adminGet("/admin/accounts?page=10000", siteAdminToken)).status).toBe(200);
  });

  it("refuses a search term longer than the bound", async () => {
    const long = "a".repeat(201);
    expect((await adminGet(`/admin/accounts?q=${long}`, siteAdminToken)).status).toBe(400);
    expect((await adminGet(`/admin/accounts?q=${"a".repeat(200)}`, siteAdminToken)).status).toBe(
      200,
    );
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
  it(
    "holds the flag and is still not counted by the last administrator guard",
    async () => {
      // A workspace of its own, so the count under test is this test's own two accounts
      // rather than every administrator the suite has seeded elsewhere.
      const soleAdmin = await createAccount("sole.admin@example.test");
      await finishClaim(soleAdmin.token, freshPassword());
      const madeWorkspace = await adminPost("/admin/workspaces", siteAdminToken, {
        name: "Counting",
        slug: `counting-${soleAdmin.userId.slice(-8).toLowerCase()}`,
        firstAdministratorEmail: "sole.admin@example.test",
      });
      expect(madeWorkspace.status, await madeWorkspace.clone().text()).toBe(201);
      const { workspace } = (await madeWorkspace.json()) as { workspace: { workspaceId: string } };
      const own = workspace.workspaceId;

      const listed = await adminGet(`/admin/workspaces/${own}/access-groups`, siteAdminToken);
      const { groups } = (await listed.json()) as { groups: { teamId: string }[] };
      const anyGroup = groups[0]?.teamId ?? "";
      expect(anyGroup).not.toBe("");

      // An unclaimed account is made a member and then appointed, which is the state the
      // criterion is about: it holds the flag.
      const unclaimed = await createAccount("flagged.unclaimed@example.test");
      const added = await adminPost(
        `/admin/workspaces/${own}/access-groups/${anyGroup}/holders`,
        siteAdminToken,
        { userId: unclaimed.userId },
      );
      expect(added.status, await added.clone().text()).toBe(201);
      const appointed = await adminPut(
        `/admin/workspaces/${own}/members/${unclaimed.userId}`,
        siteAdminToken,
        { role: "forms.owner" },
      );
      expect(appointed.status, await appointed.clone().text()).toBe(200);
      const members = await adminGet(`/admin/workspaces/${own}/members`, siteAdminToken);
      const { members: rows } = (await members.json()) as {
        members: { userId: string; role: string }[];
      };
      expect(rows.find((row) => row.userId === unclaimed.userId)?.role).toBe("forms.owner");

      // Appointing an unclaimed account is a grant while unclaimed, so the site audit
      // holds it as well as the workspace's own.
      expect(await siteAuditDetails(unclaimed.userId)).toContain(
        "act=grant-while-unclaimed role=administrator",
      );

      // Two accounts carry the flag and only one of them counts, so the claimed one is
      // the last administrator and cannot be removed.
      const refused = await adminDelete(
        `/admin/workspaces/${own}/members/${soleAdmin.userId}`,
        siteAdminToken,
      );
      expect(refused.status).toBe(409);
      expect(await errorCodeOf(refused)).toBe("LAST_ADMINISTRATOR");

      // Claiming the second one is what makes the first removable, which is the whole
      // difference the criterion names.
      await testDb.db
        .update(authUser)
        .set({ claimedAt: new Date() })
        .where(eq(authUser.id, unclaimed.userId));
      const removed = await adminDelete(
        `/admin/workspaces/${own}/members/${soleAdmin.userId}`,
        siteAdminToken,
      );
      expect(removed.status, await removed.clone().text()).toBe(204);
    },
    CLAIM_TIMEOUT_MS,
  );
});

describe("a backup code never finishes a claim", () => {
  it("refuses an unclaimed account at the pending-second-factor step", async () => {
    const password = freshPassword();
    const created = await createAccount("backup.gap@example.test");
    const { backupCodes } = await finishClaim(created.token, password);

    // Put the account back in the state the gap needs: a verified factor and recovery
    // codes, with the claim not written.
    await testDb.db
      .update(authUser)
      .set({ claimedAt: null })
      .where(eq(authUser.id, created.userId));
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
