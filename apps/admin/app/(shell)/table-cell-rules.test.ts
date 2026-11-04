import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { gitBinary } from "../../components/test-support/git-binary.ts";
import {
  cellExpressions,
  maskLiteralsAndComments,
  tableCells,
} from "../../components/test-support/jsx-cells.ts";

const ADMIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function adminSources(): readonly string[] {
  const listed = execFileSync(
    gitBinary(),
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: ADMIN_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return listed
    .split("\0")
    .filter((path) => path.endsWith(".tsx") || path.endsWith(".ts"))
    .filter((path) => !path.includes(".test.") && !path.startsWith("e2e/"))
    .filter((path) => existsSync(join(ADMIN_ROOT, path)));
}

interface TableSource {
  readonly path: string;
  readonly source: string;
  readonly masked: string;
}

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

const ID_SHAPED = /\b[A-Za-z_$][\w$]*(?:Id|ID)\b/;

const INSTANT_SHAPED = /\b[A-Za-z_$][\w$]*At\b/;

function childExpressionsOf(table: TableSource): readonly { masked: string; text: string }[] {
  return tableCells(table.masked)
    .flatMap((cell) => cellExpressions(table.source, table.masked, cell))
    .filter((expression) => expression.isChild && expression.masked.trim() !== "")
    .map((expression) => ({ masked: expression.masked.trim(), text: expression.text.trim() }));
}

describe("the table scan", () => {
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

  it("distinguishes a rendered child from an attribute value", () => {
    const source = "<td className={x.formId} data-a={y}>{row.sessionId}</td>";
    const masked = maskLiteralsAndComments(source);
    const [cell] = tableCells(masked);
    expect(cell).toBeDefined();
    const expressions = cellExpressions(source, masked, cell as never);
    expect(expressions.filter((one) => one.isChild).map((one) => one.text)).toEqual([
      "row.sessionId",
    ]);
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
    expect(offenders).toEqual([]);
  });
});

describe("every table's timestamp and day cells", () => {
  it("renders an instant through the shared components and never as cell text", () => {
    const offenders = TABLES.flatMap((table) =>
      childExpressionsOf(table)
        .filter((expression) => INSTANT_SHAPED.test(expression.masked))
        .map((expression) => `${table.path}: {${expression.text}}`),
    );
    expect(offenders).toEqual([]);
  });

  it("reaches for no formatter of its own, day formatters included", () => {
    const forbidden =
      /(?:new\s+Intl\.DateTimeFormat)|(?:\btoLocale(?:Date|Time)?String\s*\()|(?:\bformat(?:Operator)?(?:DateTime|Day)\s*\()/;
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

  it("keep the operator's clock in one module (issue #279, Code Owner 2026-10-19)", () => {
    const readers = adminSources().filter((path) =>
      /resolvedOptions\(\)\.timeZone/.test(readFileSync(join(ADMIN_ROOT, path), "utf8")),
    );
    expect(readers).toEqual(["components/operator-time.tsx"]);
  });
});
