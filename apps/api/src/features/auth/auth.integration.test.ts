import { authSession, authTwoFactor, authUser, countAdminUsers } from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { generate } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { ADMIN_SESSION_HEADER } from "../../middleware/admin-auth.js";
import { appGroups } from "../../registrars.js";
import { internalTokenFor, makeDeps, recordingLogger, validEnv } from "../../test-support.js";
import { createInitialAdmin } from "./bootstrap.js";
import { createAdminAuth } from "./instance.js";

/**
 * The 031 session-policy semantics, in their new home (task 056, exit criterion 3).
 *
 * These are the same four properties 031 shipped, asserted against the API's mounted
 * auth surface rather than against an in-process library call in the admin app:
 *
 * 1. **Raw-token database verification** - a session token issued by better-auth over
 *    `/api/auth/*` is the token `admin-auth` resolves to a row and accepts, and the
 *    row's disappearance takes the authorization with it. Asserted end to end here,
 *    which is strictly more than 031 could: before this task the issuing side and the
 *    verifying side were different processes and no single test spanned both.
 * 2. **The 12h absolute cap** stays where the verifier is, in
 *    `middleware/admin-auth.integration.test.ts` (four cases, unchanged by the move),
 *    and the admin's own redirect gate keeps its unit coverage in
 *    `apps/admin/lib/server/session.test.ts`.
 * 3. **A password alone never yields a session for an enrolled account** - the
 *    twoFactor plugin withholds it, which is what makes "a session row exists" a
 *    meaningful check in the verifier.
 * 4. **Two-step enrollment** - `two-factor/enable` stores a secret without flipping
 *    `twoFactorEnabled`; only a real TOTP code does, so an abandoned enrollment cannot
 *    leave an account half-protected.
 *
 * Issue #319 added a fifth, which belongs with these because it is the same kind of
 * claim about the mounted surface: **the stored recovery codes are not readable back
 * over HTTP by anybody**, and the only recovery-code operation an admin can reach
 * beyond redeeming one is regenerating the set, which better-auth gates on the account
 * password. What the codes look like at rest is asserted separately, against the
 * column, in `backup-code-storage.integration.test.ts`.
 *
 * Against a real migrated Postgres and the real library, because every one of those is
 * a claim about stored rows and hashed credentials. Requires Docker.
 *
 * The app runs on a **real** clock rather than `makeDeps`' fixed one. better-auth
 * stamps its rows with wall time and the verifier compares them against `deps.clock`;
 * a fixed clock in the past makes both lifetime checks pass for the wrong reason,
 * which would hide exactly the regression this file exists to catch.
 */

const BOOT_TIMEOUT = 120_000;
/** Generated per run: a literal password is a hard-coded credential the lint gate flags. */
const PASSWORD = `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "policy.admin@example.test";
const ALL = { public: true, internal: true, admin: true } as const;

let testDb: TestDb;
let app: ReturnType<typeof createApp>;
let channelToken: string;
let adminOrigin: string;
/**
 * The provisioned TOTP secret and recovery codes, captured at enrollment and reused by
 * the later challenge.
 *
 * Module scope rather than per-`describe`, because the enrollment step is the only
 * moment either value is ever handed out: `two-factor/enable` returns them once, and
 * re-reading them afterwards is deliberately impossible (the URI reveal needs the
 * password, and the stored secret is encrypted under the auth secret). An authenticator
 * app is in exactly this position, which is what makes it the right fixture shape.
 */
let enrolledSecret = "";
/** Every log line the app emitted during this file, for the SEC-8 assertion. */
let logLines: Array<Record<string, unknown>> = [];
let issuedCodes: string[] = [];
let regeneratedCodes: string[] = [];

/** The `name=value` pairs from a response's `Set-Cookie` headers, as a cookie header. */
function cookieHeader(response: Response): string {
  // `getSetCookie()`, never `get("set-cookie")`: the latter folds several cookies into
  // one comma-joined string no client parses back apart, and sign-in emits three.
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c): c is string => c !== undefined && c !== "")
    .join("; ");
}

/** POST an allowlisted auth endpoint the way the admin BFF does. */
async function authPost(path: string, body: unknown, cookie?: string): Promise<Response> {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": channelToken,
      // The browser's origin, forwarded by the admin's BFF. better-auth's CSRF check
      // compares it against `trustedOrigins`, which is the admin's public origin.
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

/** Call an admin-group route with a forwarded session token, as the BFF does. */
async function adminGet(path: string, sessionToken: string): Promise<Response> {
  return app.request(`/admin${path}`, {
    headers: {
      "x-qcms-internal-token": channelToken,
      [ADMIN_SESSION_HEADER]: sessionToken,
    },
  });
}

/** One `Set-Cookie` header split into its name and value, attributes discarded. */
function parseSetCookie(header: string): { readonly name: string; readonly value: string } {
  const pair = header.split(";")[0] ?? "";
  const at = pair.indexOf("=");
  return at === -1
    ? { name: pair.trim(), value: "" }
    : { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim() };
}

/** The base32 TOTP secret inside an `otpauth://` URI. */
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
    // The real JSON logger, captured: SEC-8 says no credential reaches a log line, and
    // the only way to assert that over a whole auth flow is to keep every line it
    // emitted and look.
    logger: recorded.logger,
  });
  app = createApp(deps, ALL, { groups: appGroups });
  channelToken = internalTokenFor(deps.config);
  adminOrigin = deps.config.adminAuth.baseUrl;

  // The first account, created the way the CLI creates it: in process, behind the
  // zero-admins guard, with no HTTP sign-up path in existence.
  const created = await createInitialAdmin(
    createAdminAuth({ db: testDb.db, adminAuth: deps.config.adminAuth }),
    testDb.db,
    { email: EMAIL, password: PASSWORD },
  );
  expect(created.ok, "the fixture admin should be created").toBe(true);
  expect(await countAdminUsers(testDb.db)).toBe(1);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb?.teardown();
}, BOOT_TIMEOUT);

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

    // The load-bearing assertion: the secret is stored, the account is NOT protected.
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

    // A fresh browser: no cookies from the enrolled session above.
    const res = await authPost("/sign-in/email", { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { twoFactorRedirect?: boolean };
    expect(body.twoFactorRedirect).toBe(true);

    // The load-bearing assertion is about the DATABASE, not the response body. What makes
    // "a session row exists" a meaningful check in `admin-auth` is that a password alone
    // creates no row, so the claim has to be tested where the row would be: the table is
    // unchanged across the sign-in.
    expect(await testDb.db.select().from(authSession)).toHaveLength(before.length);

    // And no usable session token reaches the browser. The assertion is about the cookie
    // **value**, not the presence of the header, and that distinction is the whole point:
    // better-auth does emit a `session_token` `Set-Cookie` on this response, as a *clear*
    // rather than an issue (it expires the cookie along with the session it briefly
    // created, which also wipes any stale token the browser still held). The obvious "no
    // session cookie is set" version of this test therefore passes for the wrong reason.
    //
    // Names are matched by suffix because better-auth prefixes them under secure cookies
    // (`__Secure-qcms_admin.session_token`); anchoring to the bare name would quietly stop
    // covering the production shape.
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

    // `POST /admin/auth/recovery-codes` decrypted the stored codes and returned them to
    // any live admin session. It is gone, and a live, fully authorized session is
    // exactly the caller that must now be refused: anything less would prove only that
    // the gate in front of it still works.
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

    // No password: better-auth refuses, and the stored set is untouched. A session
    // alone must not be able to retire an admin's codes (issue #319: re-authentication
    // is what this operation buys over the read it replaced).
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

    // The set on record moved, and the codes handed out at enrollment are not it any
    // more: regenerating invalidates a prior set rather than adding to it.
    expect(await stored()).not.toBe(before);
    expect(backupCodes).not.toEqual(issuedCodes);
    regeneratedCodes = backupCodes;
  });

  it("logs no recovery code, no password and no key material anywhere (SEC-8)", () => {
    // Everything the flows above put on the wire, including the values that only
    // existed inside a request body. `logLines` holds every line the real JSON logger
    // emitted across this whole file - sign-in, enrollment, refusals, regeneration.
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

    // And the stored ciphertext is not logged either: it is the material the key
    // protects, and a log store is not where it belongs (SEC-8, SEC-13).
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
    // The proxied session read carries everything the admin's three gates need: the
    // raw token to forward, the issue instant for the 12h cap, the enrollment flag,
    // and the SEC-3 role claim.
    expect(sessionToken).not.toBe("");
    expect(Number.isFinite(new Date(read.session.createdAt).getTime())).toBe(true);
    expect(read.user.twoFactorEnabled).toBe(true);
    expect(read.user.role).toBe("admin");

    // 200 or a handler-level status, but never 401: the gate accepted the row.
    const authorized = await adminGet("/questions?limit=1", sessionToken);
    expect(authorized.status).not.toBe(401);
  });

  it("sign-out deletes the row, so the same token stops authorizing (SEC-1)", async () => {
    const out = await authPost("/sign-out", {}, sessionCookie);
    expect(out.status).toBe(200);
    // The row itself is gone, not merely the cookie. Filtered to this token rather
    // than asserting an empty table: the un-enrolled sign-in earlier in the file left
    // its own live session, and sign-out must take exactly one.
    const remaining = (await testDb.db.select().from(authSession)).filter(
      (row) => row.token === sessionToken,
    );
    expect(remaining).toEqual([]);

    const after = await adminGet("/questions?limit=1", sessionToken);
    expect(after.status).toBe(401);
  });
});
