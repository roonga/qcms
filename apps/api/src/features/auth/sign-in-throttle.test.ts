import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CLIENT_ADDRESS_HEADER } from "../../client-address.js";
import type { AdminAuth } from "./instance.js";

/**
 * better-auth reads `NODE_ENV` once on first import, so the stub precedes the dynamic
 * import of `./instance.js`. The limiter's memory store is module-global, so each case
 * uses addresses no other case uses.
 */

/** better-auth's default sign-in rule: three attempts, then a refusal. */
const ALLOWANCE = 3;

const ADMIN_ORIGIN = "https://admin.example.test";

let auth: AdminAuth;
let hatched: AdminAuth;
let logSignInThrottleState: (typeof import("./instance.js"))["logSignInThrottleState"];

vi.stubEnv("NODE_ENV", "production");

beforeAll(async () => {
  const { createAdminAuth, logSignInThrottleState: log } = await import("./instance.js");
  const { unusedDb } = await import("../../test-support.js");
  logSignInThrottleState = log;
  const build = (signInThrottle: boolean): AdminAuth =>
    createAdminAuth({
      db: unusedDb(),
      adminAuth: {
        secret: "x".repeat(40),
        secrets: [{ version: 1, value: "x".repeat(40) }],
        baseUrl: ADMIN_ORIGIN,
        idleMs: 3_600_000,
        secureCookies: true,
        // Off, to keep a live HTTPS dependency out of a file about a limiter.
        breachedPasswordCheck: false,
        signInThrottle,
      },
    });
  auth = build(true);
  hatched = build(false);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * The empty body is deliberate: better-auth refuses it `400` after the limiter has counted
 * the attempt, so `400` means past the limiter and `429` means stopped by it.
 */
async function signIn(headers: Record<string, string>, at: AdminAuth = auth): Promise<number> {
  const response = await at.handler(
    new Request(`${ADMIN_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ADMIN_ORIGIN, ...headers },
      body: JSON.stringify({}),
    }),
  );
  return response.status;
}

async function attempts(
  count: number,
  headers: (n: number) => Record<string, string>,
  at: AdminAuth = auth,
) {
  const statuses: number[] = [];
  for (let n = 0; n < count; n += 1) statuses.push(await signIn(headers(n), at));
  return statuses;
}

describe("sign-in throttling keys on the address the BFF vouched for", () => {
  it("does NOT let a rotating x-forwarded-for buy a fresh allowance", async () => {
    // One vouched address, plus caller-controlled headers rotated on every attempt.
    const statuses = await attempts(ALLOWANCE + 2, (n) => ({
      [CLIENT_ADDRESS_HEADER]: "203.0.113.7",
      "x-forwarded-for": `10.0.0.${String(n)}`,
      "x-real-ip": `10.1.0.${String(n)}`,
    }));
    expect(statuses.slice(0, ALLOWANCE)).toEqual([400, 400, 400]);
    expect(statuses.slice(ALLOWANCE)).toEqual([429, 429]);
  });

  it("still gives two genuinely different clients two allowances", async () => {
    const exhausted = await attempts(ALLOWANCE + 1, () => ({
      [CLIENT_ADDRESS_HEADER]: "198.51.100.1",
    }));
    expect(exhausted.at(-1)).toBe(429);

    const other = await signIn({ [CLIENT_ADDRESS_HEADER]: "198.51.100.2" });
    expect(other).toBe(400);
  });

  it("shares one bucket when nothing was vouched for, rather than handing out one each", async () => {
    // With no address to key on, better-auth uses a single `no-trusted-ip` bucket.
    const unvouched = await attempts(ALLOWANCE + 1, () => ({}));
    expect(unvouched.at(-1)).toBe(429);

    // Forging both headers better-auth used to read lands in that same bucket.
    const forging = await signIn({ "x-forwarded-for": "192.0.2.99", "x-real-ip": "192.0.2.98" });
    expect(forging).toBe(429);
  });
});

describe("QCMS_ADMIN_SIGNIN_THROTTLE decides it, under NODE_ENV=production too", () => {
  it("still refuses a fourth attempt when the knob is on", async () => {
    const statuses = await attempts(ALLOWANCE + 1, () => ({
      [CLIENT_ADDRESS_HEADER]: "203.0.113.31",
    }));
    expect(statuses.slice(0, ALLOWANCE)).toEqual([400, 400, 400]);
    expect(statuses.at(-1)).toBe(429);
  });

  it("lets a fifth attempt through when the knob is off, production or not", async () => {
    const statuses = await attempts(
      ALLOWANCE + 2,
      () => ({ [CLIENT_ADDRESS_HEADER]: "203.0.113.32" }),
      hatched,
    );
    expect(statuses).toEqual([400, 400, 400, 400, 400]);
  });

  it("reports the off state at boot rather than reporting the environment", async () => {
    const lines: { level: string; fields: Record<string, unknown> }[] = [];
    const record =
      (level: string) =>
      (_message: string, fields?: Record<string, unknown>): void => {
        lines.push({ level, fields: fields ?? {} });
      };
    const state = await logSignInThrottleState(hatched, {
      info: record("info"),
      warn: record("warn"),
    });

    expect(state.enabled).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("warn");
  });
});

describe("the boot line agrees with what the limiter actually does", () => {
  it("reports enforcement, and a fourth sign-in really is refused", async () => {
    const lines: { level: string; fields: Record<string, unknown> }[] = [];
    const record =
      (level: string) =>
      (_message: string, fields?: Record<string, unknown>): void => {
        lines.push({ level, fields: fields ?? {} });
      };
    const state = await logSignInThrottleState(
      auth,
      { info: record("info"), warn: record("warn") },
      // A declared proxy silences the shared-bucket warning, leaving one line to assert on.
      { QCMS_ADMIN_TRUSTED_PROXY_HOPS: "1" },
    );

    const statuses = await attempts(ALLOWANCE + 1, () => ({
      [CLIENT_ADDRESS_HEADER]: "203.0.113.200",
    }));
    const refused = statuses.includes(429);

    expect(state.enabled).toBe(refused);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields.enabled).toBe(refused);
    expect(lines[0]?.level).toBe(refused ? "info" : "warn");

    // Pinned absolutely too, so a stub that stopped taking effect cannot pass vacuously.
    expect(refused).toBe(true);
  });
});
