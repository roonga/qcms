import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { privilegeMapSql, schemasForEnvironments } from "./drill-restore.mjs";

/** The one file the drill and `@roonga/qcms-db/testing` both read. */
const PRIVILEGE_MAP_PATH = "packages/db/privileges/privilege-map.sql";

/**
 * The restore drill covers `control` and every environment in the live set (ADR-40; task
 * 067, criterion 2).
 *
 * The drill itself needs Docker, three images and a dropped database, so what is tested
 * here is the one part of it that decides **what gets covered**. That part is worth a test
 * of its own precisely because it is the part a future environment silently falls out of:
 * a hand-written schema list would keep passing while covering two of three environments,
 * and the failure would be a backup nobody had restored, which is the claim
 * `docs/backup-restore.md` opens by refusing.
 */
describe("the schemas the drill covers", () => {
  it("covers control plus a data and a reporting schema per environment", () => {
    expect(schemasForEnvironments("test\nprod\n")).toEqual([
      "control",
      "data_test",
      "reporting_test",
      "data_prod",
      "reporting_prod",
    ]);
  });

  it("covers an environment created after the feature shipped, with no code change", () => {
    // Criterion 2's second clause, as the assertion it asks for. The input is what
    // `control.environments` answers after `qcms-db-environment create dev`; the output is
    // two more schemas, derived rather than added here.
    expect(schemasForEnvironments("test\nprod\ndev\n")).toEqual([
      "control",
      "data_test",
      "reporting_test",
      "data_prod",
      "reporting_prod",
      "data_dev",
      "reporting_dev",
    ]);
  });

  it("keeps the table's own order, which is the order every environment list uses", () => {
    // `position` is the canonical order a combined environment set is written in (Q42), and
    // the coverage line the drill prints is read beside the switcher and the access-group
    // names. Re-sorting here would make one list disagree with the others.
    expect(schemasForEnvironments("prod\ntest\n")).toEqual([
      "control",
      "data_prod",
      "reporting_prod",
      "data_test",
      "reporting_test",
    ]);
  });

  it("refuses an empty set rather than covering only `control`", () => {
    // A database whose environment set is empty is one that never migrated or never
    // seeded, and a drill that fingerprinted `control` alone there would pass on a
    // database with no data plane at all.
    expect(() => schemasForEnvironments("")).toThrow(/no environment to cover/);
    expect(() => schemasForEnvironments("  \n \n")).toThrow(/no environment to cover/);
  });
});

describe("the effective-privilege map the restore gates compare", () => {
  it("is the one file, read by the drill and by `@roonga/qcms-db/testing` alike", () => {
    // Three callers, one query: the two Vitest suites reach it through
    // `@roonga/qcms-db/testing` and this script reads the file directly, because a
    // recovery drill must not depend on `packages/db/dist` having been built. This is the
    // assertion that keeps them one query rather than three that drift - the drill's
    // getter against the file, and the package module against the same path.
    expect(privilegeMapSql()).toBe(readFileSync(PRIVILEGE_MAP_PATH, "utf8"));
    expect(readFileSync("packages/db/src/testing/privilege-map.ts", "utf8")).toContain(
      "../../privileges/privilege-map.sql",
    );
    // And the package ships it, or an adopter's `/testing` import throws on a missing file.
    const manifest = JSON.parse(readFileSync("packages/db/package.json", "utf8")) as {
      readonly files: readonly string[];
    };
    expect(manifest.files).toContain("privileges");
  });

  it("asks what each role HOLDS rather than what is stored, which is the drill's finding", () => {
    // A `REVOKE` on a relation whose ACL is NULL materialises it to the owner's own entry
    // and it stays there, so a map over `aclexplode` reports a difference in a privilege
    // nobody holds. The query must therefore go through `has_*_privilege`, and the one
    // placeholder it takes is the schema list to exclude (Q76).
    const sql = privilegeMapSql();
    for (const required of [
      "has_table_privilege",
      "has_sequence_privilege",
      "has_column_privilege",
      "has_function_privilege",
      "has_type_privilege",
      "has_schema_privilege",
    ]) {
      expect(sql, required).toContain(required);
    }
    expect(sql).toContain("$1");
    // The two kinds with no `has_*` form, which are empty today and would stand out.
    expect(sql).toContain("pg_default_acl");
    expect(sql).toContain("pg_largeobject_metadata");
  });
});
