import { countAdminUsers } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { loadAdminAuthConfig } from "../../config.js";
import { validEnv } from "../../test-support.js";
import { createInitialAdmin, describeRefusal } from "./bootstrap.js";
import {
  AUTH_BASE_PATH,
  BREACH_CHECK_DISABLED_WARNING,
  BREACH_LOOKUP_FAILED_CODE,
  BREACH_LOOKUP_OPERATOR_GUIDANCE,
  createAdminAuth,
  explainBreachLookupFailure,
  warnIfBreachCheckDisabled,
} from "./instance.js";

// `globalThis.fetch` is stubbed per case so the suite does not depend on
// api.pwnedpasswords.com's uptime; better-auth's real plugin still runs.

const EMAIL = "breach.check@example.test";
const ADMIN_ORIGIN = "http://localhost:7040";

/** Generated per run: a literal password is a hard-coded credential the lint gate flags. */
function newPassword(): string {
  return `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
}

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

const HIBP_PREFIX = "https://api.pwnedpasswords.com/range/";

interface Wire {
  readonly urls: string[];
  restore(): void;
}

function stubWire(answer: (prefix: string) => Response): Wire {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    if (url.startsWith(HIBP_PREFIX)) return answer(url.slice(HIBP_PREFIX.length));
    return original(input, init);
  };
  return {
    urls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** The endpoint's wire format: `SUFFIX:count` lines. */
function rangeBody(suffixes: readonly string[]): Response {
  const lines = [...suffixes.map((suffix) => `${suffix}:42`), `${"0".repeat(35)}:0`];
  return new Response(lines.join("\r\n"), { status: 200 });
}

let testDb: TestDb;
let baseEnv: Record<string, string | undefined>;
let wire: Wire | undefined;

// `baseEnv` is built once: `validEnv()` regenerates every secret per call, so instances
// from two calls would sign cookies with different keys.
function authWith(breachedPasswordCheck: boolean, warn?: (message: string) => void) {
  const config = loadAdminAuthConfig({
    ...baseEnv,
    QCMS_ADMIN_PASSWORD_BREACH_CHECK: String(breachedPasswordCheck),
  });
  expect(config.adminAuth.breachedPasswordCheck).toBe(breachedPasswordCheck);
  return createAdminAuth({
    db: testDb.db,
    adminAuth: config.adminAuth,
    ...(warn === undefined ? {} : { warn }),
  });
}

beforeAll(async () => {
  testDb = await startTestDb();
  baseEnv = validEnv({
    DATABASE_URL: testDb.connectionUri,
    QCMS_ADMIN_BASE_URL: ADMIN_ORIGIN,
  });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterEach(() => {
  wire?.restore();
  wire = undefined;
});

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("a compromised password is refused (NIST SP 800-63B 3.1.1.2, ASVS 5.0 6.2.12)", () => {
  it("refuses the first-run bootstrap and creates nothing", async () => {
    const password = newPassword();
    const hash = await sha1Hex(password);
    wire = stubWire(() => rangeBody([hash.slice(5)]));

    const result = await createInitialAdmin(authWith(true), testDb.db, { email: EMAIL, password });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.refusal.kind).toBe("compromised-password");
    expect(await countAdminUsers(testDb.db)).toBe(0);
  });

  it("sends only the 5-character hash prefix, never the password or the full hash", async () => {
    const password = newPassword();
    const hash = await sha1Hex(password);
    wire = stubWire(() => rangeBody([hash.slice(5)]));

    await createInitialAdmin(authWith(true), testDb.db, { email: EMAIL, password });

    expect(wire.urls).toEqual([`${HIBP_PREFIX}${hash.slice(0, 5)}`]);
    const sent = wire.urls.join(" ");
    expect(sent).not.toContain(password);
    expect(sent).not.toContain(hash);
    expect(sent).not.toContain(hash.slice(5));
  });

  it("explains the refusal without echoing the credential or its hash (SEC-8)", async () => {
    const password = newPassword();
    const hash = await sha1Hex(password);
    const message = describeRefusal({ kind: "compromised-password" });

    expect(message).toContain("QCMS_ADMIN_PASSWORD");
    expect(message).not.toContain(password);
    expect(message).not.toContain(hash);
    expect(message).not.toContain(hash.slice(0, 5));
  });
});

describe("an unreachable corpus fails closed, and says so", () => {
  /** The exact error undici throws when the host does not resolve. */
  function unreachable(): Response {
    throw new TypeError("fetch failed");
  }

  it("refuses rather than waving the password through, and creates nothing", async () => {
    const password = newPassword();
    wire = stubWire(unreachable);

    const result = await createInitialAdmin(authWith(true), testDb.db, { email: EMAIL, password });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.refusal.kind).toBe("breach-corpus-unreachable");
    expect(await countAdminUsers(testDb.db)).toBe(0);
    expect(wire.urls).toHaveLength(1);
  });

  it("names the network, denies the wrong hypothesis, and points at the knob", () => {
    const message = describeRefusal({ kind: "breach-corpus-unreachable" });

    expect(message).toContain("network failure");
    expect(message).toContain("not an authentication failure");
    expect(message).toContain("api.pwnedpasswords.com");
    expect(message).toContain("QCMS_ADMIN_PASSWORD_BREACH_CHECK");
  });

  it("reads differently from a genuine breached-password refusal", () => {
    const network = describeRefusal({ kind: "breach-corpus-unreachable" });
    const compromised = describeRefusal({ kind: "compromised-password" });

    expect(compromised).toContain("appears in the public breach corpus");
    expect(compromised).not.toContain("network failure");
    expect(network).not.toContain("appears in the public breach corpus");
    expect(network).toContain("without ever being compared");
  });

  it("answers the mounted surface with 503 and a first-party code, not an opaque 500", async () => {
    const password = newPassword();
    wire = stubWire(unreachable);

    const response = await authWith(true).handler(
      new Request(`${ADMIN_ORIGIN}${AUTH_BASE_PATH}/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ADMIN_ORIGIN },
        body: JSON.stringify({ email: "unreachable@example.test", password, name: "Nobody" }),
      }),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { code?: string; message?: string };
    expect(body.code).toBe(BREACH_LOOKUP_FAILED_CODE);
    expect(body.message).toContain("api.pwnedpasswords.com");
    expect(JSON.stringify(body)).not.toContain(password);
    expect(await countAdminUsers(testDb.db)).toBe(0);
  });

  it("puts no environment identifier of any kind in the body (ADR-24, issue #910)", async () => {
    const password = newPassword();
    wire = stubWire(unreachable);
    const logged: string[] = [];

    const response = await authWith(true, (message) => logged.push(message)).handler(
      new Request(`${ADMIN_ORIGIN}${AUTH_BASE_PATH}/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ADMIN_ORIGIN },
        body: JSON.stringify({ email: "no-env-name@example.test", password, name: "Nobody" }),
      }),
    );

    const raw = await response.text();
    expect(response.status).toBe(503);
    expect(raw).not.toMatch(/QCMS_[A-Z0-9_]+/);
    expect(raw).toContain(BREACH_LOOKUP_FAILED_CODE);
    expect(raw).toContain("api.pwnedpasswords.com");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("QCMS_ADMIN_PASSWORD_BREACH_CHECK");
    expect(logged[0]).toContain(BREACH_LOOKUP_OPERATOR_GUIDANCE);
  });

  it("logs nothing on the two branches it passes through untouched", () => {
    const logged: string[] = [];
    const warn = (message: string): void => {
      logged.push(message);
    };
    const unrelated = new Error("scrypt failed");

    expect(explainBreachLookupFailure(unrelated, warn)).toBe(unrelated);
    expect(explainBreachLookupFailure("not an error at all", warn)).toBe("not an error at all");
    expect(logged).toEqual([]);
  });

  it("relabels only the vendor's lookup failure, so nothing unrelated is blamed on it", () => {
    const unrelated = new Error("scrypt failed");
    expect(explainBreachLookupFailure(unrelated)).toBe(unrelated);
    expect(explainBreachLookupFailure("not an error at all")).toBe("not an error at all");
  });
});

let adminPassword = "";

describe("QCMS_ADMIN_PASSWORD_BREACH_CHECK=false is honoured", () => {
  it("makes no outbound request at all, and accepts a corpus password", async () => {
    adminPassword = newPassword();
    const hash = await sha1Hex(adminPassword);
    // The stub reports this password as breached if it is ever consulted.
    wire = stubWire(() => rangeBody([hash.slice(5)]));

    const result = await createInitialAdmin(authWith(false), testDb.db, {
      email: EMAIL,
      password: adminPassword,
    });

    expect(result.ok).toBe(true);
    expect(await countAdminUsers(testDb.db)).toBe(1);
    expect(wire.urls).toEqual([]);
  });
});

describe("change-password over the mounted surface", () => {
  async function signInCookie(): Promise<string> {
    const response = await authWith(false).handler(
      new Request(`${ADMIN_ORIGIN}${AUTH_BASE_PATH}/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ADMIN_ORIGIN },
        body: JSON.stringify({ email: EMAIL, password: adminPassword }),
      }),
    );
    expect(response.status).toBe(200);
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }

  it("refuses a new password that is in the corpus, and leaves the old one working", async () => {
    const cookie = await signInCookie();
    const newOne = newPassword();
    const hash = await sha1Hex(newOne);
    wire = stubWire(() => rangeBody([hash.slice(5)]));

    const response = await authWith(true).handler(
      new Request(`${ADMIN_ORIGIN}${AUTH_BASE_PATH}/change-password`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ADMIN_ORIGIN, cookie },
        body: JSON.stringify({ currentPassword: adminPassword, newPassword: newOne }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("PASSWORD_COMPROMISED");
    expect(wire.urls).toEqual([`${HIBP_PREFIX}${hash.slice(0, 5)}`]);
    await expect(signInCookie()).resolves.toContain("qcms_admin.session_token=");
  });

  it("accepts a new password the corpus does not know", async () => {
    const cookie = await signInCookie();
    const newOne = newPassword();
    wire = stubWire(() => rangeBody([]));

    const response = await authWith(true).handler(
      new Request(`${ADMIN_ORIGIN}${AUTH_BASE_PATH}/change-password`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ADMIN_ORIGIN, cookie },
        body: JSON.stringify({ currentPassword: adminPassword, newPassword: newOne }),
      }),
    );

    expect(response.status).toBe(200);
    expect(wire.urls).toHaveLength(1);
    adminPassword = newOne;
    await expect(signInCookie()).resolves.toContain("qcms_admin.session_token=");
  });
});

describe("the disabled knob announces itself", () => {
  it("emits one loud line naming the variable and what it costs", () => {
    const lines: string[] = [];
    warnIfBreachCheckDisabled({ breachedPasswordCheck: false }, (message) => lines.push(message));

    expect(lines).toEqual([BREACH_CHECK_DISABLED_WARNING]);
    expect(lines[0]).toContain("QCMS_ADMIN_PASSWORD_BREACH_CHECK");
    expect(lines[0]).toContain("NIST SP 800-63B");
    expect(lines[0]).toContain("api.pwnedpasswords.com");
  });

  it("says nothing when the check is on, so the line stays worth reading", () => {
    const lines: string[] = [];
    warnIfBreachCheckDisabled({ breachedPasswordCheck: true }, (message) => lines.push(message));
    expect(lines).toEqual([]);
  });
});
