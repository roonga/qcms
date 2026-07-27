import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * SEC-1: "no self-registration path exists in any composition" (task 031).
 *
 * This is a structural test, not a request test, and that is the point. The way this
 * requirement gets broken is not by someone writing a registration screen: it is by
 * mounting better-auth's `/api/auth/[...all]` catch-all, which publishes
 * `POST /api/auth/sign-up/email` as a side effect of wanting the sign-in endpoints. So
 * the assertion is about the **route tree**: enumerate every route the app declares and
 * check that none of them is that catch-all, and that no route is named for
 * registration.
 *
 * `signUpEmail` is still called, exactly once, from the first-run bootstrap
 * (`lib/server/bootstrap.ts`) behind a zero-admins guard. That is deliberate and is
 * asserted here too: it must be reachable from the CLI and from nowhere under `app/`,
 * because a route is HTTP-reachable and a CLI is not.
 */

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every route/page file under `app/`, as app-root-relative paths. */
function routeFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      out.push(...routeFiles(full, `${prefix}/${entry}`));
      continue;
    }
    if (/^(route|page)\.tsx?$/.test(entry)) out.push(`${prefix}/${entry}`);
  }
  return out;
}

describe("SEC-1: no self-registration path exists", () => {
  const routes = routeFiles(`${ADMIN_ROOT}app`);

  it("declares a non-trivial route tree", () => {
    expect(routes.length).toBeGreaterThan(8);
  });

  it("mounts no better-auth catch-all handler", () => {
    // `[...all]` is the shape that would publish the whole endpoint set, sign-up
    // included. Any catch-all segment under `app/` is refused, not just that name.
    const catchAlls = routes.filter((r) => r.includes("[..."));
    expect(catchAlls).toEqual([]);
  });

  it("declares no route named for registration", () => {
    const suspicious = routes.filter((r) =>
      /(sign-up|signup|register|registration|invite)/i.test(r),
    );
    expect(suspicious).toEqual([]);
  });

  it("calls signUpEmail only from the first-run bootstrap, never from a route", () => {
    const callers = routes.filter((route) =>
      readFileSync(`${ADMIN_ROOT}app${route}`, "utf8").includes("signUpEmail"),
    );
    expect(callers).toEqual([]);
  });
});
