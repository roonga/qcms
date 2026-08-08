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

vi.stubEnv("NODE_ENV", "production");

beforeAll(async () => {
  const { createAdminAuth } = await import("./instance.js");
  const { unusedDb } = await import("../../test-support.js");
  auth = createAdminAuth({
    db: unusedDb(),
    adminAuth: {
      secret: "x".repeat(40),
      baseUrl: ADMIN_ORIGIN,
      idleMs: 3_600_000,
      secureCookies: true,
    },
  });
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
async function signIn(headers: Record<string, string>): Promise<number> {
  const response = await auth.handler(
    new Request(`${ADMIN_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ADMIN_ORIGIN, ...headers },
      body: JSON.stringify({}),
    }),
  );
  return response.status;
}

/** `count` attempts in a row, as status codes. */
async function attempts(count: number, headers: (n: number) => Record<string, string>) {
  const statuses: number[] = [];
  for (let n = 0; n < count; n += 1) statuses.push(await signIn(headers(n)));
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
