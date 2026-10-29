import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACTIONS, ROLE_NAMES } from "../../src/features/membership/policy.js";
import { ROUTE_POLICIES } from "../../src/features/membership/route-policy.js";
import { type MatrixRow, SURFACES } from "./surfaces.js";

const SECURITY_DESIGN = fileURLToPath(
  new URL("../../../../docs/SECURITY_DESIGN.md", import.meta.url),
);

/**
 * Generated from the app's own registrars, so the session-authed route set is derived from
 * the served routes rather than kept as a second hand-written list.
 */
const RESPONDENT_OPENAPI = fileURLToPath(
  new URL("../../../../docs/openapi/respondent.json", import.meta.url),
);

/**
 * Keyed on the document's exact wording, so a reworded row fails the parse assertion below
 * rather than being silently dropped.
 */
const DOCUMENTED_ROWS: Readonly<Record<string, MatrixRow>> = {
  "Start anonymous session": "start-session",
  "Redeem secure link": "redeem-link",
  "Get step / answer / submit": "step-answer-submit",
  "Question/form authoring, publish, release": "authoring",
  "Responses read/export": "responses-read",
  Erasure: "erasure",
  "Links mint/revoke, webhook config": "links-webhooks",
  "Membership, grants and the access audit": "membership",
  "Health/ready": "health",
};

/**
 * `heading` is where to start looking, because section 3.2 carries two tables: the
 * credential-shape matrix and the two role families beneath it.
 */
function parseMatrixActions(markdown: string, heading: string): string[] {
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`SECURITY_DESIGN.md has no ${heading} heading`);
  const lines = markdown.slice(start).split("\n");
  const actions: string[] = [];
  let seenHeader = false;
  for (const line of lines) {
    if (!line.startsWith("|")) {
      if (seenHeader && actions.length > 0) break;
      continue;
    }
    const cells = line.split("|").map((cell) => cell.trim());
    const action = cells[1] ?? "";
    if (action === "Action") {
      seenHeader = true;
      continue;
    }
    if (!seenHeader || action === "" || /^-+$/.test(action)) continue;
    actions.push(action);
  }
  return actions;
}

const securityDesign = readFileSync(SECURITY_DESIGN, "utf8");
const actions = parseMatrixActions(securityDesign, "### 3.2 Authorization matrix");
const roleActions = parseMatrixActions(securityDesign, "#### The two role families");

describe("the §3.2 matrix and the probe inventory stay in step", () => {
  it("parsed a table that looks like the one in the document (the fixture is real)", () => {
    expect(actions.length).toBeGreaterThanOrEqual(8);
    expect(actions).toContain("Start anonymous session");
    expect(actions).toContain("Health/ready");
  });

  it("maps every documented row to a known surface row", () => {
    const unmapped = actions.filter((action) => DOCUMENTED_ROWS[action] === undefined);
    expect(
      unmapped,
      "SECURITY_DESIGN.md §3.2 gained or reworded a row; decide what probes it needs and add it to DOCUMENTED_ROWS and SURFACES",
    ).toEqual([]);
  });

  it("probes at least one representative route for every documented row", () => {
    const probed = new Set<MatrixRow>(SURFACES.map((surface) => surface.row));
    const unprobed = actions
      .map((action) => DOCUMENTED_ROWS[action])
      .filter((row): row is MatrixRow => row !== undefined && !probed.has(row));
    expect(unprobed, "a §3.2 row has no surface in SURFACES, so nothing asserts it").toEqual([]);
  });

  it("has no surface row that the document does not describe", () => {
    const documented = new Set<MatrixRow>(Object.values(DOCUMENTED_ROWS));
    const orphans = [...new Set(SURFACES.map((surface) => surface.row))].filter(
      (row) => !documented.has(row),
    );
    expect(orphans, "SURFACES probes a row §3.2 does not list").toEqual([]);
  });

  it("probes every session-scoped route the API serves (PR #1034, finding 6)", () => {
    // `POST /sessions` itself is listed in `surfaces.ts` under its own row, so the
    // derivation below covers only the routes that take an id in the path.
    const document = JSON.parse(readFileSync(RESPONDENT_OPENAPI, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const VERBS = new Set(["get", "post", "put", "patch", "delete"]);
    const served: string[] = [];
    for (const [path, operations] of Object.entries(document.paths)) {
      if (!path.startsWith("/sessions/{")) continue;
      for (const verb of Object.keys(operations)) {
        if (VERBS.has(verb)) served.push(`${verb.toUpperCase()} ${path}`);
      }
    }
    expect(
      served.length,
      "the document served no session-scoped route, so this proves nothing",
    ).toBeGreaterThan(3);

    // `surfaces.ts` names a path template in `name` and builds the real path in `path`;
    // the template is what compares.
    const probed = new Set(SURFACES.map((surface) => surface.name));
    const unprobed = served.filter((route) => !probed.has(route));
    expect(
      unprobed,
      "a session-scoped route has no entry in SURFACES, so no credential shape is asserted against it",
    ).toEqual([]);
  });

  it("covers every admin slice, so no mounted group escapes the gate probes", () => {
    const adminPaths = SURFACES.filter((surface) => surface.group === "admin").map(
      (surface) => surface.name,
    );
    for (const slice of [
      "/admin/questions",
      "/admin/forms",
      "/admin/erasures",
      "/admin/forms/{id}/links",
      "/admin/forms/{id}/webhooks",
      "/admin/outbox/dead-letters",
      "/admin/workspaces",
      "/admin/environments",
      "/admin/me/access",
      "/admin/workspaces/{id}/members",
      "/admin/workspaces/{id}/access-groups",
      "/admin/forms/{id}/webhooks/proposals",
      // Its own prefix because it is the one admin route a response-only caller can
      // reach: a probe set that lost it would still claim the `/admin/forms` coverage.
      "/admin/operations/forms",
      // The installation-wide release workflow, whose write no grant reaches.
      "/admin/release-workflow",
    ]) {
      expect(
        adminPaths.some((path) => path.includes(slice)),
        `no probe covers ${slice}`,
      ).toBe(true);
    }
  });
});

/**
 * Keyed on the document's exact wording, like `DOCUMENTED_ROWS` above. Several rows differ
 * only by environment, so the mapping is many-to-one.
 */
const DOCUMENTED_ROLE_ROWS: Readonly<Record<string, readonly [string, string]>> = {
  "See drafts, published versions and release history": ["form", "read"],
  "See link and endpoint configuration (viewer: URL query string masked, Q58)": ["link", "read"],
  "Draft and edit questions and forms, pin shared questions, preview": ["form", "write"],
  "Publish a version (releases nowhere)": ["form", "publish"],
  "Release to dev or test": ["release", "create"],
  "Release to prod": ["release", "create"],
  "Approve a prod release under the two-person switch": ["release", "create"],
  "Close or reopen, dev or test": ["form", "close"],
  "Close or reopen, prod": ["form", "close"],
  "Mint or revoke links, dev or test": ["link", "mint"],
  "Mint or revoke links, prod": ["link", "mint"],
  "Configure webhook endpoint, dev or test": ["webhook", "configure"],
  "Configure webhook endpoint, prod": ["webhook", "configure"],
  "View and export responses": ["response", "read"],
  "Erase a response": ["response", "erase"],
  "See the membership list and grants": ["membership", "read"],
  "Manage membership and grants (every write audited; self-grant rule, Q56)": [
    "membership",
    "write",
  ],
  "Workspace settings: two-person switch, archive": ["workspace", "update"],
  "Read the access audit": ["audit", "read"],
  "Create workspaces, mark the shared one, environment settings, user accounts, release-workflow configuration":
    ["workspace", "update"],
  // The one `anyOf` row, so this names its primary cell; the other three cells of the
  // union have their own documented rows above.
  "Discover operational form metadata in an environment": ["form", "read"],
  "Read the release-workflow configuration": ["release", "read"],
  "Read any response anywhere": ["response", "read"],
};

describe("the two role families and the route table stay in step (task 069)", () => {
  it("parsed a table that looks like the one in the document (the fixture is real)", () => {
    expect(roleActions.length).toBeGreaterThanOrEqual(21);
    expect(roleActions).toContain("Read any response anywhere");
    expect(roleActions).toContain("Read the access audit");
  });

  it("maps every documented role row to a (resource, action) the policy declares", () => {
    const unmapped = roleActions.filter((action) => DOCUMENTED_ROLE_ROWS[action] === undefined);
    expect(
      unmapped,
      "the role table gained or reworded a row; decide which (resource, action) it is and add it to DOCUMENTED_ROLE_ROWS",
    ).toEqual([]);
    for (const action of roleActions) {
      const cell = DOCUMENTED_ROLE_ROWS[action];
      if (cell === undefined) continue;
      const [resource, verb] = cell;
      const declared = ACTIONS[resource as keyof typeof ACTIONS] as readonly string[] | undefined;
      expect(declared, `${resource} is not a declared resource`).toBeDefined();
      expect(declared, `${resource}: ${verb} is not a declared action`).toContain(verb);
    }
  });

  it("has a route that performs every documented role row", () => {
    const performed = new Set(ROUTE_POLICIES.map((row) => `${row.resource}:${row.action}`));
    const unserved = roleActions
      .map((action) => DOCUMENTED_ROLE_ROWS[action])
      .filter((cell): cell is readonly [string, string] => cell !== undefined)
      .map(([resource, verb]) => `${resource}:${verb}`)
      .filter((cell) => !performed.has(cell));
    expect([...new Set(unserved)], "a role-table row has no route that performs it").toEqual([]);
  });

  it("gives every role in the document a declaration, and no role a declaration the document lacks", () => {
    const header = securityDesign
      .slice(securityDesign.indexOf("#### The two role families"))
      .split("\n")
      .find((line) => line.startsWith("| Action"));
    expect(header, "the role table has no header row").toBeDefined();
    const columns = (header as string)
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => cell !== "" && cell !== "Action");
    expect(columns).toEqual([...ROLE_NAMES, "installation admin"]);
  });
});
