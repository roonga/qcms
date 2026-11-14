import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACTIONS, isEnvironmentScoped, readsOneEnvironment } from "./policy.js";
import {
  AGENT_SCREEN_CELLS,
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
  "POST /admin/assist",
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
    expect(accept?.also).toEqual([{ resource: "question", action: "write" }]);
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
      // A flag-gated route has no document entry to compare against, so the only source
      // it may name is the switcher's header, which no document would show either.
      if (FLAG_GATED_ROUTES.includes(label)) {
        if (row.namesEnvironment === true) {
          expect(row.environmentFrom, `${label} is flag-gated`).toBe("switcher");
        } else {
          expect(row.environmentFrom, `${label} names no environment`).toBeUndefined();
        }
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

  it("names an environment exactly when a cell it decides is environment-scoped or one environment's rows", () => {
    // An `anyOf` union is admitted as statements, never judged against an environment, so
    // it is deliberately not part of this test: the handler narrows per environment.
    for (const row of ROUTE_POLICIES) {
      const cells = [{ resource: row.resource, action: row.action }, ...(row.also ?? [])];
      const scoped = cells.some(
        (cell) =>
          isEnvironmentScoped(cell.resource, cell.action) ||
          (row.installationOnly !== true && readsOneEnvironment(cell.resource, cell.action)),
      );
      const decidesPerEnvironment = row.anyOf !== undefined && row.environmentFrom !== undefined;
      expect(row.namesEnvironment === true, `${row.method} ${row.path}`).toBe(
        scoped || decidesPerEnvironment,
      );
    }
  });

  it("puts every grant holder on the workspace list and names no environment (criterion 26)", () => {
    const list = policyForRequest("GET", "/admin/workspaces");
    expect(list?.workspace).toBe("caller");
    expect(list?.namesEnvironment).toBeUndefined();
    expect(list?.anyOf?.map((cell) => `${cell.resource}:${cell.action}`)).toEqual([
      "workspace:read",
      "form:read",
      "response:read",
      "response:erase",
    ]);
  });

  it("gives the list, operations and agent rows their cell unions, and no other row an `anyOf`", () => {
    const withAnyOf = ROUTE_POLICIES.filter((row) => row.anyOf !== undefined);
    expect([...withAnyOf.map((row) => `${row.method} ${row.path}`)].sort()).toEqual([
      "GET /admin/operations/forms",
      "GET /admin/workspaces",
      "POST /admin/assist",
    ]);
    // The agent row serves every screen, so its union is the screens' own first cells and
    // the screen's own cell is checked by its context builder.
    const agent = policyForRequest("POST", "/admin/assist");
    expect(agent?.anyOf).toBe(AGENT_SCREEN_CELLS);
    expect(agent?.workspace).toBe("caller");
    expect(agent?.environmentFrom).toBe("switcher");
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
    // Aggregate response counts do not read answer content and therefore write no response-read audit row.
    expect(row?.audit).toBeUndefined();
    // The same list the capability projection reads, so the two cannot disagree.
    expect(row?.anyOf).toBe(OPERATIONAL_CELLS);
  });

  it("evaluates every batch route's cell per destination, and names every row that does", () => {
    const perTarget = ROUTE_POLICIES.filter((row) => row.environmentFrom === "targets");
    expect([...perTarget.map((row) => `${row.method} ${row.path}`)].sort()).toEqual([
      "POST /admin/forms/{id}/publish-batch",
      "POST /admin/forms/{id}/release-batch",
    ]);
    // Each declares a `targets` array and no `environment` of its own, so the gate reads
    // exactly the list the handler acts on.
    const document = JSON.parse(readFileSync(ADMIN_OPENAPI, "utf8")) as {
      paths: Record<string, Record<string, { requestBody?: unknown }>>;
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
    };
    for (const row of perTarget) {
      const operation = document.paths[row.path]?.[row.method.toLowerCase()] as {
        requestBody?: { content?: { "application/json"?: { schema?: { $ref?: string } } } };
      };
      const ref = operation.requestBody?.content?.["application/json"]?.schema?.$ref ?? "";
      const schema = document.components?.schemas?.[ref.split("/").pop() ?? ""];
      expect(Object.keys(schema?.properties ?? {}), `${row.method} ${row.path}`).toContain(
        "targets",
      );
      expect(Object.keys(schema?.properties ?? {})).not.toContain("environment");
    }
    // The release half is environment-scoped on both, which is what makes the per-target
    // evaluation the thing that authorises a destination.
    const release = policyForRequest("POST", "/admin/forms/frm_x/release-batch");
    expect(release?.resource).toBe("release");
    expect(release?.action).toBe("create");
    const publish = policyForRequest("POST", "/admin/forms/frm_x/publish-batch");
    expect(publish?.resource).toBe("form");
    expect(publish?.action).toBe("publish");
    expect(publish?.also).toEqual([
      { resource: "form", action: "write" },
      { resource: "release", action: "create" },
    ]);
  });

  it("keeps the release-workflow write out of every grant's reach and its read in three", () => {
    const write = policyForRequest("PUT", "/admin/release-workflow");
    expect(write?.installationOnly).toBe(true);
    expect(write?.workspace).toBe("installation");

    expect(write?.resource).toBe("workspace");
    expect(write?.action).toBe("update");
    expect(write?.audit).toBe("setting");
    const read = policyForRequest("GET", "/admin/release-workflow");
    expect(read?.resource).toBe("release");
    expect(read?.action).toBe("read");
    expect(read?.workspace).toBe("caller");
    expect(read?.installationOnly).toBeUndefined();
  });

  it("names exactly five installation-only rows", () => {
    expect(
      ROUTE_POLICIES.filter((row) => row.installationOnly === true).map(
        (row) => `${row.method} ${row.path}`,
      ),
    ).toEqual([
      "POST /admin/workspaces",
      "PUT /admin/workspaces/{id}/shared",
      "PUT /admin/release-workflow",
      "GET /admin/outbox/dead-letters",
      "GET /admin/erasures",
    ]);
  });

  it("names every row that takes more than one cell, and spells out the publish rows", () => {
    const withSecond = ROUTE_POLICIES.filter((row) => row.also !== undefined);
    expect([...withSecond.map((row) => `${row.method} ${row.path}`)].sort()).toEqual([
      "POST /admin/forms/{id}/draft/assist/accept",
      "POST /admin/forms/{id}/publish",
      "POST /admin/forms/{id}/publish-and-release",
      "POST /admin/forms/{id}/publish-batch",
      "POST /admin/forms/{id}/workspace",
    ]);
    const combined = policyForRequest("POST", "/admin/forms/frm_x/publish-and-release");
    expect(combined?.resource).toBe("form");
    expect(combined?.action).toBe("publish");
    expect(combined?.also).toEqual([
      { resource: "form", action: "write" },
      { resource: "release", action: "create" },
    ]);
    expect(combined?.environmentFrom).toBe("body");
  });

  it("takes Edit forms as well as Publish forms to freeze a version (criterion 4)", () => {
    const freeze = policyForRequest("POST", "/admin/forms/frm_x/publish");
    expect(freeze?.resource).toBe("form");
    expect(freeze?.action).toBe("publish");
    expect(freeze?.also).toEqual([{ resource: "form", action: "write" }]);
  });

  it("no longer moves a question between workspaces (criterion 107)", () => {
    expect(policyForRequest("POST", "/admin/questions/q_x/workspace")).toBeUndefined();
  });

  it("takes Edit forms and a Workspace administrator to move a form", () => {
    const move = policyForRequest("POST", "/admin/forms/frm_x/workspace");
    expect(move?.resource).toBe("form");
    expect(move?.action).toBe("write");
    expect(move?.also).toEqual([{ resource: "workspace", action: "update" }]);
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
      // These paths read or write no answer content, so they carry no response audit kind.
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

  it("gives the rename route the workspace administrator's cell, in the named workspace (criterion 97)", () => {
    const row = policyForRequest("PUT", "/admin/workspaces/org_x/name");
    expect(row).toMatchObject({
      resource: "workspace",
      action: "update",
      workspace: "path",
      audit: "setting",
    });
    expect(row?.installationOnly).toBeUndefined();
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
