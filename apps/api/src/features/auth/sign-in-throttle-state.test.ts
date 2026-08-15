import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CLIENT_ADDRESS_HEADER } from "../../client-address.js";
import type { AdminAuth } from "./instance.js";

/**
 * `NODE_ENV` no longer decides whether SEC-1's sign-in throttle runs (issue #390), and
 * the boot line still says what is true (issue #498's half).
 *
 * ## What this pins, and why it is the case that closes the finding
 *
 * The finding was that a security control was switched by `NODE_ENV`: better-auth 1.6.26
 * resolves `rateLimit.enabled` as `options.rateLimit?.enabled ?? isProduction`
 * (`dist/context/create-context.mjs:171`), so a process started outside the shipped
 * images served an unlimited admin sign-in surface. `createAdminAuth` now passes the
 * value from `QCMS_ADMIN_SIGNIN_THROTTLE`, default on.
 *
 * This whole file therefore runs under **`NODE_ENV=development`**, the value that used
 * to switch the control off, and the first case drives four real sign-in POSTs at an
 * instance whose environment does not mention the variable at all. A `429` on the fourth
 * is the finding closed: the ruling's default-on behaviour, observed from the limiter
 * rather than from the configuration, in the environment where it used to be absent.
 * The second case is the other direction, and it matters just as much: the escape hatch
 * turns it off, so the knob is doing the deciding rather than sitting inert beside
 * something else that is.
 *
 * ## Why the configuration is parsed rather than hand-written here
 *
 * The instances below are built through `loadAdminAuthConfig`, from environment records,
 * rather than from a `Config["adminAuth"]` literal. A literal would assert that
 * `createAdminAuth` honours a boolean, which is the easy half; the claim worth pinning
 * is that an **absent variable** reaches the limiter as enforcement, and only the parser
 * can make that claim. The env-only half of the same property (the default, and that no
 * value of `NODE_ENV` moves it) is `apps/api/src/config.test.ts`.
 *
 * ## Why the library is driven rather than the configuration inspected
 *
 * Asserting `config.adminAuth.signInThrottle` would pass for a value better-auth never
 * reads. These cases send real requests through `auth.handler` and read real statuses
 * off the vendor's own limiter, so what is pinned is behaviour rather than belief.
 *
 * ## Three mechanics worth knowing before editing this file
 *
 * 1. **`NODE_ENV` is read once, when better-auth's env module is first imported**
 *    (`@better-auth/core/dist/env/env-impl.mjs:30` captures `nodeENV` in a module-scope
 *    `const`), and Vitest externalises that dependency, so `vi.resetModules()` never
 *    re-evaluates it and one file cannot hold two values of it. That is why the stub is
 *    at the top of the file and why `./instance.js` arrives by dynamic import inside
 *    `beforeAll`: a static import would run before the stub. The `production` half of
 *    the matrix is a **second file**, `sign-in-throttle.test.ts`, for the same reason.
 * 2. **The knob is not under that constraint.** `rateLimit.enabled` is a per-instance
 *    option resolved in each instance's own `$context`, so both directions of the switch
 *    live in this one file. Only the two values of `NODE_ENV` need two files. Between
 *    this file and `sign-in-throttle.test.ts` the matrix is complete: on and off, under
 *    development and under production, which is what "`NODE_ENV` decides nothing here"
 *    has to mean to be worth writing down.
 * 3. **The limiter's default memory store is module-global**, shared by every instance in
 *    this file, and the window is ten seconds - longer than the file takes to run. Every
 *    case therefore uses addresses no other case uses, so the order they run in cannot
 *    change what they see.
 *
 * The database handle is `unusedDb()`, and that is an assertion too: a body better-auth
 * rejects as malformed never reaches an adapter, so a `400` here proves the request got
 * past the limiter and a `429` proves it did not, without a container in sight.
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
 * The environment an operator who configured nothing has: no `QCMS_ADMIN_SIGNIN_THROTTLE`
 * key at all, which is the state the ruling's default is about. Absent, not `undefined`
 * and not empty, so nothing downstream can mistake a supplied blank for a decision.
 *
 * The breach check is off because no request here sets a password, so leaving SEC-1's
 * corpus lookup on would put a live HTTPS dependency in a file about a limiter.
 */
function envWithout(): Record<string, string> {
  return {
    DATABASE_URL: "postgres://unused.invalid/unused",
    QCMS_ADMIN_AUTH_SECRET: "x".repeat(40),
    QCMS_ADMIN_BASE_URL: ADMIN_ORIGIN,
    QCMS_ADMIN_PASSWORD_BREACH_CHECK: "false",
  };
}

/**
 * The subject arrives by dynamic import in `beforeAll`, never as a static import at the
 * top of this file: the `NODE_ENV` stub above has to be in place before anything pulls
 * better-auth in, and a static import would run first. The type comes from the same
 * module by `typeof import`, which is erased and pulls nothing in.
 */
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
 * One sign-in POST as the admin BFF makes it, answering with the status only. The empty
 * body is deliberate: better-auth refuses it `400` *after* the limiter has counted the
 * attempt, so `400` proves the request got past the limiter and `429` proves it did not,
 * with no account and no database in sight.
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

/** One more attempt than the allowance, from one address, as status codes. */
async function overrun(auth: AdminAuth, address: string): Promise<number[]> {
  const statuses: number[] = [];
  for (let n = 0; n < ALLOWANCE + 1; n += 1) statuses.push(await signIn(auth, address));
  return statuses;
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

describe("the throttle is on by default, and NODE_ENV cannot turn it off", () => {
  it("refuses a fourth sign-in under NODE_ENV=development with the variable unset", async () => {
    // The case issue #390 is closed by. Under this exact `NODE_ENV`, before the knob
    // existed, all four of these were 400 and the surface was unlimited.
    const statuses = await overrun(defaulted, "203.0.113.11");
    expect(statuses.slice(0, ALLOWANCE)).toEqual([400, 400, 400]);
    expect(statuses.at(-1)).toBe(429);
  });

  it("says so at boot, and says it as the info line", async () => {
    const log = recorder();
    const state = await logSignInThrottleState(defaulted, log);

    expect(state.enabled).toBe(true);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]?.fields.enabled).toBe(true);
    expect(log.lines[0]?.level).toBe("info");
  });
});

describe("the escape hatch is the only thing that turns it off", () => {
  it("lets a fifth sign-in through when QCMS_ADMIN_SIGNIN_THROTTLE is false", async () => {
    // Same process, same `NODE_ENV`, same everything but the variable. A `429` anywhere
    // in here would mean the switch is not the thing deciding.
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
    // The operator has to be able to act on it, so the line names the variable that
    // decided it rather than only reporting the outcome. It must no longer name
    // `NODE_ENV`, which would send them to change something that has no effect.
    expect(log.lines[0]?.message).toContain("QCMS_ADMIN_SIGNIN_THROTTLE");
    expect(log.lines[0]?.message).not.toContain("NODE_ENV");
  });
});

describe("the boot line agrees with what the limiter actually does", () => {
  it("reports enforcement only when a fourth sign-in is really refused", async () => {
    // The agreement, in both directions at once, derived from behaviour rather than
    // from configuration: this fails on a line claiming throttling the limiter is not
    // doing, and on a line denying throttling it is. Both instances go through it, so
    // neither direction can pass by being the only one measured.
    for (const [auth, address] of [
      [defaulted, "203.0.113.21"],
      [hatched, "203.0.113.22"],
    ] as const) {
      const log = recorder();
      const state = await logSignInThrottleState(auth, log);
      const refused = (await overrun(auth, address)).includes(429);

      expect(state.enabled).toBe(refused);
      expect(log.lines[0]?.fields.enabled).toBe(refused);
      // A line an operator has to grep for is a line at the level that matches the
      // news: enforcement is `info`, an unlimited auth surface is `warn`.
      expect(log.lines[0]?.level).toBe(refused ? "info" : "warn");
    }
  });

  it("names the header the limiter keys on, and never an address", async () => {
    const log = recorder();
    const state = await logSignInThrottleState(defaulted, log);

    // Where the limiter looks, read back off the resolved context. Never what it found:
    // an address identifies a person (SEC-8, SEC-13).
    expect(state.addressHeaders).toEqual([CLIENT_ADDRESS_HEADER]);
    const line = log.lines[0];
    expect(line?.fields.addressHeaders).toBe(CLIENT_ADDRESS_HEADER);
    expect(JSON.stringify(line)).not.toContain("203.0.113");
  });
});
