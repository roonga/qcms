import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HAND_AUTHORED_MARKER, SHIPPED_ENVIRONMENTS, baselineHandAuthoredSql } from "./baseline.js";
import { environmentObjectNames } from "./sql.js";

/**
 * The checked-in baseline and the module that emits it cannot drift.
 *
 * A generator whose output is checked in is a generator nobody has to run - until the
 * day somebody adds a column to the data-plane module, the generator starts producing
 * different SQL, and the baseline still creates the old shape in every environment. The
 * failure is silent, because both halves are individually correct.
 *
 * So the baseline's hand-authored half is compared, byte for byte, against what
 * `baseline.ts` produces now. The fix when this fails is one command:
 *
 *     pnpm --filter @roonga/qcms-db db:emit-baseline
 *
 * The generated half above the marker is `drizzle-kit generate`'s and is not compared
 * here: `migration-chain.test.ts` owns the journal and the snapshot chain, and
 * `migrations.test.ts` owns what the whole file actually builds.
 */

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
    // A cheap floor under the byte comparison above: if somebody replaced the emitter
    // with one that produced an empty string, the comparison would pass against an
    // equally empty file. These are the statements whose absence would be a database
    // with no environments in it at all.
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
    // Q40, finding B. Migration 0021 named `qcms_app` as a literal, and there are now
    // as many application roles as there are environments plus one - a list that goes
    // stale the first time an operator creates an environment. The revoke names the
    // prefix instead, which is why an environment created next year is covered by a
    // migration written today.
    expect(sql).toContain("rolname LIKE 'qcms\\_app%'");
    expect(sql).toContain("control.two_factor_resets");
  });
});
