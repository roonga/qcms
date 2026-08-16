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

import { type MatrixRow, SURFACES } from "./surfaces.js";

const SECURITY_DESIGN = fileURLToPath(
  new URL("../../../../docs/SECURITY_DESIGN.md", import.meta.url),
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
  "Question/form authoring, publish": "authoring",
  "Responses read/export": "responses-read",
  Erasure: "erasure",
  "Links mint/revoke, webhook config": "links-webhooks",
  "Health/ready": "health",
};

/**
 * Pull the Action cell of every data row in the §3.2 table out of the shipped
 * document. Deliberately not a markdown library: the table is a fixed shape and
 * a hand parser fails loudly when that changes, which is the desired behaviour.
 */
function parseMatrixActions(markdown: string): string[] {
  const start = markdown.indexOf("### 3.2 Authorization matrix");
  if (start === -1) throw new Error("SECURITY_DESIGN.md has no section 3.2 heading");
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

const actions = parseMatrixActions(readFileSync(SECURITY_DESIGN, "utf8"));

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
      "/admin/links",
      "/admin/forms/{id}/webhooks",
      "/admin/outbox/dead-letters",
    ]) {
      expect(
        adminPaths.some((path) => path.includes(slice)),
        `no probe covers ${slice}`,
      ).toBe(true);
    }
  });
});
