import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  cellExpressions,
  maskLiteralsAndComments,
  tableCells,
} from "../../components/test-support/jsx-cells.ts";

/**
 * Issue #582: one id rendering and one timestamp rendering, across every admin table.
 *
 * `plan/admin-design-contracts.md` §2 governs both, and both were applied table by table
 * before this file existed - which is how nine tables came to render an id nine ways. The
 * check here is deliberately not a list of those nine. A list is satisfied by the tables
 * that were on someone's mind the day it was written, and the tenth table is the one that
 * gets it wrong.
 *
 * So this reads the repository instead, in the shape `lib/measure.test.ts` uses for the
 * route-to-cap table: enumerate the real thing from the filesystem, then require a property
 * of every member. A new table is covered the moment it is written, and a lane that renders
 * an id its own way fails here rather than at review.
 *
 * ## The property, in one sentence each
 *
 * - **Ids.** No table cell renders an id-shaped value as a CHILD. An id reaches the screen
 *   as a prop of `components/entity-id.tsx`, which is the one place that decides between
 *   §2's prefix-plus-8 for an opaque id and whole for a derived one.
 * - **Timestamps.** No table cell renders an instant-shaped value as a child either, except
 *   through `formatDay` - the bare calendar-day column §2 keeps in UTC, because it has no
 *   clock in its output to name a zone on. Everything else goes through
 *   `components/operator-time.tsx`, which renders the operator's own zone after hydration
 *   and the pinned UTC string before it.
 * - **No second formatting path.** A table file may not reach for a formatter of its own -
 *   `Intl.DateTimeFormat`, `toLocaleString`, or `formatDateTime` called directly - which is
 *   what "one shared formatter, no per-table variants" means when it is a check rather than
 *   a sentence. `operator-time.tsx` is the only caller of the pinned formatter, and
 *   `format.ts` says why that matters: calling it during a server render is how the
 *   hydration mismatch this app avoids by construction comes back.
 *
 * ## What this cannot see, stated rather than implied
 *
 * The scan reads a cell's own JSX, so a cell that delegates to a component in another file
 * is opaque to it. The last block closes that hole from the other side: the markup and the
 * abbreviation each live in exactly one file, so a second renderer cannot appear without
 * copying a class name this file counts.
 */

/**
 * Absolute git path: a bare `git` would trip `sonarjs/no-os-command-from-path`, which is
 * workspace-wide. Probing known locations and failing by name keeps the miss readable.
 */
const GIT_CANDIDATES = ["/usr/bin/git", "/usr/local/bin/git", "/bin/git"];

function gitBinary(): string {
  const found = GIT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`no git binary at any of: ${GIT_CANDIDATES.join(", ")}`);
  }
  return found;
}

const ADMIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The admin's own source files, asked of git rather than walked (issue #629).
 *
 * `next dev` writes a compiled copy of the tree into `.next-dev`, so a directory walk in a
 * checkout that has ever run the browser suite reads build output and reports it as source.
 * `.gitignore` is the repository's one catalogue of what is generated, and
 * `--cached --others --exclude-standard` consults it: tracked files plus new unignored
 * ones, which is "what this repository contains" rather than "what this directory holds".
 * `app/(shell)/table-anchors.test.tsx` carries the long version of that lesson.
 */
function adminSources(): readonly string[] {
  const listed = execFileSync(
    gitBinary(),
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: ADMIN_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return (
    listed
      .split("\0")
      .filter((path) => path.endsWith(".tsx") || path.endsWith(".ts"))
      // Sources, not tests: a `.test.` file and the Playwright specs under `e2e/` both talk
      // about these modules by name, and a test naming a formatter is not a screen using one.
      .filter((path) => !path.includes(".test.") && !path.startsWith("e2e/"))
      .filter((path) => existsSync(join(ADMIN_ROOT, path)))
  );
}

interface TableSource {
  readonly path: string;
  readonly source: string;
  readonly masked: string;
}

/**
 * Every file that renders a table cell, which is this check's definition of "a table".
 *
 * Not a list of screens, and not a list of components: a `<td>` or a `<th>` in the markup
 * is the thing the contract's clauses are about, and a file that has one is in scope
 * wherever it lives. `components/ops/delivery-dashboard.tsx` is why that matters - its rows
 * are a component of their own, in a file with no `<table>` element at all.
 */
function tableSources(): readonly TableSource[] {
  const found: TableSource[] = [];
  for (const path of adminSources()) {
    const source = readFileSync(join(ADMIN_ROOT, path), "utf8");
    const masked = maskLiteralsAndComments(source);
    if (tableCells(masked).length > 0) found.push({ path, source, masked });
  }
  return found;
}

const TABLES = tableSources();

/** A value named like an identifier: `sessionId`, `row.linkId`, `rowId(…)`. */
const ID_SHAPED = /\b[A-Za-z_$][\w$]*(?:Id|ID)\b/;

/** A value named like an instant: `createdAt`, `row.lastAttemptAt`. */
const INSTANT_SHAPED = /\b[A-Za-z_$][\w$]*At\b/;

/**
 * The one instant rendering that is not a timestamp: §2's bare calendar-day column.
 *
 * `formatDay` stays UTC on purpose and is named in the amendment itself. The expression has
 * to BE the call rather than merely contain it, so a sentence that happens to mention a day
 * beside a raw instant is still a finding.
 */
const DAY_COLUMN = /^\s*formatDay\(/;

/** Every value a table's cells render as text, matched masked and reported verbatim. */
function childExpressionsOf(table: TableSource): readonly { masked: string; text: string }[] {
  return tableCells(table.masked)
    .flatMap((cell) => cellExpressions(table.source, table.masked, cell))
    .filter((expression) => expression.isChild && expression.masked.trim() !== "")
    .map((expression) => ({ masked: expression.masked.trim(), text: expression.text.trim() }));
}

describe("the table scan", () => {
  /**
   * A scan that finds nothing passes every assertion below, so the enumeration is shown to
   * work before its verdicts mean anything. Two files are named - one hand-authored table
   * and one whose rows are a component in a file with no `<table>` - and a floor is set, in
   * the shape `lib/measure.test.ts` uses for the same reason.
   */
  it("reaches the tables it is meant to read", () => {
    const paths = TABLES.map((table) => table.path);
    expect(paths).toContain("app/(shell)/forms/forms-table.tsx");
    expect(paths).toContain("components/ops/delivery-dashboard.tsx");
    expect(paths.length).toBeGreaterThanOrEqual(9);
  });

  it("finds the cells inside those files, not just the files", () => {
    const cells = TABLES.reduce((total, table) => total + tableCells(table.masked).length, 0);
    expect(cells).toBeGreaterThanOrEqual(50);
  });

  /**
   * The scanner's own blind spot, asserted so it cannot widen unnoticed: a masked comment
   * or string cannot produce a finding, and a real child expression must. If this ever goes
   * quiet, the two rules below are passing for the wrong reason.
   */
  it("distinguishes a rendered child from an attribute value", () => {
    const source = "<td className={x.formId} data-a={y}>{row.sessionId}</td>";
    const masked = maskLiteralsAndComments(source);
    const [cell] = tableCells(masked);
    expect(cell).toBeDefined();
    const expressions = cellExpressions(source, masked, cell as never);
    expect(expressions.filter((one) => one.isChild).map((one) => one.text)).toEqual([
      "row.sessionId",
    ]);
    // And the same cell's catalog key, which READS like an id and is not one: the match
    // runs against masked text, so a string cannot become a finding.
    const withKey = '<td>{t("ops.responses.column.sessionId")}</td>';
    const keyMasked = maskLiteralsAndComments(withKey);
    const [keyCell] = tableCells(keyMasked);
    const [only] = cellExpressions(withKey, keyMasked, keyCell as never);
    expect(only?.isChild).toBe(true);
    expect(only?.masked).not.toMatch(/sessionId/);
  });
});

describe("every table's identifying cell", () => {
  it("renders an id through the shared component rather than as cell text", () => {
    const offenders = TABLES.flatMap((table) =>
      childExpressionsOf(table)
        .filter((expression) => ID_SHAPED.test(expression.masked))
        .map((expression) => `${table.path}: {${expression.text}}`),
    );
    // `EntityId` takes the value as a PROP, so a compliant cell has no id-shaped child at
    // all and this list is empty by construction rather than by exemption.
    expect(offenders).toEqual([]);
  });
});

describe("every table's timestamp cell", () => {
  it("renders an instant through the shared component, or as §2's UTC day column", () => {
    const offenders = TABLES.flatMap((table) =>
      childExpressionsOf(table)
        .filter(
          (expression) =>
            INSTANT_SHAPED.test(expression.masked) && !DAY_COLUMN.test(expression.masked),
        )
        .map((expression) => `${table.path}: {${expression.text}}`),
    );
    expect(offenders).toEqual([]);
  });

  it("reaches for no formatter of its own", () => {
    // `formatDateTime` is still REFERENCED in one table file, as the default parameter of a
    // helper the §3.7 test calls with a row alone; what is forbidden is calling it, which
    // is what would put a second, un-hydrated formatting path on the screen.
    const forbidden =
      /(?:new\s+Intl\.DateTimeFormat)|(?:\btoLocale(?:Date|Time)?String\s*\()|(?:\bformat(?:Operator)?DateTime\s*\()/;
    const offenders = TABLES.filter((table) => forbidden.test(table.masked)).map(
      (table) => table.path,
    );
    expect(offenders).toEqual([]);
  });

  it("slices no ISO string, which is the formatting path ADR-27 replaced", () => {
    const offenders = TABLES.filter((table) => /\.slice\(0,\s*10\)/.test(table.masked)).map(
      (table) => table.path,
    );
    expect(offenders).toEqual([]);
  });
});

describe("the shared components", () => {
  /**
   * One renderer each, counted across the whole app rather than asserted about one file.
   * This is what bounds the scan's blind spot: a cell can hide an id behind a component
   * boundary, but the component it hides it behind has to render the id somehow, and both
   * ways of doing that are counted here.
   */
  it("are the only place the id markup and the abbreviation live", () => {
    const sources = adminSources().map((path) => ({
      path,
      source: readFileSync(join(ADMIN_ROOT, path), "utf8"),
    }));
    const renderingIds = sources
      .filter((file) => file.source.includes("qcms-entityid__value"))
      .map((file) => file.path);
    expect(renderingIds).toEqual(["components/entity-id.tsx"]);

    const abbreviating = sources
      .filter((file) => file.source.includes("splitEntityId("))
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b));
    expect(abbreviating).toEqual(["components/entity-id.tsx", "lib/entity-id.ts"]);
  });

  it("keep the operator's clock in one module, as issue #279 left it", () => {
    // Every file that names the operator-zone formatter at all, its own module excepted.
    // `operator-time.tsx` does not CALL it - it returns it from a hook, so the call site is
    // the caller's - which is why this counts references rather than invocations, and why
    // the assertion is about who can reach it rather than who runs it.
    const readers = adminSources().filter(
      (path) =>
        path !== "lib/i18n/format.ts" &&
        readFileSync(join(ADMIN_ROOT, path), "utf8").includes("formatOperatorDateTime"),
    );
    expect(readers).toEqual(["components/operator-time.tsx"]);
  });
});
