import { countAdminUsers } from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { loadAdminAuthConfig } from "../../config.js";
import { validEnv } from "../../test-support.js";
import { createInitialAdmin, describeRefusal } from "./bootstrap.js";
import {
  AUTH_BASE_PATH,
  BREACH_CHECK_DISABLED_WARNING,
  createAdminAuth,
  warnIfBreachCheckDisabled,
} from "./instance.js";

/**
 * SEC-1's breach-corpus check (issue #178), asserted as behaviour an operator can
 * observe: a compromised password is refused at both entry points, an unreachable
 * corpus refuses too (fail-closed), and the documented knob turns the whole thing
 * off. Nothing here asserts that a plugin appears in a config object, because that
 * would pass just as happily if better-auth never called it.
 *
 * ## Why the corpus is stubbed rather than real
 *
 * The control is a live HTTPS call to `api.pwnedpasswords.com`. A suite that depends
 * on a third party's uptime goes red for reasons that have nothing to do with this
 * repository, so `globalThis.fetch` is replaced for the duration of each case. The
 * stub is not a mock of the plugin: better-auth's real plugin runs, really hashes the
 * password with SHA-1, really builds the range URL, and really parses the response.
 * Only the wire is synthetic.
 *
 * The "compromised" fixture is the range response for the test's **own** randomly
 * generated password, computed from its real SHA-1. So no assertion depends on a
 * literal breached password (a hard-coded credential the lint gate flags) or on what
 * the real corpus happens to hold today.
 *
 * The real endpoint was exercised by hand while this landed and behaved exactly as
 * the stub does: an in-process `signUpEmail` with a corpus password came back
 * `400 PASSWORD_COMPROMISED` after a single request to `/range/{prefix}`, and with
 * the host blackholed at the resolver it came back `500` rather than succeeding.
 *
 * Requires Docker: the assertion that matters most is "and no admin row was created",
 * which only a real database can answer.
 */

const BOOT_TIMEOUT = 120_000;
const EMAIL = "breach.check@example.test";
const ADMIN_ORIGIN = "http://localhost:7040";

/** Generated per run: a literal password is a hard-coded credential the lint gate flags. */
function newPassword(): string {
  return `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
}

/** The uppercase hex SHA-1 the plugin computes, so the stub can answer about it. */
async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

const HIBP_PREFIX = "https://api.pwnedpasswords.com/range/";

interface Wire {
  /** Every URL the process fetched while the stub was installed. */
  readonly urls: string[];
  restore(): void;
}

/**
 * Install a fetch that answers the HIBP range endpoint from `answer` and passes
 * everything else through, recording what was asked for.
 */
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

/** A range body shaped like the endpoint's: `SUFFIX:count` lines, plus padding. */
function rangeBody(suffixes: readonly string[]): Response {
  const lines = [...suffixes.map((suffix) => `${suffix}:42`), `${"0".repeat(35)}:0`];
  return new Response(lines.join("\r\n"), { status: 200 });
}

let testDb: TestDb;
let baseEnv: Record<string, string | undefined>;
let wire: Wire | undefined;

/**
 * An instance over the shared environment, with only the knob varied.
 *
 * The environment is built **once** rather than per call: `validEnv()` regenerates
 * every synthetic secret on each invocation, so two instances built from two calls
 * would sign their cookies with different keys and the change-password case below
 * would fail for an unrelated reason.
 */
function authWith(breachedPasswordCheck: boolean) {
  const config = loadAdminAuthConfig({
    ...baseEnv,
    QCMS_ADMIN_PASSWORD_BREACH_CHECK: String(breachedPasswordCheck),
  });
  expect(config.adminAuth.breachedPasswordCheck).toBe(breachedPasswordCheck);
  return createAdminAuth({ db: testDb.db, adminAuth: config.adminAuth });
}

beforeAll(async () => {
  testDb = await startTestDb();
  baseEnv = validEnv({
    DATABASE_URL: testDb.connectionUri,
    QCMS_ADMIN_BASE_URL: ADMIN_ORIGIN,
  });
}, BOOT_TIMEOUT);

afterEach(() => {
  wire?.restore();
  wire = undefined;
});

afterAll(async () => {
  await testDb?.teardown();
}, BOOT_TIMEOUT);

describe("a compromised password is refused (NIST SP 800-63B 3.1.1.2, ASVS 5.0 6.2.12)", () => {
  it("refuses the first-run bootstrap and creates nothing", async () => {
    const password = newPassword();
    const hash = await sha1Hex(password);
    wire = stubWire(() => rangeBody([hash.slice(5)]));

    const result = await createInitialAdmin(authWith(true), testDb.db, { email: EMAIL, password });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.refusal.kind).toBe("compromised-password");
    // The refusal is the whole point: no account exists afterwards.
    expect(await countAdminUsers(testDb.db)).toBe(0);
  });

  it("sends only the 5-character hash prefix, never the password or the full hash", async () => {
    const password = newPassword();
    const hash = await sha1Hex(password);
    wire = stubWire(() => rangeBody([hash.slice(5)]));

    await createInitialAdmin(authWith(true), testDb.db, { email: EMAIL, password });

    // k-anonymity, and SEC-8: what left this process was five hex characters shared
    // by roughly 2^15 hashes.
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

describe("an unreachable corpus fails closed", () => {
  it("refuses rather than waving the password through, and creates nothing", async () => {
    const password = newPassword();
    // What undici throws when the host does not resolve or refuses the connection,
    // which is what an air-gapped deployment looks like from inside this process.
    wire = stubWire(() => {
      throw new TypeError("fetch failed");
    });

    const result = await createInitialAdmin(authWith(true), testDb.db, { email: EMAIL, password });

    expect(result.ok).toBe(false);
    const refusal = result.ok === false ? result.refusal : undefined;
    expect(refusal?.kind).toBe("sign-up-rejected");
    expect(refusal?.kind === "sign-up-rejected" && refusal.status).toBe(500);
    expect(await countAdminUsers(testDb.db)).toBe(0);
    // The check was attempted; this is not a silent skip.
    expect(wire.urls).toHaveLength(1);
  });

  it("points the operator at the knob rather than at a stack trace", () => {
    const message = describeRefusal({
      kind: "sign-up-rejected",
      status: 500,
      detail: "Failed to check password. Please try again later.",
    });
    expect(message).toContain("QCMS_ADMIN_PASSWORD_BREACH_CHECK");
    expect(message).toContain("api.pwnedpasswords.com");
  });
});

/** Set by the knob-off case below, then reused by the change-password case. */
let adminPassword = "";

describe("QCMS_ADMIN_PASSWORD_BREACH_CHECK=false is honoured", () => {
  it("makes no outbound request at all, and accepts a corpus password", async () => {
    adminPassword = newPassword();
    const hash = await sha1Hex(adminPassword);
    // The stub would report this password as breached if it were ever consulted.
    wire = stubWire(() => rangeBody([hash.slice(5)]));

    const result = await createInitialAdmin(authWith(false), testDb.db, {
      email: EMAIL,
      password: adminPassword,
    });

    expect(result.ok).toBe(true);
    expect(await countAdminUsers(testDb.db)).toBe(1);
    // Not merely "did not block": an offline deployment must not reach the network.
    expect(wire.urls).toEqual([]);
  });
});

/**
 * The second reachable entry point (`route.ts`'s allowlist has exactly two paths that
 * set a password, and `sign-up/email` is the CLI-only one covered above). Driven
 * through `auth.handler` with a real `Request`, so this is the HTTP shape the admin
 * BFF forwards, not an in-process convenience call.
 */
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
    // Rejected, not half-applied: the account still has the password it started with.
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
    // The check ran (one lookup) and let it through, which is the other half of
    // "the guard is a guard" - a control that refuses everything is not one.
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
