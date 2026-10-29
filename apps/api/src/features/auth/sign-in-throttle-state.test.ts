import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CLIENT_ADDRESS_HEADER } from "../../client-address.js";
import type { AdminAuth } from "./instance.js";

/**
 * better-auth reads `NODE_ENV` once on first import, so the stub must precede any import
 * of it; the `production` half is `sign-in-throttle.test.ts`. The limiter's memory store
 * is module-global, so each case uses addresses no other case uses.
 */

vi.stubEnv("NODE_ENV", "development");

/** better-auth's default sign-in rule: three attempts, then a refusal. */
const ALLOWANCE = 3;

const ADMIN_ORIGIN = "https://admin.example.test";

interface Line {
  readonly level: "info" | "warn";
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

type LogFn = (message: string, fields?: Record<string, unknown>) => void;

/**
 * `QCMS_ADMIN_SIGNIN_THROTTLE` is absent, not `undefined` and not empty, so nothing
 * downstream can mistake a supplied blank for a decision. The breach check is off to keep
 * a live HTTPS dependency out of a file about a limiter.
 */
function envWithout(): Record<string, string> {
  return {
    DATABASE_URL: "postgres://unused.invalid/unused",
    QCMS_ADMIN_AUTH_SECRET: "x".repeat(40),
    QCMS_ADMIN_BASE_URL: ADMIN_ORIGIN,
    QCMS_ADMIN_PASSWORD_BREACH_CHECK: "false",
  };
}

/** A declared proxy silences the shared-bucket warning, leaving one line to assert on. */
const PROXIED: Record<string, string> = { QCMS_ADMIN_TRUSTED_PROXY_HOPS: "1" };

let defaulted: AdminAuth;
let hatched: AdminAuth;
let logSignInThrottleState: (typeof import("./instance.js"))["logSignInThrottleState"];

beforeAll(async () => {
  const instance = await import("./instance.js");
  const { loadAdminAuthConfig } = await import("../../config.js");
  const { unusedDb } = await import("../../test-support.js");
  logSignInThrottleState = instance.logSignInThrottleState;

  const build = (env: Record<string, string>): AdminAuth =>
    instance.createAdminAuth({
      db: unusedDb(),
      adminAuth: loadAdminAuthConfig(env).adminAuth,
    });

  defaulted = build(envWithout());
  hatched = build({ ...envWithout(), QCMS_ADMIN_SIGNIN_THROTTLE: "false" });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * The empty body is deliberate: better-auth refuses it `400` after the limiter has counted
 * the attempt, so `400` means past the limiter and `429` means stopped by it.
 */
async function signIn(auth: AdminAuth, address: string): Promise<number> {
  const response = await auth.handler(
    new Request(`${ADMIN_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ADMIN_ORIGIN,
        [CLIENT_ADDRESS_HEADER]: address,
      },
      body: JSON.stringify({}),
    }),
  );
  return response.status;
}

async function overrun(auth: AdminAuth, address: string): Promise<number[]> {
  const statuses: number[] = [];
  for (let n = 0; n < ALLOWANCE + 1; n += 1) statuses.push(await signIn(auth, address));
  return statuses;
}

function recorder(): { lines: Line[]; info: LogFn; warn: LogFn } {
  const lines: Line[] = [];
  const push =
    (level: Line["level"]): LogFn =>
    (message, fields) => {
      lines.push({ level, message, fields: fields ?? {} });
    };
  return { lines, info: push("info"), warn: push("warn") };
}

describe("the throttle is on by default, and NODE_ENV cannot turn it off", () => {
  it("refuses a fourth sign-in under NODE_ENV=development with the variable unset", async () => {
    const statuses = await overrun(defaulted, "203.0.113.11");
    expect(statuses.slice(0, ALLOWANCE)).toEqual([400, 400, 400]);
    expect(statuses.at(-1)).toBe(429);
  });

  it("says so at boot, and says it as the info line", async () => {
    const log = recorder();
    const state = await logSignInThrottleState(defaulted, log, PROXIED);

    expect(state.enabled).toBe(true);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.fields.enabled).toBe(true);
    expect(log.lines[0]?.level).toBe("info");
  });
});

describe("the shared sign-in bucket on a proxy-less deployment", () => {
  it("warns when nothing declares a proxy in front of the admin", async () => {
    const log = recorder();
    const state = await logSignInThrottleState(defaulted, log, {});

    expect(state.enabled).toBe(true);
    expect(log.lines).toHaveLength(2);
    const warning = log.lines[1];
    expect(warning?.level).toBe("warn");
    expect(warning?.message).toContain("ONE bucket");
    expect(warning?.message).toContain("QCMS_ADMIN_TRUSTED_PROXY_HOPS");
    expect(warning?.message).toContain("docs/deploy-ingress.md");
    expect(warning?.message).toContain("a declaration, not an observation");
  });

  it("is silent once a proxy hop count is configured", async () => {
    const log = recorder();
    await logSignInThrottleState(defaulted, log, PROXIED);

    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.level).toBe("info");
  });

  it.each(["", "   ", "0"])("treats %o as no proxy declared", async (hops) => {
    const log = recorder();
    await logSignInThrottleState(defaulted, log, { QCMS_ADMIN_TRUSTED_PROXY_HOPS: hops });

    expect(log.lines).toHaveLength(2);
    expect(log.lines[1]?.level).toBe("warn");
  });

  it("says nothing extra when the throttle itself is off", async () => {
    const log = recorder();
    const state = await logSignInThrottleState(hatched, log, {});

    expect(state.enabled).toBe(false);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.message).toContain("QCMS_ADMIN_SIGNIN_THROTTLE");
  });

  it("echoes no value, only names (SEC-8)", async () => {
    const log = recorder();
    await logSignInThrottleState(defaulted, log, { QCMS_ADMIN_TRUSTED_PROXY_HOPS: "0" });

    const rendered = JSON.stringify(log.lines);
    expect(rendered).not.toContain("203.0.113");
    expect(rendered).not.toMatch(/QCMS_ADMIN_TRUSTED_PROXY_HOPS is set to/);
  });
});

describe("the escape hatch is the only thing that turns it off", () => {
  it("lets a fifth sign-in through when QCMS_ADMIN_SIGNIN_THROTTLE is false", async () => {
    const statuses = await overrun(hatched, "203.0.113.12");
    expect(statuses).toEqual([400, 400, 400, 400]);
    expect(await signIn(hatched, "203.0.113.12")).toBe(400);
  });

  it("warns at boot, naming the variable an operator has to unset", async () => {
    const log = recorder();
    const state = await logSignInThrottleState(hatched, log);

    expect(state.enabled).toBe(false);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.level).toBe("warn");
    expect(log.lines[0]?.message).toContain("QCMS_ADMIN_SIGNIN_THROTTLE");
    expect(log.lines[0]?.message).not.toContain("NODE_ENV");
  });
});

describe("the boot line agrees with what the limiter actually does", () => {
  it("reports enforcement only when a fourth sign-in is really refused", async () => {
    for (const [auth, address] of [
      [defaulted, "203.0.113.21"],
      [hatched, "203.0.113.22"],
    ] as const) {
      const log = recorder();
      const state = await logSignInThrottleState(auth, log, PROXIED);
      const refused = (await overrun(auth, address)).includes(429);

      expect(state.enabled).toBe(refused);
      expect(log.lines[0]?.fields.enabled).toBe(refused);
      expect(log.lines[0]?.level).toBe(refused ? "info" : "warn");
    }
  });

  it("names the header the limiter keys on, and never an address", async () => {
    const log = recorder();
    const state = await logSignInThrottleState(defaulted, log, PROXIED);

    expect(state.addressHeaders).toEqual([CLIENT_ADDRESS_HEADER]);
    const line = log.lines[0];
    expect(line?.fields.addressHeaders).toBe(CLIENT_ADDRESS_HEADER);
    expect(JSON.stringify(line)).not.toContain("203.0.113");
  });
});
