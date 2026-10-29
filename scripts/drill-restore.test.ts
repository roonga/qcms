import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { privilegeMapSql, schemasForEnvironments } from "./drill-restore.mjs";

const PRIVILEGE_MAP_PATH = "packages/db/privileges/privilege-map.sql";

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
    expect(schemasForEnvironments("prod\ntest\n")).toEqual([
      "control",
      "data_prod",
      "reporting_prod",
      "data_test",
      "reporting_test",
    ]);
  });

  it("refuses an empty set rather than covering only `control`", () => {
    expect(() => schemasForEnvironments("")).toThrow(/no environment to cover/);
    expect(() => schemasForEnvironments("  \n \n")).toThrow(/no environment to cover/);
  });
});

describe("the effective-privilege map the restore gates compare", () => {
  it("is the one file, read by the drill and by `@roonga/qcms-db/testing` alike", () => {
    // The drill reads the file directly because a recovery drill must not depend on
    // `packages/db/dist` having been built.
    expect(privilegeMapSql()).toBe(readFileSync(PRIVILEGE_MAP_PATH, "utf8"));
    expect(readFileSync("packages/db/src/testing/privilege-map.ts", "utf8")).toContain(
      "../../privileges/privilege-map.sql",
    );
    const manifest = JSON.parse(readFileSync("packages/db/package.json", "utf8")) as {
      readonly files: readonly string[];
    };
    expect(manifest.files).toContain("privileges");
  });

  it("asks what each role HOLDS rather than what is stored, which is the drill's finding", () => {
    // A `REVOKE` on a NULL ACL materialises the owner's own entry, so a map over
    // `aclexplode` reports a difference in a privilege nobody holds.
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
    expect(sql).toContain("pg_default_acl");
    expect(sql).toContain("pg_largeobject_metadata");
  });
});
