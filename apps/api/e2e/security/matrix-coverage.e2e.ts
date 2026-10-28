/**
 * Coverage guard: every row of the SEC-3 matrix is actually probed (task 040).
 *
 * `surfaces.ts` originally carried a comment claiming this file existed. It did
 * not. That is the exact defect the security suite exists to catch, one level
 * up: an assertion about a check, with no check behind it. The honest repairs
 * were to delete the claim or to write the file, and writing it is strictly
 * better, because the gap the comment papered over is real.
 *
 * The gap: the suites walk `SURFACES` with `it.each`, so anything **added** to
 * that array is genuinely probed under every credential shape. Nothing tied the
 * array back to `docs/SECURITY_DESIGN.md` §3.2. A row added to the document, or
 * a row silently dropped from the array, would leave the suite passing over a
 * cell nobody tests, and the count of green tests would go on looking reassuring.
 *
 * So this file reads the shipped document, parses the §3.2 table, and closes the
 * loop in both directions. It needs no database and boots nothing; it lives here
 * rather than under `src/` because it is evidence about this suite.
 */

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
 * The shipped respondent OpenAPI document, which enumerates every route this API serves
 * on the respondent channel.
 *
 * Read so the session-authed route set can be DERIVED rather than listed a second time
 * (PR #1034, finding 6). Until this existed, `SURFACES` was a hand-kept list and the loop
 * closed only against the §3.2 table: task 073 added two session-authed writes,
 * `/answers/batch` and `/roster`, and the whole matrix suite stayed green over both. The
 * document is generated from the app's own registrars and guarded for freshness by
 * `src/openapi-document.test.ts`, so deriving from it is deriving from the routes.
 */
const RESPONDENT_OPENAPI = fileURLToPath(
  new URL("../../../../docs/openapi/respondent.json", import.meta.url),
);

/**
 * The §3.2 Action column, verbatim, mapped to the `MatrixRow` that represents it.
 *
 * Keyed on the document's exact wording on purpose. Reword a row and this map
 * stops matching, which fails the parse assertion below rather than silently
 * dropping the row: a human then decides whether the rename was cosmetic or
 * whether the surface inventory needs to change with it.
 */
const DOCUMENTED_ROWS: Readonly<Record<string, MatrixRow>> = {
  "Start anonymous session": "start-session",
  "Redeem secure link": "redeem-link",
  "Get step / answer / submit": "step-answer-submit",
  "Question/form authoring, publish, release": "authoring",
  "Responses read/export": "responses-read",
  Erasure: "erasure",
  "Links mint/revoke, webhook config": "links-webhooks",
  // Task 069's rows. The credential table gains one Action row covering the membership
  // surface, because what that table is about is credential shapes and every route on
  // that surface has the same answer in every one of its columns: an admin session and
  // nothing less. Who may then call which route is the role table below it.
  "Membership, grants and the access audit": "membership",
  "Health/ready": "health",
};

/**
 * Pull the Action cell of every data row of one table out of the shipped document.
 *
 * Deliberately not a markdown library: the table is a fixed shape and a hand parser fails
 * loudly when that changes, which is the desired behaviour.
 *
 * `heading` is where to start looking, because section 3.2 carries **two** tables since
 * task 069: the credential-shape matrix this file has always walked, and the two role
 * families beneath it. They are two tables rather than one because the dimensions are
 * different - one is about what a caller presents and the other about what they were
 * granted - and a single table would have carried empty cells meaning "not applicable"
 * in a document where an empty cell means **no**.
 */
function parseMatrixActions(markdown: string, heading: string): string[] {
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`SECURITY_DESIGN.md has no ${heading} heading`);
  const lines = markdown.slice(start).split("\n");
  const actions: string[] = [];
  let seenHeader = false;
  for (const line of lines) {
    if (!line.startsWith("|")) {
      // The table ends at the first non-table line after it has begun.
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
    // Without this, an empty or failed parse would make every assertion below
    // pass over nothing at all - the failure mode this whole file exists for.
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
    // The other direction: an orphan row means the inventory drifted away from
    // the design, which is a documentation defect rather than a coverage one.
    const documented = new Set<MatrixRow>(Object.values(DOCUMENTED_ROWS));
    const orphans = [...new Set(SURFACES.map((surface) => surface.row))].filter(
      (row) => !documented.has(row),
    );
    expect(orphans, "SURFACES probes a row §3.2 does not list").toEqual([]);
  });

  it("probes every session-scoped route the API serves (PR #1034, finding 6)", () => {
    // Derived from the shipped document, so a new `/sessions/...` route is a red gate
    // until the matrix says what it does under every credential shape. `POST /sessions`
    // itself is the anonymous session create, which `surfaces.ts` lists under its own row,
    // so the derivation covers the ones that take an id in the path.
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
    // the template is what compares, and `{id}` is the document's spelling of it.
    const probed = new Set(SURFACES.map((surface) => surface.name));
    const unprobed = served.filter((route) => !probed.has(route));
    expect(
      unprobed,
      "a session-scoped route has no entry in SURFACES, so no credential shape is asserted against it",
    ).toEqual([]);
  });

  it("covers every admin slice, so no mounted group escapes the gate probes", () => {
    // Cheap structural backstop: each admin route group must contribute at
    // least one probed path, named by its prefix.
    const adminPaths = SURFACES.filter((surface) => surface.group === "admin").map(
      (surface) => surface.name,
    );
    for (const slice of [
      "/admin/questions",
      "/admin/forms",
      "/admin/erasures",
      // #478 moved revoke under the form, so the links slice is form-scoped
      // throughout and its prefix carries the form segment.
      "/admin/forms/{id}/links",
      "/admin/forms/{id}/webhooks",
      "/admin/outbox/dead-letters",
      // The workspace slice (ADR-41, task 068). Its own prefix, because none of the
      // entries above would cover it: a workspace is addressed under `/admin/workspaces`
      // and the two ownership moves hang off the form and question collections.
      "/admin/workspaces",
      // The live environment set (ADR-40, task 065), for the same reason: it hangs off no
      // form, so `/admin/forms` would not cover it and the slice could lose its probe
      // without this backstop noticing. Added by task 066, which found the gap.
      "/admin/environments",
      // The membership slice (ADR-41, task 069). Three prefixes rather than one, because
      // the slice is three things a gate could be forgotten on independently: the
      // caller's own grants, the member rows, and the access groups with their holders.
      "/admin/me/access",
      "/admin/workspaces/{id}/members",
      "/admin/workspaces/{id}/access-groups",
      // The pending `prod` endpoint change (Q30, Q51; task 070). Its own prefix even
      // though `/admin/forms/{id}/webhooks` above matches it as a substring, because it is
      // a gate somebody could forget independently of the endpoint routes: these three are
      // the two-person rule's own surface, and a probe set that lost them would still cover
      // the endpoint slice and claim the same coverage.
      "/admin/forms/{id}/webhooks/proposals",
      // Operations discovery (Q87, issue #1174). Its own prefix because it is the one
      // admin route a response-only caller can reach at all: a probe set that lost it
      // would still cover `/admin/forms` and claim the same coverage, while the route
      // that exists precisely for the callers `/admin/forms` refuses went unasserted.
      "/admin/operations/forms",
    ]) {
      expect(
        adminPaths.some((path) => path.includes(slice)),
        `no probe covers ${slice}`,
      ).toBe(true);
    }
  });
});

/**
 * The role table's rows, mapped to the (resource, action) the route table says they are.
 *
 * Keyed on the document's exact wording, like `DOCUMENTED_ROWS` above and for the same
 * reason: reword a row and this map stops matching, which fails the parse assertion
 * rather than silently dropping the row.
 *
 * Several rows differ only by environment - "Release to dev or test" and "Release to
 * prod" are one `release: create` cell split by the production rule - so the mapping is
 * many-to-one and the assertion is that every documented row has a route that performs
 * it, not that every row is its own route.
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
  // Issue #1174's row (Q87). Its route is the one `anyOf` row, so the cell named here is
  // that row's **primary** cell: this map is many-to-one by design, and the assertion
  // below is that a route performs the documented act rather than that the act is one
  // cell. The other three cells of the union have their own documented rows above.
  "Discover operational form metadata in an environment": ["form", "read"],
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
    // The other direction from `route-policy.test.ts`, which asserts every route has a
    // row: this asserts every row of the document has a route. A documented act nothing
    // serves is a promise with no surface behind it.
    const performed = new Set(ROUTE_POLICIES.map((row) => `${row.resource}:${row.action}`));
    const unserved = roleActions
      .map((action) => DOCUMENTED_ROLE_ROWS[action])
      .filter((cell): cell is readonly [string, string] => cell !== undefined)
      .map(([resource, verb]) => `${resource}:${verb}`)
      .filter((cell) => !performed.has(cell));
    expect([...new Set(unserved)], "a role-table row has no route that performs it").toEqual([]);
  });

  it("gives every role in the document a declaration, and no role a declaration the document lacks", () => {
    // The columns, not the rows. A seventh role in the code with no column here would be
    // a role nobody could look up; a column with no declaration would be a promise.
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
