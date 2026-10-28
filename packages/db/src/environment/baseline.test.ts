import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HAND_AUTHORED_MARKER, SHIPPED_ENVIRONMENTS, baselineHandAuthoredSql } from "./baseline.js";
import { environmentObjectNames } from "./sql.js";

const BASELINE = fileURLToPath(
  new URL("../../migrations/0000_environments_baseline.sql", import.meta.url),
);

describe("the baseline's hand-authored half", () => {
  const sql = readFileSync(BASELINE, "utf8");

  it("is exactly what the schema modules emit today", () => {
    const markerStart = sql.indexOf(HAND_AUTHORED_MARKER.split("\n")[0] ?? "");
    expect(markerStart).toBeGreaterThan(0);
    expect(sql.slice(markerStart).trimEnd()).toBe(baselineHandAuthoredSql().trimEnd());
  });

  it("creates every shipped environment's schema, role grants and reporting views", () => {
    for (const environment of SHIPPED_ENVIRONMENTS) {
      const names = environmentObjectNames(environment);
      expect(sql).toContain(`CREATE SCHEMA "${names.schema}";`);
      expect(sql).toContain(`CREATE SCHEMA "${names.reportingSchema}";`);
      expect(sql).toContain(names.role);
      for (const table of names.tables) expect(sql).toContain(`"${names.schema}"."${table}"`);
      for (const guard of names.guards) expect(sql).toContain(guard);
      for (const foreignKey of names.foreignKeys) expect(sql).toContain(foreignKey);
    }
  });

  it("takes `two_factor_resets` back from every `qcms_app%` role, not from one name", () => {
    expect(sql).toContain("rolname LIKE 'qcms\\_app%'");
    expect(sql).toContain("control.two_factor_resets");
  });
});
