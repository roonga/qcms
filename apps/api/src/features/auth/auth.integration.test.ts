import {
  authSession,
  authTwoFactor,
  authUser,
  clearMustChangePassword,
  countAdminUsers,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { generate } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { ADMIN_SESSION_HEADER } from "../../middleware/admin-auth.js";
import { appGroups } from "../../registrars.js";
import { internalTokenFor, makeDeps, recordingLogger, validEnv } from "../../test-support.js";
import { createInitialAdmin } from "./bootstrap.js";
import { createAdminAuth } from "./instance.js";

// A real clock, not `makeDeps`' fixed one: better-auth stamps rows with wall time and the
// verifier compares them against `deps.clock`, so a fixed past clock passes for the wrong
// reason.

/** Generated per run: a literal password is a hard-coded credential the lint gate flags. */
const PASSWORD = `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "policy.admin@example.test";
const ALL = { public: true, internal: true, admin: true } as const;

let testDb: TestDb;
let app: ReturnType<typeof createApp>;
let channelToken: string;
let adminOrigin: string;
// Module scope: enrollment hands these out once and they cannot be read back afterwards.
let enrolledSecret = "";
let logLines: Array<Record<string, unknown>> = [];
let issuedCodes: string[] = [];
let regeneratedCodes: string[] = [];

function cookieHeader(response: Response): string {
  // `getSetCookie()`, never `get("set-cookie")`: the latter folds several cookies into
  // one comma-joined string no client parses back apart, and sign-in emits three.
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c): c is string => c !== undefined && c !== "")
    .join("; ");
}

async function authPost(path: string, body: unknown, cookie?: string): Promise<Response> {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": channelToken,
      // better-auth's CSRF check compares this against `trustedOrigins`.
      origin: adminOrigin,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

async function authGetSession(cookie: string): Promise<Response> {
  return app.request("/api/auth/get-session", {
    headers: { "x-qcms-internal-token": channelToken, origin: adminOrigin, cookie },
  });
}

async function adminGet(path: string, sessionToken: string): Promise<Response> {
  return app.request(`/admin${path}`, {
    headers: {
      "x-qcms-internal-token": channelToken,
      [ADMIN_SESSION_HEADER]: sessionToken,
    },
  });
}

function parseSetCookie(header: string): { readonly name: string; readonly value: string } {
  const pair = header.split(";")[0] ?? "";
  const at = pair.indexOf("=");
  return at === -1
    ? { name: pair.trim(), value: "" }
    : { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim() };
}

function secretFromUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (secret === null || secret === "") throw new Error("enrollment URI carried no secret");
  return secret;
}

beforeAll(async () => {
  testDb = await startTestDb();
  const env = validEnv({ DATABASE_URL: testDb.connectionUri });
  const recorded = recordingLogger();
  logLines = recorded.lines;
  const deps = makeDeps({
    db: testDb.db,
    env,
    clock: { now: () => new Date() },
    logger: recorded.logger,
  });
  app = createApp(deps, ALL, { groups: appGroups });
  channelToken = internalTokenFor(deps.config);
  adminOrigin = deps.config.adminAuth.baseUrl;

  const created = await createInitialAdmin(
    createAdminAuth({ db: testDb.db, adminAuth: deps.config.adminAuth }),
    testDb.db,
    { email: EMAIL, password: PASSWORD },
  );
  expect(created.ok, "the fixture admin should be created").toBe(true);
  expect(await countAdminUsers(testDb.db)).toBe(1);

  // `createInitialAdmin` marks the account provisional, and while that flag stands the
  // admin group answers 401 before routing, which would pre-empt every assertion below.
  await clearMustChangePassword(testDb.db, created.ok ? created.userId : "");
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("semantics 3 and 4: two-step enrollment, then a withheld session (SEC-1)", () => {
  let sessionCookie = "";

  it("signs in an un-enrolled account and issues a session (no second factor yet)", async () => {
    const res = await authPost("/sign-in/email", { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    sessionCookie = cookieHeader(res);
    expect(sessionCookie).toContain("qcms_admin.session_token=");
    const body = (await res.json()) as { twoFactorRedirect?: boolean };
    expect(body.twoFactorRedirect).toBeUndefined();
  });

  it("provisions a TOTP factor WITHOUT enabling it (step 1 of enrollment)", async () => {
    const res = await authPost("/two-factor/enable", { password: PASSWORD }, sessionCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totpURI: string; backupCodes: string[] };
    enrolledSecret = secretFromUri(body.totpURI);
    issuedCodes = body.backupCodes;
    expect(issuedCodes.length).toBeGreaterThan(0);

    const [row] = await testDb.db.select().from(authUser);
    expect(row?.twoFactorEnabled ?? false).toBe(false);
  });

  it("flips twoFactorEnabled only once a real TOTP code verifies (step 2)", async () => {
    const res = await authPost(
      "/two-factor/verify-totp",
      { code: await generate({ secret: enrolledSecret }) },
      sessionCookie,
    );
    expect(res.status).toBe(200);
    sessionCookie = cookieHeader(res) === "" ? sessionCookie : cookieHeader(res);

    const [row] = await testDb.db.select().from(authUser);
    expect(row?.twoFactorEnabled).toBe(true);
  });

  it("rejects a wrong TOTP code without changing any state", async () => {
    const before = await testDb.db.select().from(authSession);
    const res = await authPost("/two-factor/verify-totp", { code: "000000" }, sessionCookie);
    expect(res.ok).toBe(false);
    expect(await testDb.db.select().from(authSession)).toHaveLength(before.length);
  });

  it("withholds the session on a password-only sign-in once enrolled (semantic 3)", async () => {
    const before = await testDb.db.select().from(authSession);

    const res = await authPost("/sign-in/email", { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { twoFactorRedirect?: boolean };
    expect(body.twoFactorRedirect).toBe(true);

    expect(await testDb.db.select().from(authSession)).toHaveLength(before.length);

    // better-auth does emit a `session_token` `Set-Cookie` here, as a clear rather than an
    // issue, so the assertion has to be about the value. Names are matched by suffix
    // because secure cookies carry a `__Secure-` prefix.
    const cookies = res.headers.getSetCookie().map(parseSetCookie);
    const challenge = cookies.filter((c) => c.name.endsWith("qcms_admin.two_factor"));
    expect(challenge).toHaveLength(1);
    expect(challenge[0]?.value).not.toBe("");
    const issued = cookies.filter(
      (c) => c.name.endsWith("qcms_admin.session_token") && c.value !== "",
    );
    expect(issued).toEqual([]);
  });

  it("no longer serves the stored recovery codes to anyone (issue #319)", async () => {
    const session = (await (await authGetSession(sessionCookie)).json()) as {
      session: { token: string };
    };

    for (const method of ["GET", "POST"]) {
      const res = await app.request("/admin/auth/recovery-codes", {
        method,
        headers: {
          "x-qcms-internal-token": channelToken,
          [ADMIN_SESSION_HEADER]: session.session.token,
        },
      });
      expect(res.status, `${method} /admin/auth/recovery-codes`).toBe(404);
    }
  });

  it("regenerates recovery codes only for a caller who supplies the password", async () => {
    const stored = async (): Promise<string> => {
      const [row] = await testDb.db.select().from(authTwoFactor);
      return String(row?.backupCodes);
    };
    const before = await stored();

    const refused = await authPost("/two-factor/generate-backup-codes", {}, sessionCookie);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await stored()).toBe(before);

    const wrongPassword = await authPost(
      "/two-factor/generate-backup-codes",
      { password: `${PASSWORD}-wrong` },
      sessionCookie,
    );
    expect(wrongPassword.status).toBeGreaterThanOrEqual(400);
    expect(await stored()).toBe(before);

    const ok = await authPost(
      "/two-factor/generate-backup-codes",
      { password: PASSWORD },
      sessionCookie,
    );
    expect(ok.status).toBe(200);
    const { backupCodes } = (await ok.json()) as { backupCodes: string[] };
    expect(backupCodes.length).toBeGreaterThan(0);

    expect(await stored()).not.toBe(before);
    expect(backupCodes).not.toEqual(issuedCodes);
    regeneratedCodes = backupCodes;
  });

  it("logs no recovery code, no password and no key material anywhere (SEC-8)", () => {
    const forbidden = [
      PASSWORD,
      `${PASSWORD}-wrong`,
      enrolledSecret,
      ...issuedCodes,
      ...regeneratedCodes,
    ].filter((value) => value !== "");
    expect(forbidden.length).toBeGreaterThan(0);
    expect(logLines.length, "the flows above should have logged something").toBeGreaterThan(0);

    const rendered = logLines.map((line) => JSON.stringify(line)).join("\n");
    for (const value of forbidden) {
      expect(rendered).not.toContain(value);
    }

    // `$ba$` is the stored-ciphertext prefix, which must not reach a log store either.
    expect(rendered).not.toContain("$ba$");
  });
});

describe("semantic 1: the issued token is the token the verifier resolves", () => {
  let sessionCookie = "";
  let sessionToken = "";

  it("completes a 2FA sign-in and hands the BFF a token the admin group accepts", async () => {
    const signIn = await authPost("/sign-in/email", { email: EMAIL, password: PASSWORD });
    const challengeCookie = cookieHeader(signIn);
    const [row] = await testDb.db.select().from(authUser);
    expect(row?.twoFactorEnabled, "the fixture account is enrolled by now").toBe(true);

    const verified = await authPost(
      "/two-factor/verify-totp",
      { code: await generate({ secret: enrolledSecret }) },
      challengeCookie,
    );
    expect(verified.status).toBe(200);
    sessionCookie = cookieHeader(verified);

    const read = (await (await authGetSession(sessionCookie)).json()) as {
      session: { token: string; createdAt: string };
      user: { twoFactorEnabled: boolean; role: string };
    };
    sessionToken = read.session.token;
    expect(sessionToken).not.toBe("");
    expect(Number.isFinite(new Date(read.session.createdAt).getTime())).toBe(true);
    expect(read.user.twoFactorEnabled).toBe(true);
    expect(read.user.role).toBe("admin");

    // Any handler-level status is fine; only 401 would mean the gate rejected the row.
    const authorized = await adminGet("/questions?limit=1", sessionToken);
    expect(authorized.status).not.toBe(401);
  });

  it("sign-out deletes the row, so the same token stops authorizing (SEC-1)", async () => {
    const out = await authPost("/sign-out", {}, sessionCookie);
    expect(out.status).toBe(200);
    // Filtered rather than asserting an empty table: the un-enrolled sign-in earlier in
    // the file left its own live session.
    const remaining = (await testDb.db.select().from(authSession)).filter(
      (row) => row.token === sessionToken,
    );
    expect(remaining).toEqual([]);

    const after = await adminGet("/questions?limit=1", sessionToken);
    expect(after.status).toBe(401);
  });
});
