import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CLIENT_ADDRESS_HEADER } from "../../client-address.js";
import type { AdminAuth } from "./instance.js";

/**
 * Which bucket a sign-in attempt lands in (issue #374, SEC-1).
 *
 * ## What this pins
 *
 * better-auth throttles sign-in per client address, three attempts per ten seconds by
 * default, keyed on `${resolved address}|${path}`. Which header it resolves that
 * address from is therefore the whole security property, and before this issue it was
 * the library default `x-forwarded-for` while the admin BFF forwarded the browser's own
 * copy of that header verbatim: a caller rotating the value bought a fresh allowance
 * every attempt, so the throttle reported working while being bypassable. The three
 * cases below are the fix, the half that stops the fix from being worse than the bug,
 * and the fail-safe direction, in that order.
 *
 * ## Why the library is driven rather than the configuration inspected
 *
 * Asserting `options.advanced.ipAddress.ipAddressHeaders` would pass for a
 * configuration better-auth ignores. These cases send real requests through
 * `auth.handler` and read real `429`s off the vendor's own limiter, so what is pinned
 * is the behaviour rather than our belief about it.
 *
 * ## Two mechanics worth knowing before editing this file
 *
 * 1. **`NODE_ENV` is read once, when better-auth's env module is first imported**
 *    (`@better-auth/core/dist/env/env-impl.mjs` captures `nodeENV` in a module-scope
 *    `const`, and `rateLimit.enabled` defaults to `NODE_ENV === "production"`). So the
 *    stub below has to be in place *before* the first import of anything that pulls the
 *    library in, which is why `./instance.js` arrives by dynamic import inside
 *    `beforeAll` and is not a static import at the top of this file.
 * 2. **The limiter's default memory store is module-global**, shared by every instance
 *    in this file, and the window is ten seconds - longer than the file takes to run.
 *    Every case therefore uses addresses no other case uses, so the order they run in
 *    cannot change what they see.
 *
 * The database handle is `unusedDb()`, and that is an assertion too: a body better-auth
 * rejects as malformed never reaches an adapter, so a `400` here proves the request got
 * past the limiter and a `429` proves it did not, without a container in sight.
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
        // Nothing here sets a password (every request carries an empty body), so the
        // SEC-1 breach check would never fire; false keeps that explicit rather than
        // leaving a live HTTPS dependency one test edit away.
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
 * One sign-in POST as the admin BFF makes it, answering with the status only.
 *
 * The body is empty on purpose: better-auth refuses it `400` after the limiter has
 * already counted the attempt, which is exactly the observation these cases need and
 * needs no account, no password and no database.
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

/** `count` attempts in a row, as status codes. */
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
    // The attacker's lever: one vouched address (the BFF resolved it from the ingress
    // chain and it cannot be influenced from outside), a header the caller controls,
    // rotated on every attempt. Before the fix this produced five 400s, because the
    // limiter keyed on the rotating value; now the fourth attempt is refused.
    const statuses = await attempts(ALLOWANCE + 2, (n) => ({
      [CLIENT_ADDRESS_HEADER]: "203.0.113.7",
      "x-forwarded-for": `10.0.0.${String(n)}`,
      "x-real-ip": `10.1.0.${String(n)}`,
    }));
    expect(statuses.slice(0, ALLOWANCE)).toEqual([400, 400, 400]);
    expect(statuses.slice(ALLOWANCE)).toEqual([429, 429]);
  });

  it("still gives two genuinely different clients two allowances", async () => {
    // The over-correction this fix must not be: one shared bucket would make any caller
    // able to lock every admin out of signing in.
    const exhausted = await attempts(ALLOWANCE + 1, () => ({
      [CLIENT_ADDRESS_HEADER]: "198.51.100.1",
    }));
    expect(exhausted.at(-1)).toBe(429);

    const other = await signIn({ [CLIENT_ADDRESS_HEADER]: "198.51.100.2" });
    expect(other).toBe(400);
  });

  it("shares one bucket when nothing was vouched for, rather than handing out one each", async () => {
    // The fail-safe direction, stated so it cannot regress silently: with no address to
    // key on, better-auth uses a single `no-trusted-ip` bucket. Coarse, and the reason
    // `docs/deploy-ingress.md` tells an operator to make the ingress write the header -
    // but never a bucket per request, which is what the forgeable version was.
    const unvouched = await attempts(ALLOWANCE + 1, () => ({}));
    expect(unvouched.at(-1)).toBe(429);

    // A second caller, forging both of the headers better-auth used to read. It lands in
    // the same exhausted bucket: at this process those headers mean nothing at all.
    const forging = await signIn({ "x-forwarded-for": "192.0.2.99", "x-real-ip": "192.0.2.98" });
    expect(forging).toBe(429);
  });
});

/**
 * The `NODE_ENV=production` half of #390's matrix. The `development` half lives in
 * `sign-in-throttle-state.test.ts`, and the two are separate files because better-auth
 * captures `NODE_ENV` once per process and one file cannot be both; that file's header
 * explains the mechanics and carries the case that closes the finding.
 *
 * What this side adds is the direction that is easy to forget: `NODE_ENV=production`
 * must no longer force the throttle **on** either. Before #390 it did, and a
 * configuration asking for it off would have been quietly overruled - which would make
 * `QCMS_ADMIN_SIGNIN_THROTTLE` a knob that reads as authoritative while `NODE_ENV` is
 * still deciding, the same defect one layer up. Both directions under both values of
 * `NODE_ENV` is what makes "`NODE_ENV` decides nothing here" a measured claim.
 */
describe("QCMS_ADMIN_SIGNIN_THROTTLE decides it, under NODE_ENV=production too", () => {
  it("still refuses a fourth attempt when the knob is on", async () => {
    const statuses = await attempts(ALLOWANCE + 1, () => ({
      [CLIENT_ADDRESS_HEADER]: "203.0.113.31",
    }));
    expect(statuses.slice(0, ALLOWANCE)).toEqual([400, 400, 400]);
    expect(statuses.at(-1)).toBe(429);
  });

  it("lets a fifth attempt through when the knob is off, production or not", async () => {
    // The half that proves `NODE_ENV=production` no longer overrules the configuration.
    // A `429` here would mean the vendor's `?? isProduction` branch is still live.
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

/**
 * The ON half of the boot line's agreement test (issue #390, #498). Its OFF half lives
 * in `sign-in-throttle-state.test.ts`.
 */
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
      // A proxy declared, so the issue #482 shared-bucket line has nothing to say and
      // this case still asserts exactly one boot line. Its own coverage is in
      // `sign-in-throttle-state.test.ts`.
      { QCMS_ADMIN_TRUSTED_PROXY_HOPS: "1" },
    );

    // Measured, not assumed: an address no other case in this file uses, one attempt
    // more than the allowance.
    const statuses = await attempts(ALLOWANCE + 1, () => ({
      [CLIENT_ADDRESS_HEADER]: "203.0.113.200",
    }));
    const refused = statuses.includes(429);

    // The agreement, in both directions at once: this fails on a line that claims
    // throttling the limiter is not doing, and on a line that denies throttling it is.
    expect(state.enabled).toBe(refused);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields.enabled).toBe(refused);
    expect(lines[0]?.level).toBe(refused ? "info" : "warn");

    // And the env-specific half, so a stub that stopped taking effect cannot make the
    // case above pass vacuously against a limiter that was never running.
    expect(refused).toBe(true);
  });
});
