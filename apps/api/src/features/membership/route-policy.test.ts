import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACTIONS, isEnvironmentScoped, isFormScoped } from "./policy.js";
import { GRANT_EXEMPT_ROUTES, ROUTE_POLICIES, policyForRequest } from "./route-policy.js";

/**
 * Every mounted admin route is a cell of the permissions matrix (task 069, criterion 11).
 *
 * # The loop this closes, and the two lanes that proved it was open
 *
 * `ROUTE_POLICIES` is a hand-kept table, and a hand-kept table drifts. Tasks 065 and 068
 * each added an admin route and each missed the security suite's own inventory, so the
 * route was mounted and no credential shape was asserted against it. The answer is the
 * one `matrix-coverage.e2e.ts` already uses one level up: the route set is **derived**
 * from the shipped OpenAPI document, which is generated from the app's own registrars and
 * guarded for freshness by `openapi-document.test.ts`, so deriving from it is deriving
 * from the routes.
 *
 * A new admin route therefore fails **here**, at a unit test, before it is ever a 403 in
 * production or a missing probe in an e2e suite.
 */

const ADMIN_OPENAPI = fileURLToPath(
  new URL("../../../../../docs/openapi/admin.json", import.meta.url),
);

const VERBS = new Set(["get", "post", "put", "patch", "delete"]);

/** Every admin route the shipped document serves, as `METHOD /path`. */
function servedRoutes(): readonly string[] {
  const document = JSON.parse(readFileSync(ADMIN_OPENAPI, "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const served: string[] = [];
  for (const [path, operations] of Object.entries(document.paths)) {
    if (!path.startsWith("/admin/")) continue;
    for (const verb of Object.keys(operations)) {
      if (VERBS.has(verb)) served.push(`${verb.toUpperCase()} ${path}`);
    }
  }
  return served.sort();
}

describe("the route table and the mounted admin surface stay in step", () => {
  const served = servedRoutes();

  it("read a document that looks like the real one (the fixture is real)", () => {
    // Without this, an empty or failed parse would make every assertion below pass over
    // nothing at all - the failure mode this whole file exists for.
    expect(served.length).toBeGreaterThan(30);
    expect(served).toContain("GET /admin/forms");
    expect(served).toContain("GET /admin/forms/{id}/responses");
  });

  it("has a row for every admin route the API serves", () => {
    const missing = served.filter((route) => {
      if (GRANT_EXEMPT_ROUTES.includes(route)) return false;
      const [method, path] = route.split(" ");
      return policyForRequest(method ?? "", path ?? "") === undefined;
    });
    expect(
      missing,
      "an admin route has no row in ROUTE_POLICIES, so nobody decided who may call it. " +
        "Add the row (and its probe in apps/api/e2e/security/surfaces.ts) in the same change.",
    ).toEqual([]);
  });

  it("has no row for a route the API does not serve", () => {
    // The other direction: an orphan row is a decision about a route that no longer
    // exists, which reads as coverage and is not.
    const orphans = ROUTE_POLICIES.map((row) => `${row.method} ${row.path}`).filter(
      (route) => !served.includes(route),
    );
    expect(orphans, "ROUTE_POLICIES names a route the admin document does not serve").toEqual([]);
  });

  it("exempts exactly two routes from needing a grant, and names both", () => {
    // Both are answers about what the caller holds rather than acts on anything: their own
    // grants (Q35), and the environments those grants reach (Q25). An exemption list is
    // the thing that grows, so the names and the count are both asserted and a third
    // member is a change somebody reviews.
    expect([...GRANT_EXEMPT_ROUTES]).toEqual(["GET /admin/me/access", "GET /admin/environments"]);
  });
});

describe("every row names an action the policy declares", () => {
  it.each(ROUTE_POLICIES.map((row) => [`${row.method} ${row.path}`, row] as const))(
    "%s names a real (resource, action)",
    (_label, row) => {
      const actions: readonly string[] | undefined = ACTIONS[row.resource];
      expect(actions, `${row.resource} is not a declared resource`).toBeDefined();
      expect(actions).toContain(row.action);
    },
  );

  it("agrees with the policy about which acts name an environment", () => {
    // Two places could disagree: a row that forgot `namesEnvironment` on a scoped act
    // would be refused on every request (the policy refuses a scoped act that names no
    // environment), and a row that claimed one on an unscoped act would read as though
    // the environment mattered when nothing narrows by it.
    for (const row of ROUTE_POLICIES) {
      const scoped = isEnvironmentScoped(row.resource, row.action);
      expect(row.namesEnvironment === true, `${row.method} ${row.path}`).toBe(scoped);
    }
  });

  it("agrees with the policy about which acts name a form", () => {
    for (const row of ROUTE_POLICIES) {
      const scoped = isFormScoped(row.resource, row.action);
      expect(row.namesForm === true, `${row.method} ${row.path}`).toBe(scoped);
    }
  });
});

describe("the audit column and the response routes agree (criterion 8)", () => {
  it("marks every response read, export and erasure with its SEC-15 kind", () => {
    // "No path reads or exports without a row" is a property of the route list as much
    // as of the handlers, so it is checkable here: every row whose act is a response read,
    // export or erasure carries the kind its handler writes.
    const expected: Readonly<Record<string, "read" | "export" | "erasure">> = {
      read: "read",
      export: "export",
      erase: "erasure",
    };
    for (const row of ROUTE_POLICIES) {
      if (row.resource !== "response") continue;
      // The unflag and the tombstone list are the two `response` rows that are neither a
      // read nor an export of answer content: SEC-15's kinds are closed, and a sixth was
      // added for a setting rather than for a flag release.
      if (row.path.endsWith("/unflag") || row.path === "/admin/erasures") {
        expect(row.audit).toBeUndefined();
        continue;
      }
      expect(row.audit, `${row.method} ${row.path}`).toBe(expected[row.action]);
    }
  });

  it("marks every grant and revoke route with its kind (criterion 19)", () => {
    const grantRoutes = ROUTE_POLICIES.filter(
      (row) => row.resource === "membership" && row.action === "write",
    );
    // Every write on a membership either grants, revokes, or is the create/rename of an
    // access group, which grants nobody anything until a holder is added: a group with no
    // holders carries no grant, so there is nothing for an audit row to record yet.
    expect(grantRoutes.length).toBeGreaterThan(4);
    const kinds = new Set(grantRoutes.map((row) => row.audit));
    expect(kinds.has("grant")).toBe(true);
    expect(kinds.has("revoke")).toBe(true);
  });

  it("marks the workspace settings route as the `setting` kind (criterion 22)", () => {
    const row = policyForRequest("PUT", "/admin/workspaces/org_x/settings");
    expect(row?.audit).toBe("setting");
  });
});

describe("matching a request to a row", () => {
  it("matches a placeholder against exactly one segment", () => {
    expect(policyForRequest("GET", "/admin/forms/frm_x")?.action).toBe("read");
    // Not a route: `/admin/forms/{id}` has three segments and this has four.
    expect(policyForRequest("GET", "/admin/forms/frm_x/nothing")).toBeUndefined();
  });

  it("prefers the more specific template when two match", () => {
    // `/admin/forms/{id}/responses/{sessionId}` and `/admin/forms/{id}/export` are
    // different shapes, but a literal segment has to win over a placeholder wherever two
    // rows could match one request.
    const row = policyForRequest("GET", "/admin/forms/frm_x/responses/ses_y");
    expect(row?.resource).toBe("response");
    expect(row?.action).toBe("read");
  });

  it("answers undefined for a path with no row, which the middleware refuses", () => {
    expect(policyForRequest("GET", "/admin/not-a-route")).toBeUndefined();
    expect(policyForRequest("DELETE", "/admin/forms")).toBeUndefined();
  });
});
