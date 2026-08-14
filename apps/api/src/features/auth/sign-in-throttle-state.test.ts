import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CLIENT_ADDRESS_HEADER } from "../../client-address.js";
import type { AdminAuth } from "./instance.js";

/**
 * The boot line says what is true, not what was configured (issue #390).
 *
 * ## What this pins
 *
 * `logSignInThrottleState` exists so an operator can read off a running process whether
 * SEC-1's sign-in throttle is enforcing anything. A line that says so from the *options*
 * this shell passes in would be worth nothing: those options do not set
 * `rateLimit.enabled` at all, and better-auth fills it from `NODE_ENV`. So the only
 * useful assertion is agreement with the limiter itself, and that is what the case below
 * makes: it drives four real sign-in POSTs, observes whether a `429` comes back, and
 * requires the logged line to have said exactly that. It fails in **both** directions -
 * a line claiming throttling while the fourth attempt sails through, and a line claiming
 * none while the limiter refuses.
 *
 * ## Why this is a separate file from `sign-in-throttle.test.ts`
 *
 * That one runs under `NODE_ENV=production`, this one under `development`, and one
 * process cannot be both. better-auth's `nodeENV` is captured in a module-scope `const`
 * on the first import of `@better-auth/core/dist/env/env-impl.mjs`, and that module is a
 * dependency, so Vitest externalises it: `vi.resetModules()` clears our own modules from
 * the registry but never re-evaluates it, and a second value of `NODE_ENV` inside one
 * file would be ignored. Per-file isolation is what actually makes the stub take, which
 * is why the two directions are two files. Between them the branch is covered both ways;
 * within either, the assertion is derived from behaviour rather than from the env, so
 * neither file cares which way its own stub went.
 *
 * `development` rather than leaving `NODE_ENV` at whatever the runner sets: it is the
 * value a developer's own `pnpm dev` process runs under, so this is the case an operator
 * actually meets. It is also the interesting one, because the throttle is **off** here
 * and nothing but this line says so.
 */

vi.stubEnv("NODE_ENV", "development");

/** better-auth's default sign-in rule: three attempts, then a refusal. */
const ALLOWANCE = 3;

const ADMIN_ORIGIN = "https://admin.example.test";

/** One recorded log line: enough to tell the two levels apart and read the fields. */
interface Line {
  readonly level: "info" | "warn";
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

type LogFn = (message: string, fields?: Record<string, unknown>) => void;

/**
 * The subject arrives by dynamic import in `beforeAll`, never as a static import at the
 * top of this file: the `NODE_ENV` stub above has to be in place before anything pulls
 * better-auth in, and a static import would run first. The type comes from the same
 * module by `typeof import`, which is erased and pulls nothing in.
 */
let auth: AdminAuth;
let logSignInThrottleState: (typeof import("./instance.js"))["logSignInThrottleState"];

beforeAll(async () => {
  const instance = await import("./instance.js");
  const { unusedDb } = await import("../../test-support.js");
  logSignInThrottleState = instance.logSignInThrottleState;
  auth = instance.createAdminAuth({
    db: unusedDb(),
    adminAuth: {
      secret: "x".repeat(40),
      secrets: [{ version: 1, value: "x".repeat(40) }],
      baseUrl: ADMIN_ORIGIN,
      idleMs: 3_600_000,
      secureCookies: true,
      // No request here sets a password, so the SEC-1 breach check would never fire.
      breachedPasswordCheck: false,
    },
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * One sign-in POST as the admin BFF makes it, answering with the status only. The empty
 * body is deliberate: better-auth refuses it `400` *after* the limiter has counted the
 * attempt, so `400` proves the request got past the limiter and `429` proves it did not,
 * with no account and no database in sight.
 */
async function signIn(address: string): Promise<number> {
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

/** A logger that keeps its lines instead of writing them. */
function recorder(): { lines: Line[]; info: LogFn; warn: LogFn } {
  const lines: Line[] = [];
  const push =
    (level: Line["level"]): LogFn =>
    (message, fields) => {
      lines.push({ level, message, fields: fields ?? {} });
    };
  return { lines, info: push("info"), warn: push("warn") };
}

describe("the boot line agrees with what the limiter actually does", () => {
  it("reports enforcement only when a fourth sign-in is really refused", async () => {
    const log = recorder();
    const state = await logSignInThrottleState(auth, log);

    // What the limiter does, measured rather than assumed: one address, one more attempt
    // than the allowance. Under a running limiter the last one is a 429.
    const statuses: number[] = [];
    for (let n = 0; n < ALLOWANCE + 1; n += 1) statuses.push(await signIn("203.0.113.11"));
    const refused = statuses.includes(429);

    // The agreement, in both directions at once.
    expect(state.enabled).toBe(refused);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.fields.enabled).toBe(refused);
    // A line an operator has to grep for is a line at the level that matches the news:
    // enforcement is `info`, an unlimited auth surface is `warn`.
    expect(log.lines[0]?.level).toBe(refused ? "info" : "warn");
  });

  it("names the header the limiter keys on, and never an address", async () => {
    const log = recorder();
    const state = await logSignInThrottleState(auth, log);

    // Where the limiter looks, read back off the resolved context. Never what it found:
    // an address identifies a person (SEC-8, SEC-13).
    expect(state.addressHeaders).toEqual([CLIENT_ADDRESS_HEADER]);
    const line = log.lines[0];
    expect(line?.fields.addressHeaders).toBe(CLIENT_ADDRESS_HEADER);
    expect(JSON.stringify(line)).not.toContain("203.0.113");
  });

  it("is the OFF line under NODE_ENV=development, which is the whole point of #390", async () => {
    // The env-specific half, so a stub that silently stopped taking effect is caught
    // rather than passing vacuously through the behaviour-derived case above.
    const log = recorder();
    const state = await logSignInThrottleState(auth, log);

    expect(state.enabled).toBe(false);
    expect(log.lines[0]?.level).toBe("warn");
    // The operator has to be able to act on it, so the line names the variable that
    // decided it rather than only reporting the outcome.
    expect(log.lines[0]?.message).toContain("NODE_ENV");
  });
});
