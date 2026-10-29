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

const ADMIN_OPENAPI = fileURLToPath(
  new URL("../../../../../docs/openapi/admin.json", import.meta.url),
);

const VERBS = new Set(["get", "post", "put", "patch", "delete"]);

// The shipped document is generated with every flag off, so a flag-gated admin route is
// invisible to the derivation below and has to be named here instead.
const FLAG_GATED_ROUTES: readonly string[] = [
  "POST /admin/forms/{id}/draft/assist",
  "POST /admin/forms/{id}/draft/assist/accept",
];

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
    const orphans = ROUTE_POLICIES.map((row) => `${row.method} ${row.path}`).filter(
      (route) => !served.includes(route) && !FLAG_GATED_ROUTES.includes(route),
    );
    expect(orphans, "ROUTE_POLICIES names a route the admin document does not serve").toEqual([]);
  });

  it("has a row for each flag-gated admin route the document cannot show", () => {
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
    // The environment the policy checks must be the one the handler acts in: a row that
    // read the body first and fell back to the switcher would authorise against `test`
    // while a route declaring no body acted in production.
    const document = JSON.parse(readFileSync(ADMIN_OPENAPI, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
    };

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
      // A flag-gated route has no document entry to compare against.
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
      expect(
        row.environmentFrom === "query",
        `${label}: environmentFrom vs its OpenAPI query parameters`,
      ).toBe(declaresEnvironmentQuery(row));
    }
  });

  it("names an environment exactly when one of its cells is environment-scoped", () => {
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

  it("gives the operations row every operational cell, and gives no other row an `anyOf`", () => {
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
    // No audit kind: an aggregate response count is not a SEC-15 read.
    expect(row?.audit).toBeUndefined();
    // The same list the capability projection reads, so the two cannot disagree.
    expect(row?.anyOf).toBe(OPERATIONAL_CELLS);
  });

  it("gives `publish-and-release` both of its cells, and names every row that has two", () => {
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
    const expected: Readonly<Record<string, "read" | "export" | "erasure">> = {
      read: "read",
      export: "export",
      erase: "erasure",
    };
    for (const row of ROUTE_POLICIES) {
      if (row.resource !== "response") continue;
      // These three paths read or write no answer content, so SEC-15 gives them no kind.
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
    // Group create and rename carry no kind: a group with no holders grants nobody
    // anything, so there is nothing yet for an audit row to record.
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
    expect(policyForRequest("GET", "/admin/forms/frm_x/nothing")).toBeUndefined();
  });

  it("prefers the more specific template when two match", () => {
    const row = policyForRequest("GET", "/admin/forms/frm_x/responses/ses_y");
    expect(row?.resource).toBe("response");
    expect(row?.action).toBe("read");
  });

  it("answers undefined for a path with no row, which the middleware refuses", () => {
    expect(policyForRequest("GET", "/admin/not-a-route")).toBeUndefined();
    expect(policyForRequest("DELETE", "/admin/forms")).toBeUndefined();
  });
});
