import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACTIONS, isEnvironmentScoped, isFormScoped } from "./policy.js";
import {
  GRANT_EXEMPT_ROUTES,
  OPERATIONAL_CELLS,
  ROUTE_POLICIES,
  policyForRequest,
} from "./route-policy.js";

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

/**
 * Admin routes that exist but are **absent from the shipped document**, with the reason.
 *
 * The derivation below is only as complete as that document, and the document is
 * generated with every flag off (`openapi-document.ts`), so a flag-gated route is invisible
 * to it. Task 041's two agent-authoring routes are mounted when
 * `QCMS_FLAG_AGENT_AUTHORING` is on and absent from the document by design, which is why
 * they had no row at all until the runtime refusal of PR #1061's S2 fix turned their
 * absence into a 403 in their own suite.
 *
 * So they are named here: the orphan check skips them and the case below asserts each one
 * has a row with the cells its route declares. A future flag-gated admin route has to be
 * added to this list, and that is the point - the list is short, explicit, and read by a
 * test rather than remembered.
 */
const FLAG_GATED_ROUTES: readonly string[] = [
  "POST /admin/forms/{id}/draft/assist",
  "POST /admin/forms/{id}/draft/assist/accept",
];

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
      (route) => !served.includes(route) && !FLAG_GATED_ROUTES.includes(route),
    );
    expect(orphans, "ROUTE_POLICIES names a route the admin document does not serve").toEqual([]);
  });

  it("has a row for each flag-gated admin route the document cannot show", () => {
    // The derivation's blind spot, closed by naming it. Both routes are agent authoring,
    // and their cells are the scopes the routes themselves declare: `forms:write` for a
    // turn, and `forms:write` with `questions:write` for an accept, which materialises
    // the proposal's new questions as drafts.
    for (const route of FLAG_GATED_ROUTES) {
      const [method, path] = route.split(" ");
      expect(
        policyForRequest(method ?? "", path ?? ""),
        `${route} is mounted behind a flag and has no row, so with the flag on nobody ` +
          "decided who may call it",
      ).toBeDefined();
    }
    const accept = policyForRequest("POST", "/admin/forms/frm_x/draft/assist/accept");
    expect(accept?.resource).toBe("form");
    expect(accept?.action).toBe("write");
    expect(accept?.also).toEqual({ resource: "question", action: "write" });
    expect(accept?.namesEnvironment).toBeUndefined();
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

  it("declares where every environment-naming row takes its environment from", () => {
    // **The rule PR #1061's review broke with a probe**: the environment the policy
    // checks is exactly the environment the handler acts in. A row says which source it
    // reads, and this compares that claim against the **shipped document** rather than
    // against a list somebody typed: a `"body"` row's declared request body carries
    // `environment`, and a `"switcher"` row's either declares no body or declares one
    // without it.
    //
    // Four routes are the reason: link revoke, webhook delete, redeliver and unflag
    // declare no body at all, and `@hono/zod-openapi` validates only what a route
    // declares - so the first version, which read the body first and fell back to the
    // switcher, authorised a `test`-scoped editor against `test` while the handler
    // revoked a **production** link.
    const document = JSON.parse(readFileSync(ADMIN_OPENAPI, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
    };

    /** Whether this route's declared JSON request body carries an `environment` field. */
    const declaresEnvironment = (row: (typeof ROUTE_POLICIES)[number]): boolean => {
      const operation = document.paths[row.path]?.[row.method.toLowerCase()] as
        | {
            requestBody?: {
              content?: {
                "application/json"?: {
                  schema?: { $ref?: string; properties?: Record<string, unknown> };
                };
              };
            };
          }
        | undefined;
      const schema = operation?.requestBody?.content?.["application/json"]?.schema;
      if (schema === undefined) return false;
      const resolved =
        schema.$ref === undefined
          ? schema
          : document.components?.schemas?.[schema.$ref.split("/").pop() ?? ""];
      return resolved?.properties !== undefined && "environment" in resolved.properties;
    };

    /** Whether this route declares a required `environment` **query** parameter (Q87). */
    const declaresEnvironmentQuery = (row: (typeof ROUTE_POLICIES)[number]): boolean => {
      const operation = document.paths[row.path]?.[row.method.toLowerCase()] as
        { parameters?: { name?: string; in?: string; required?: boolean }[] } | undefined;
      return (
        operation?.parameters?.some(
          (parameter) =>
            parameter.name === "environment" &&
            parameter.in === "query" &&
            parameter.required === true,
        ) === true
      );
    };

    for (const row of ROUTE_POLICIES) {
      const label = `${row.method} ${row.path}`;
      // A flag-gated route has no entry to compare against; neither of the two names an
      // environment, which the case above asserts for the one that could.
      if (FLAG_GATED_ROUTES.includes(label)) {
        expect(row.namesEnvironment, `${label} is flag-gated`).toBeUndefined();
        continue;
      }
      if (row.namesEnvironment !== true) {
        expect(row.environmentFrom, `${label} names no environment`).toBeUndefined();
        continue;
      }
      expect(
        row.environmentFrom,
        `${label} must say where its environment comes from`,
      ).toBeDefined();
      expect(row.environmentFrom === "body", `${label}: environmentFrom vs its OpenAPI body`).toBe(
        declaresEnvironment(row),
      );
      // The third source (Q87): a `"query"` row declares a **required** `environment`
      // query parameter, which is the one the middleware reads and the one the handler
      // reads. A row claiming `"query"` without declaring it would be a gate reading a
      // parameter nothing validates, which is the shape of the defect this case exists
      // for one source over.
      expect(
        row.environmentFrom === "query",
        `${label}: environmentFrom vs its OpenAPI query parameters`,
      ).toBe(declaresEnvironmentQuery(row));
    }
  });

  it("names an environment exactly when one of its cells is environment-scoped", () => {
    // `publish-and-release` is why this is "one of its cells" rather than "its cell": its
    // primary act is `form: publish`, which is environment-agnostic because publishing
    // releases a version nowhere, and its `also` act is `release: create`, which is not.
    // The Operations row is the second reason and the same shape one dimension over: its
    // primary cell is `form: read`, which is workspace-wide, and three of its `anyOf`
    // cells are response acts, which are not.
    for (const row of ROUTE_POLICIES) {
      const cells = [
        { resource: row.resource, action: row.action },
        ...(row.also === undefined ? [] : [row.also]),
        ...(row.anyOf ?? []),
      ];
      const scoped = cells.some((cell) => isEnvironmentScoped(cell.resource, cell.action));
      expect(row.namesEnvironment === true, `${row.method} ${row.path}`).toBe(scoped);
    }
  });

  it("gives the Operations row every operational cell, and gives no other row an `anyOf`", () => {
    // D3 (Q87): the union of the four operational cells, admitted by a row shape that
    // exists for this one screen. A second `anyOf` row is a decision somebody should
    // argue for, so the count and the names are both asserted - the same shape the
    // two-cell rows above are held to.
    const withAnyOf = ROUTE_POLICIES.filter((row) => row.anyOf !== undefined);
    expect(withAnyOf.map((row) => `${row.method} ${row.path}`)).toEqual([
      "GET /admin/operations/forms",
    ]);
    const row = policyForRequest("GET", "/admin/operations/forms");
    expect(row?.resource).toBe("form");
    expect(row?.action).toBe("read");
    expect(row?.workspace).toBe("caller");
    expect(row?.environmentFrom).toBe("query");
    expect(row?.anyOf?.map((cell) => `${cell.resource}:${cell.action}`)).toEqual([
      "form:read",
      "response:read",
      "response:erase",
      "response:dispose",
    ]);
    // **No SEC-15 kind**, which is F4 (Q91) rather than an omission: an aggregate
    // response count is not a read of anybody's answers and writes no row.
    expect(row?.audit).toBeUndefined();
    // The row's `anyOf` is the same list the capability projection reads, so the
    // navigation contract and the route cannot disagree about who has an Operations area.
    expect(row?.anyOf).toBe(OPERATIONAL_CELLS);
  });

  it("gives `publish-and-release` both of its cells, and names every row that has two", () => {
    // F2's convenience is two acts, and the review found the release half unasked: the
    // row said the handler would ask for it and the handler never did, so a
    // `test`-scoped editor reached a production release. Two routes are two acts and
    // both say so on the row; a third would be a route somebody should argue for.
    const withSecond = ROUTE_POLICIES.filter((row) => row.also !== undefined);
    expect([...withSecond.map((row) => `${row.method} ${row.path}`)].sort()).toEqual([
      "POST /admin/forms/{id}/draft/assist/accept",
      "POST /admin/forms/{id}/publish-and-release",
    ]);
    const combined = policyForRequest("POST", "/admin/forms/frm_x/publish-and-release");
    expect(combined?.resource).toBe("form");
    expect(combined?.action).toBe("publish");
    expect(combined?.also).toEqual({ resource: "release", action: "create" });
    expect(combined?.environmentFrom).toBe("body");
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
      // Three `response` rows are neither a read nor an export of answer content, and all
      // three write no audit row: SEC-15's kinds are closed, and the sixth was added for a
      // setting rather than for any of these.
      //
      //  - **unflag** is a disposition on a response rather than a read of one.
      //  - **the tombstone list** carries existence without content (ADR-17).
      //  - **the erasure scope** (Q7, task 067) answers whether a session id exists in a
      //    form in another environment, which is the same existence-without-content the
      //    tombstone list reads. It is the eraser's cell because asking where else an
      //    erasure would have to be repeated is part of performing one, and a row here
      //    would make the audit of who looked at whose answers noisier without recording
      //    a single additional look.
      if (
        row.path.endsWith("/unflag") ||
        row.path.endsWith("/erasure-scope") ||
        row.path === "/admin/erasures"
      ) {
        expect(row.audit, `${row.method} ${row.path}`).toBeUndefined();
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
