import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GRANT_SOURCES, UNREAPPLIABLE_SOURCES, migrationBackedStatements } from "./grants.js";
import { SHIPPED_ENVIRONMENTS } from "./baseline.js";

/**
 * A grant a migration applies but the registry omits is silently absent from every
 * restored database.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

function migrationSql(): Map<string, string> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return new Map(files.map((name) => [name, readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8")]));
}

/**
 * Line-wise rather than statement-wise: most grants sit inside a `DO $$` guard as an
 * `EXECUTE` or a `format(...)`, so there is nothing to split on.
 */
function grantLines(): { file: string; line: string }[] {
  const found: { file: string; line: string }[] = [];
  for (const [file, sql] of migrationSql()) {
    for (const raw of sql.split("\n")) {
      const line = raw.trim();
      if (line.startsWith("--")) continue;
      if (!/\b(GRANT|REVOKE)\b/.test(line)) continue;
      found.push({ file, line });
    }
  }
  return found;
}

describe("the grant registry", () => {
  const regranted = migrationBackedStatements(SHIPPED_ENVIRONMENTS);
  const regrantedText = regranted.join("\n");
  const everyMigration = [...migrationSql().values()].join("\n");

  it("produces every GRANT and REVOKE the migration tree carries", () => {
    const lines = grantLines();
    expect(lines.length).toBeGreaterThan(30);
    const missing = lines.filter(({ line }) => !regrantedText.includes(line));
    const excluded = UNREAPPLIABLE_SOURCES.flatMap((source) => source.statements());
    const unexplained = missing.filter(
      ({ line }) => !excluded.some((statement) => statement.includes(line)),
    );
    expect(unexplained).toEqual([]);
  });

  it("accounts for the one statement a re-grant deliberately skips", () => {
    expect(UNREAPPLIABLE_SOURCES).toHaveLength(1);
    const [only] = UNREAPPLIABLE_SOURCES;
    expect(only?.why).toContain("pg_database_owner");
    for (const statement of only?.statements() ?? []) {
      expect(everyMigration).toContain(statement);
      expect(regrantedText).not.toContain(statement);
    }
  });

  it("emits only statements the migration tree already carries, verbatim", () => {
    for (const statement of regranted) {
      expect(everyMigration, statement.split("\n")[0]).toContain(statement);
    }
  });

  it("orders the control role's ALL TABLES grant before the audit carve-outs", () => {
    // Load-bearing on a restored database only: there the `ALL TABLES` grant reaches
    // `access_audit` and `two_factor_resets`, which on a fresh migrate do not yet exist.
    const controlRole = regrantedText.indexOf('ON ALL TABLES IN SCHEMA "control"');
    const auditRevoke = regrantedText.indexOf(
      "REVOKE UPDATE, DELETE ON TABLE control.access_audit",
    );
    const migrateOnly = regrantedText.lastIndexOf("two_factor_resets FROM %I");
    expect(controlRole).toBeGreaterThan(-1);
    expect(auditRevoke).toBeGreaterThan(controlRole);
    expect(migrateOnly).toBeGreaterThan(auditRevoke);
  });

  it("exempts exactly the sources that say so, each with a recorded reason", () => {
    // The exempt sources name a slug read from `control.organization` at run time, so no
    // migration can carry one.
    const exempt = GRANT_SOURCES.filter((source) => !source.inMigrationTree);
    expect(exempt.map((source) => source.name)).toEqual([
      "one environment's per-workspace reporting grants (task 067, Q26)",
      "the application role holds its own reporting views, not a workspace's (ADR-40, Q52)",
    ]);
    for (const source of exempt) {
      expect(source.whyNotInMigrationTree ?? "", source.name).toMatch(/control\.organization/);
      expect(source.scope, source.name).toBe("environment-database");
    }
    for (const source of GRANT_SOURCES.filter((entry) => entry.inMigrationTree)) {
      expect(source.scope, source.name).not.toBe("environment-database");
      expect(source.whyNotInMigrationTree, source.name).toBeUndefined();
    }
  });

  it("leaves the exempt source out of the migration-tree comparison, by construction", () => {
    const names = GRANT_SOURCES.filter((source) => source.inMigrationTree).map(
      (source) => source.name,
    );
    for (const exempt of [
      "one environment's per-workspace reporting grants (task 067, Q26)",
      "the application role holds its own reporting views, not a workspace's (ADR-40, Q52)",
    ]) {
      expect(names).not.toContain(exempt);
    }
    expect(migrationBackedStatements(["test"]).length).toBeGreaterThan(5);
  });

  it("names every source, because a failure reports the name and never the statement", () => {
    // SEC-8: the refusal carries this name in place of the SQL.
    for (const source of GRANT_SOURCES) expect(source.name.length).toBeGreaterThan(5);
  });
});
