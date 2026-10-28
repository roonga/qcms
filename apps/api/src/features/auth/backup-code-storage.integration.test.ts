import { authTwoFactor } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Config } from "../../config.js";
import { createInitialAdmin } from "./bootstrap.js";
import { createAdminAuth, type AdminAuth } from "./instance.js";

// Every assertion reads the column, never an API response: a test that asks the library
// what it stored agrees with the library either way.

/** Generated per run: a literal password is a hard-coded credential the lint gate flags. */
const PASSWORD = `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "codes.admin@example.test";

const SECRET_V1 = `v1-${Buffer.from(crypto.getRandomValues(new Uint8Array(30))).toString("base64url")}`;
const SECRET_V2 = `v2-${Buffer.from(crypto.getRandomValues(new Uint8Array(30))).toString("base64url")}`;

let testDb: TestDb;

function adminAuthConfig(
  secrets: readonly { version: number; value: string }[],
): Config["adminAuth"] {
  return {
    secret: SECRET_V1,
    secrets,
    baseUrl: "https://admin.example.test",
    idleMs: 3_600_000,
    secureCookies: false,
    // Off: the breach check would put a live request to `api.pwnedpasswords.com` in the
    // fixture's account creation path, and it fails closed.
    breachedPasswordCheck: false,
    // Costs this file nothing: every request goes through `auth.api.*` in process, and
    // better-auth's limiter runs in the router's `onRequest` hook, which only
    // `auth.handler` reaches (better-auth 1.7.10, `dist/api/index.mjs:165-173`).
    // <!-- expect: const rateLimitResponse = await onRequestRateLimit(currentRequest, ctx); -->
    signInThrottle: true,
  };
}

function authWith(secrets: readonly { version: number; value: string }[]): AdminAuth {
  return createAdminAuth({ db: testDb.db, adminAuth: adminAuthConfig(secrets) });
}

async function storedBlob(): Promise<string> {
  const [row] = await testDb.db.select().from(authTwoFactor);
  if (row === undefined) throw new Error("no two_factor row");
  return String(row.backupCodes);
}

async function enroll(auth: AdminAuth): Promise<string[]> {
  const signedIn = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const enabled = await auth.api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: new Headers({ cookie }),
    asResponse: true,
  });
  return ((await enabled.json()) as { backupCodes: string[] }).backupCodes;
}

// `disableSession` so verification and re-encoding run without a challenge cookie.
async function redeem(auth: AdminAuth, code: string): Promise<Response> {
  const session = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  const cookie = session.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return auth.api.verifyBackupCode({
    body: { code, disableSession: true },
    headers: new Headers({ cookie }),
    asResponse: true,
  });
}

let issued: string[] = [];

beforeAll(async () => {
  testDb = await startTestDb();
  await createInitialAdmin(authWith([{ version: 1, value: SECRET_V1 }]), testDb.db, {
    email: EMAIL,
    password: PASSWORD,
  });
  issued = await enroll(authWith([{ version: 1, value: SECRET_V1 }]));
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("at rest", () => {
  it("stores no issued code, in any encoding a database reader could recover", async () => {
    const blob = await storedBlob();
    expect(issued.length).toBeGreaterThan(0);

    for (const code of issued) {
      expect(blob).not.toContain(code);
      expect(blob).not.toContain(code.replace("-", ""));
      expect(blob.toLowerCase()).not.toContain(code.toLowerCase());
    }

    expect(blob).not.toContain(Buffer.from(JSON.stringify(issued)).toString("base64"));
    // A leading `[` is the JSON array better-auth writes when `storeBackupCodes` is
    // "plain".
    expect(blob.trimStart().startsWith("[")).toBe(false);
  });

  it("carries the versioned envelope, so the key behind it can be retired", async () => {
    // `$ba$<version>$<hex>` is better-auth's envelope (`dist/crypto/index.mjs`,
    // `formatEnvelope`); the version prefix is the whole rotation mechanism.
    expect(await storedBlob()).toMatch(/^\$ba\$1\$[0-9a-f]+$/);
  });
});

describe("rotation", () => {
  it("redeems a version-1 blob under version 2 and re-encodes it forward", async () => {
    const before = await storedBlob();
    expect(before.startsWith("$ba$1$")).toBe(true);

    const rotated = authWith([
      { version: 2, value: SECRET_V2 },
      { version: 1, value: SECRET_V1 },
    ]);

    const code = issued[0];
    expect(code).toBeDefined();
    const response = await redeem(rotated, code as string);
    expect(response.status).toBe(200);

    const after = await storedBlob();
    expect(after).toMatch(/^\$ba\$2\$[0-9a-f]+$/);

    const replay = await redeem(rotated, code as string);
    expect(replay.status).toBeGreaterThanOrEqual(400);

    const next = issued[1];
    expect(next).toBeDefined();
    expect((await redeem(rotated, next as string)).status).toBe(200);
  });

  it("still redeems a pre-existing blob written before the envelope existed", async () => {
    // `symmetricEncrypt` with a string key writes bare hex under the singular `secret`
    // (`dist/crypto/index.mjs`, `rawEncrypt`), which is the real pre-envelope shape.
    const legacyCodes = ["LEG01-AAAAA", "LEG02-BBBBB", "LEG03-CCCCC"];
    const legacyBlob = await symmetricEncrypt({
      key: SECRET_V1,
      data: JSON.stringify(legacyCodes),
    });
    expect(legacyBlob.startsWith("$ba$")).toBe(false);

    const [row] = await testDb.db.select().from(authTwoFactor);
    await testDb.db
      .update(authTwoFactor)
      .set({ backupCodes: legacyBlob })
      .where(eq(authTwoFactor.id, String(row?.id)));
    expect(await storedBlob()).toBe(legacyBlob);

    // The legacy blob is under none of the versioned keys: it is readable only through
    // `secret`, which better-auth keeps as `legacySecret`.
    const rotated = authWith([
      { version: 2, value: SECRET_V2 },
      { version: 1, value: SECRET_V1 },
    ]);
    const response = await redeem(rotated, legacyCodes[0] as string);
    expect(response.status, "a pre-existing bare-hex blob must still redeem").toBe(200);

    expect(await storedBlob()).toMatch(/^\$ba\$2\$[0-9a-f]+$/);
    expect((await redeem(rotated, legacyCodes[1] as string)).status).toBe(200);
  });
});
