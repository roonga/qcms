import { authTwoFactor } from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Config } from "../../config.js";
import { createInitialAdmin } from "./bootstrap.js";
import { createAdminAuth, type AdminAuth } from "./instance.js";

/**
 * What `two_factor.backup_codes` holds, and what happens to it when the admin auth
 * secret is rotated (issue #319).
 *
 * Every assertion here reads the **column**, never an API response. That is the whole
 * discipline the issue was opened for: #319 was raised because a reviewer read
 * better-auth's decoder (`dist/plugins/two-factor/backup-codes/index.mjs:45`, which
 * plain-JSON parses when `storeBackupCodes` is absent) and concluded the codes sat in
 * plaintext, without reading the caller two files up
 * (`dist/plugins/two-factor/index.mjs:25-27`) that supplies `"encrypted"` as the
 * default. A test that asks the library what it stored would have agreed with the
 * library either way; a test that reads the row cannot.
 *
 * Three properties, in the order they matter:
 *
 * 1. **Unreadable at rest.** No issued code appears in the stored value, in any
 *    encoding a database reader would trip over.
 * 2. **Versioned.** With `secrets` configured the value carries better-auth's
 *    `$ba$<version>$` envelope, which is what makes the key rotatable at all
 *    (`dist/crypto/index.mjs`, `formatEnvelope`/`parseEnvelope`).
 * 3. **Rotatable without loss, forwards and backwards in time.** A blob written under
 *    version 1 still redeems after version 2 becomes current, and redeeming it
 *    re-encodes the remainder under version 2. And a blob written *before* `secrets`
 *    existed - bare hex, no envelope - still redeems, via the legacy fallback.
 *
 * Property 3 is the one that matters to a live deployment, because it is the property
 * task 056 recorded as impossible: it wrote down that changing `QCMS_ADMIN_AUTH_SECRET`
 * kills every enrolment permanently. That is no longer true, and this file is the
 * evidence.
 *
 * Requires Docker (real Postgres, real library, real crypto).
 */

const BOOT_TIMEOUT = 120_000;
/** Generated per run: a literal password is a hard-coded credential the lint gate flags. */
const PASSWORD = `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "codes.admin@example.test";

/** Two distinct auth secrets, so "which key was this written under" is answerable. */
const SECRET_V1 = `v1-${Buffer.from(crypto.getRandomValues(new Uint8Array(30))).toString("base64url")}`;
const SECRET_V2 = `v2-${Buffer.from(crypto.getRandomValues(new Uint8Array(30))).toString("base64url")}`;

let testDb: TestDb;

/** The admin-auth config slice, with whichever key set the case under test needs. */
function adminAuthConfig(
  secrets: readonly { version: number; value: string }[],
): Config["adminAuth"] {
  return {
    secret: SECRET_V1,
    secrets,
    baseUrl: "https://admin.example.test",
    idleMs: 3_600_000,
    secureCookies: false,
    // Off, matching every other harness (`test-support.ts`'s `validEnv`,
    // `e2e/support/admin-accounts.ts`, `sign-in-throttle.test.ts`). This file is about
    // what `two_factor.backup_codes` holds, and leaving issue #178's breach check on
    // would put a live request to `api.pwnedpasswords.com` in the path of the fixture's
    // account creation - which fails closed, so the suite would go red on egress rather
    // than on the property under test.
    breachedPasswordCheck: false,
    // On, matching the shipped default (issue #390), and it costs this file nothing:
    // every request here goes through `auth.api.*` in process, and better-auth's
    // limiter runs in the router's `onRequest` hook, which only `auth.handler` reaches
    // (better-auth 1.6.26, the pinned version, `dist/api/index.mjs:162-168`). Stating
    // the default rather than the escape hatch keeps this fixture from quietly becoming
    // a place the control is off for no reason.
    signInThrottle: true,
  };
}

function authWith(secrets: readonly { version: number; value: string }[]): AdminAuth {
  return createAdminAuth({ db: testDb.db, adminAuth: adminAuthConfig(secrets) });
}

/** The single `two_factor` row's stored blob. */
async function storedBlob(): Promise<string> {
  const [row] = await testDb.db.select().from(authTwoFactor);
  if (row === undefined) throw new Error("no two_factor row");
  return String(row.backupCodes);
}

/**
 * Enroll the fixture account through the real library and return the codes it handed
 * out, leaving `two_factor.backup_codes` written by better-auth itself.
 */
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

/**
 * Redeem one code the way the mounted surface does, with `disableSession` so the call
 * exercises verification and re-encoding without needing a challenge cookie.
 */
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
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb?.teardown();
}, BOOT_TIMEOUT);

describe("at rest", () => {
  it("stores no issued code, in any encoding a database reader could recover", async () => {
    const blob = await storedBlob();
    expect(issued.length).toBeGreaterThan(0);

    for (const code of issued) {
      // The literal, and the two spellings a careless writer produces: the code with
      // its separator removed, and the code lowercased. `toContain` on the raw column
      // is the assertion, not a decrypt-and-compare, because the threat in the issue
      // is a database read and a database read gets exactly this string.
      expect(blob).not.toContain(code);
      expect(blob).not.toContain(code.replace("-", ""));
      expect(blob.toLowerCase()).not.toContain(code.toLowerCase());
    }

    // And it is not merely a re-encoding: base64 of the plaintext JSON is absent too.
    expect(blob).not.toContain(Buffer.from(JSON.stringify(issued)).toString("base64"));
    // Nor is it the JSON array better-auth writes when `storeBackupCodes` is "plain",
    // which is the shape issue #319 believed was on disk.
    expect(blob.trimStart().startsWith("[")).toBe(false);
  });

  it("carries the versioned envelope, so the key behind it can be retired", async () => {
    // `$ba$<version>$<hex>` - `dist/crypto/index.mjs`, `formatEnvelope`. The version
    // prefix is the entire rotation mechanism: without it `symmetricDecrypt` has only
    // one key to try, which is the state task 056 recorded as permanent.
    expect(await storedBlob()).toMatch(/^\$ba\$1\$[0-9a-f]+$/);
  });
});

describe("rotation", () => {
  it("redeems a version-1 blob under version 2 and re-encodes it forward", async () => {
    const before = await storedBlob();
    expect(before.startsWith("$ba$1$")).toBe(true);

    // The rotated deployment: version 2 is current and encrypts; version 1 is kept so
    // what is already stored can still be read.
    const rotated = authWith([
      { version: 2, value: SECRET_V2 },
      { version: 1, value: SECRET_V1 },
    ]);

    const code = issued[0];
    expect(code).toBeDefined();
    const response = await redeem(rotated, code as string);
    expect(response.status).toBe(200);

    // The load-bearing assertion: the blob written under the retired key has moved to
    // the current one, by being used. Nothing ran a migration.
    const after = await storedBlob();
    expect(after).toMatch(/^\$ba\$2\$[0-9a-f]+$/);

    // The redeemed code is spent and the rest survive the re-encode: a second attempt
    // with the same code fails, a first attempt with another succeeds.
    const replay = await redeem(rotated, code as string);
    expect(replay.status).toBeGreaterThanOrEqual(400);

    const next = issued[1];
    expect(next).toBeDefined();
    expect((await redeem(rotated, next as string)).status).toBe(200);
  });

  it("still redeems a pre-existing blob written before the envelope existed", async () => {
    // The genuine pre-existing row: bare hex under the singular `secret`, which is what
    // every QCMS deployment enrolled before this change has on disk. `symmetricEncrypt`
    // with a *string* key writes exactly that shape (`dist/crypto/index.mjs`,
    // `rawEncrypt`), so this seeds the real thing rather than an approximation.
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

    // A deployment that has since rotated to version 2. The legacy blob is under none
    // of the versioned keys; it is readable only through `secret`, which better-auth
    // keeps as `legacySecret` for exactly this. The account still works.
    const rotated = authWith([
      { version: 2, value: SECRET_V2 },
      { version: 1, value: SECRET_V1 },
    ]);
    const response = await redeem(rotated, legacyCodes[0] as string);
    expect(response.status, "a pre-existing bare-hex blob must still redeem").toBe(200);

    // And it migrated forward by being used, which is what stops the legacy fallback
    // from being load-bearing forever.
    expect(await storedBlob()).toMatch(/^\$ba\$2\$[0-9a-f]+$/);
    expect((await redeem(rotated, legacyCodes[1] as string)).status).toBe(200);
  });
});
