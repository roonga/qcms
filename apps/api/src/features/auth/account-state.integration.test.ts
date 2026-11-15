import { authSession, authUser, clearMustChangePassword } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { eq } from "drizzle-orm";
import { generate } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { appGroups } from "../../registrars.js";
import { internalTokenFor, makeDeps, validEnv } from "../../test-support.js";
import { CLAIM_AUTH_ENDPOINTS, SESSION_CHECK_EXEMPT_ENDPOINTS } from "./account-state.js";
import { createInitialAdmin } from "./bootstrap.js";
import { createAdminAuth, type AdminAuth } from "./instance.js";
import { ALLOWED_AUTH_ENDPOINTS } from "./route.js";

// A real clock, as in `auth.integration.test.ts`: better-auth stamps rows with wall time.

/** Generated per run: a literal password is a hard-coded credential the lint gate flags. */
const PASSWORD = `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "state.admin@example.test";
const SPARE_EMAIL = "state.spare@example.test";
const ALL = { public: true, internal: true, admin: true } as const;

/** The one allowlisted endpoint that carries its identity in the body rather than a session. */
const SIGN_IN = "POST /sign-in/email";
/** The one endpoint every account reaches, because it only deletes its own session. */
const SIGN_OUT = "POST /sign-out";

let testDb: TestDb;
let app: ReturnType<typeof createApp>;
let auth: AdminAuth;
let channelToken: string;
let adminOrigin: string;
let adminId = "";
let sessionCookie = "";

/**
 * Credentials the library itself refuses, except on sign-in, so an endpoint the mount let
 * through answers something other than the mount's own refusal and the two are told apart.
 */
const PROBE_BODY: Record<string, unknown> = {
  [SIGN_IN]: { email: EMAIL, password: PASSWORD },
  "POST /sign-out": {},
  "POST /change-password": { currentPassword: `${PASSWORD}-wrong`, newPassword: `${PASSWORD}-x` },
  "POST /two-factor/enable": { password: `${PASSWORD}-wrong` },
  "POST /two-factor/verify-totp": { code: "000000" },
  "POST /two-factor/verify-backup-code": { code: "000000" },
  "POST /two-factor/generate-backup-codes": { password: `${PASSWORD}-wrong` },
};

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c): c is string => c !== undefined && c !== "")
    .join("; ");
}

function headersFor(cookie?: string): Record<string, string> {
  return {
    "x-qcms-internal-token": channelToken,
    // better-auth's CSRF check compares this against `trustedOrigins`.
    origin: adminOrigin,
    ...(cookie === undefined ? {} : { cookie }),
  };
}

async function send(endpoint: string, cookie?: string): Promise<Response> {
  const space = endpoint.indexOf(" ");
  const method = endpoint.slice(0, space);
  const path = endpoint.slice(space + 1);
  if (method === "GET") return app.request(`/api/auth${path}`, { headers: headersFor(cookie) });
  return app.request(`/api/auth${path}`, {
    method,
    headers: { ...headersFor(cookie), "content-type": "application/json" },
    body: JSON.stringify(PROBE_BODY[endpoint] ?? {}),
  });
}

/** The mount's refusal, told from the library's own 401 by the API error envelope. */
async function isMountRefusal(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => ({}))) as { error?: { code?: unknown } };
  return body.error?.code === "unauthorized";
}

async function setAccountState(state: {
  readonly disabledAt?: Date | null;
  readonly claimedAt?: Date | null;
}): Promise<void> {
  await testDb.db.update(authUser).set(state).where(eq(authUser.id, adminId));
}

/**
 * A second account with a session of its own, created before its state is set, so a case
 * that spends or refuses that session never touches the fixture admin's.
 */
async function spareWithSession(
  email: string,
  state: { readonly disabledAt?: Date; readonly claimedAt?: Date | null },
): Promise<{ readonly userId: string; readonly cookie: string }> {
  const created = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: "Spare" },
    asResponse: true,
  });
  expect(created.ok).toBe(true);
  const { user } = (await created.json()) as { user: { id: string } };
  await testDb.db.update(authUser).set(state).where(eq(authUser.id, user.id));
  return { userId: user.id, cookie: cookieHeader(created) };
}

async function authPost(path: string, body: unknown, cookie: string): Promise<Response> {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: { ...headersFor(cookie), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  testDb = await startTestDb();
  const env = validEnv({ DATABASE_URL: testDb.connectionUri });
  const deps = makeDeps({ db: testDb.db, env, clock: { now: () => new Date() } });
  app = createApp(deps, ALL, { groups: appGroups });
  channelToken = internalTokenFor(deps.config);
  adminOrigin = deps.config.adminAuth.baseUrl;
  auth = createAdminAuth({ db: testDb.db, adminAuth: deps.config.adminAuth });

  const created = await createInitialAdmin(auth, testDb.db, { email: EMAIL, password: PASSWORD });
  if (!created.ok) throw new Error(`the fixture admin was refused: ${created.refusal.kind}`);
  adminId = created.userId;
  await clearMustChangePassword(testDb.db, adminId);

  const signedIn = await send(SIGN_IN);
  expect(signedIn.status).toBe(200);
  const enable = await authPost(
    "/two-factor/enable",
    { password: PASSWORD },
    cookieHeader(signedIn),
  );
  expect(enable.status).toBe(200);
  const { totpURI } = (await enable.json()) as { totpURI: string };
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  const verified = await authPost(
    "/two-factor/verify-totp",
    { code: await generate({ secret }) },
    cookieHeader(signedIn),
  );
  expect(verified.status).toBe(200);
  sessionCookie = cookieHeader(verified);
  expect(sessionCookie).toContain("qcms_admin.session_token=");
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("the bootstrap account is claimed, so the first run is not refused", () => {
  it("writes the claim rather than relying on a column default", async () => {
    const [row] = await testDb.db.select().from(authUser).where(eq(authUser.id, adminId));
    expect(row?.claimedAt).toBeInstanceOf(Date);
  });

  it("answers a claimed account on the mount", async () => {
    expect((await send("GET /get-session", sessionCookie)).status).toBe(200);
  });
});

describe("a disabled account is refused on every allowlisted auth endpoint but sign-out (criterion 66)", () => {
  beforeAll(async () => {
    await setAccountState({ disabledAt: new Date() });
  });

  afterAll(async () => {
    await setAccountState({ disabledAt: null });
  });

  for (const endpoint of ALLOWED_AUTH_ENDPOINTS.filter((e) => e !== SIGN_OUT)) {
    it(`refuses ${endpoint}`, async () => {
      // Sign-in is sent as a browser would, with no session cookie; every other endpoint
      // is sent with the live session the account signed in with.
      const res = await send(endpoint, endpoint === SIGN_IN ? undefined : sessionCookie);
      const text = await res.clone().text();
      expect(res.status, `${endpoint} answered ${String(res.status)}: ${text}`).toBe(401);
      // No reason in the body, whichever of the two seams refused.
      expect(text).not.toMatch(/disabl|claim/i);
      if (endpoint !== SIGN_IN) expect(await isMountRefusal(res)).toBe(true);
    });
  }

  it("still signs out, which deletes the session its own cookie names and nothing else", async () => {
    const spare = await spareWithSession("state.disabled.signout@example.test", {
      disabledAt: new Date(),
      claimedAt: new Date(),
    });
    expect((await send(SIGN_OUT, spare.cookie)).status).toBe(200);
    const rows = await testDb.db
      .select()
      .from(authSession)
      .where(eq(authSession.userId, spare.userId));
    expect(rows).toEqual([]);
  });
});

describe("a disabled account that never enrolled a factor is minted no session", () => {
  it("refuses the sign-in and writes no session row", async () => {
    const created = await auth.api.signUpEmail({
      body: { email: SPARE_EMAIL, password: PASSWORD, name: "Spare" },
      asResponse: true,
    });
    expect(created.ok).toBe(true);
    const { user } = (await created.json()) as { user: { id: string } };
    await testDb.db
      .update(authUser)
      .set({ disabledAt: new Date(), claimedAt: new Date() })
      .where(eq(authUser.id, user.id));
    await testDb.db.delete(authSession).where(eq(authSession.userId, user.id));

    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { ...headersFor(), "content-type": "application/json" },
      body: JSON.stringify({ email: SPARE_EMAIL, password: PASSWORD }),
    });
    expect(res.status).toBe(401);
    const rows = await testDb.db.select().from(authSession).where(eq(authSession.userId, user.id));
    expect(rows).toEqual([]);
  });
});

describe("an unclaimed account reaches its claim and nothing else", () => {
  beforeAll(async () => {
    await setAccountState({ claimedAt: null });
  });

  afterAll(async () => {
    await setAccountState({ claimedAt: new Date() });
  });

  for (const endpoint of CLAIM_AUTH_ENDPOINTS) {
    it(`admits ${endpoint}`, async () => {
      expect(await isMountRefusal(await send(endpoint, sessionCookie))).toBe(false);
    });
  }

  for (const endpoint of ALLOWED_AUTH_ENDPOINTS.filter(
    (e) => !SESSION_CHECK_EXEMPT_ENDPOINTS.includes(e) && !CLAIM_AUTH_ENDPOINTS.includes(e),
  )) {
    it(`refuses ${endpoint}`, async () => {
      expect(await isMountRefusal(await send(endpoint, sessionCookie))).toBe(true);
    });
  }

  // Last: it ends the session every case above needs.
  it("lets the person abandon the claim by signing out", async () => {
    const res = await send("POST /sign-out", sessionCookie);
    expect(res.status).toBe(200);
  });
});

/**
 * The admin forwards the browser's cookies on sign-in, so judging sign-in by the cookie
 * would refuse a person whose browser still holds a session the server will not honour.
 */
describe("a sign-in is judged by the credential, not by the cookie the browser still holds", () => {
  const holders: readonly {
    readonly label: string;
    readonly state: { readonly disabledAt?: Date; readonly claimedAt?: Date | null };
  }[] = [
    { label: "disabled", state: { disabledAt: new Date(), claimedAt: new Date() } },
    { label: "unclaimed", state: { claimedAt: null } },
  ];

  for (const holder of holders) {
    it(`signs in as an active account while the browser holds a ${holder.label} cookie`, async () => {
      const spare = await spareWithSession(
        `state.${holder.label}.holder@example.test`,
        holder.state,
      );
      const res = await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { ...headersFor(spare.cookie), "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      // The fixture admin has a factor, so its sign-in stops at the second-factor step.
      expect(await res.json()).toMatchObject({ twoFactorRedirect: true });
    });
  }
});
