import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GRANT_SOURCES, UNREAPPLIABLE_SOURCES, migrationBackedStatements } from "./grants.js";
import { SHIPPED_ENVIRONMENTS } from "./baseline.js";

/**
 * The re-grant set and the migrations cannot differ (issue #1094, Code Owner 2026-10-22).
 *
 * The ruling's central requirement is that the re-grant subcommand is built from the
 * **same grant code** the migrations use, never from a second hand-maintained copy, and
 * that **a test fails if the two ever differ**. Two directions make that executable, and
 * the second is the one that catches the realistic mistake:
 *
 *   1. **Every statement the registry's migration-backed half produces is in the migration
 *      tree, verbatim.** This is the direction `baseline.test.ts` and
 *      `control-table-grants.test.ts` already cover for their own files; it is repeated
 *      here over the whole list, so a source added to the registry that no migration
 *      carries fails. The one source outside that half is task 067's per-workspace
 *      reporting pass, which reads `control.organization` at run time and which no
 *      migration can carry; its exemption is **data on the source** and is asserted
 *      below, so a second exemption needs a deliberate edit and a reason.
 *   2. **Every `GRANT` and `REVOKE` in the migration tree is produced by the registry.**
 *      This is the one that fails when somebody writes a migration that grants something
 *      and does not add a producer for it. Without it, the next task's grant would be
 *      applied by its migration, dropped by `--no-privileges`, and silently absent from
 *      every restored database - which is exactly the shape of the defect this subcommand
 *      was written for.
 *
 * Both read the SQL rather than a list of file names, so a migration added next week is
 * covered by a test written today.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

/** Every migration's text, keyed by file name, newest last. */
function migrationSql(): Map<string, string> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return new Map(files.map((name) => [name, readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8")]));
}

/**
 * Every line of the migration tree that grants or revokes a privilege, normalised.
 *
 * Line-wise rather than statement-wise because most of these sit inside a `DO $$` guard
 * as an `EXECUTE 'GRANT ...'` or a `format('GRANT ... %I', ...)`, so the grant is a
 * fragment of a larger statement and there is nothing to split on. What the comparison
 * then needs is only that the fragment appears in the re-grant text, which is enough:
 * the registry's output is the migration's own bytes, so a fragment that is present is
 * present inside the same guard it came from.
 *
 * `GRANT CREATE ON DATABASE` is excluded with the rest of the recipe's own statements:
 * it is not in the migration tree at all (it is `docker-compose.yml`'s `db-roles` and the
 * operator recipe), and if it ever arrives in one it will fail this test, which is the
 * right outcome - a database-level grant needs the database owner, not the migration role.
 */
function grantLines(): { file: string; line: string }[] {
  const found: { file: string; line: string }[] = [];
  for (const [file, sql] of migrationSql()) {
    for (const raw of sql.split("\n")) {
      const line = raw.trim();
      // A comment is prose, not a statement, and several of these paragraphs discuss
      // grants by name.
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
    // Direction 2: the one that fails when a migration grants something the registry has
    // no producer for. The reported failure names the file and the line, so the fix -
    // add the source to GRANT_SOURCES - is obvious from the message.
    const lines = grantLines();
    // A floor under the scan: a regex that stopped matching would make this vacuous.
    expect(lines.length).toBeGreaterThan(30);
    const missing = lines.filter(({ line }) => !regrantedText.includes(line));
    const excluded = UNREAPPLIABLE_SOURCES.flatMap((source) => source.statements());
    const unexplained = missing.filter(
      ({ line }) => !excluded.some((statement) => statement.includes(line)),
    );
    expect(unexplained).toEqual([]);
  });

  it("accounts for the one statement a re-grant deliberately skips", () => {
    // The exclusion above is not a hole in the test: it is a single, named source with a
    // recorded reason, and this is what keeps it to one. A second entry arriving without
    // somebody reading its `why` is what this length assertion is for.
    expect(UNREAPPLIABLE_SOURCES).toHaveLength(1);
    const [only] = UNREAPPLIABLE_SOURCES;
    expect(only?.why).toContain("pg_database_owner");
    for (const statement of only?.statements() ?? []) {
      // Still in the migration, which is the point: the baseline establishes it as the
      // schema owner, and only the re-grant cannot.
      expect(everyMigration).toContain(statement);
      expect(regrantedText).not.toContain(statement);
    }
  });

  it("emits only statements the migration tree already carries, verbatim", () => {
    // Direction 1. `migrationBackedStatements` for the shipped set is the baseline's own grant
    // half plus the two later migrations', so every statement must be found as written.
    for (const statement of regranted) {
      expect(everyMigration, statement.split("\n")[0]).toContain(statement);
    }
  });

  it("orders the control role's ALL TABLES grant before the audit carve-outs", () => {
    // The order is load-bearing on a RESTORED database and nowhere else, which is why it
    // needs an assertion rather than a comment: `GRANT ... ON ALL TABLES IN SCHEMA
    // control` reaches `access_audit` and `two_factor_resets` once those tables exist,
    // and the two revokes are what take the extra privileges back. On a fresh migrate the
    // tables do not exist yet, so a reversed order would pass every other test here.
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
    // The exemption from direction 1 is **data**, not a hole in the test. Task 067's
    // per-workspace reporting grants name a workspace slug read from
    // `control.organization` at run time, so no migration can carry one - and the source
    // that emits them has to say so, with a reason, or this fails.
    const exempt = GRANT_SOURCES.filter((source) => !source.inMigrationTree);
    expect(exempt.map((source) => source.name)).toEqual([
      "one environment's per-workspace reporting views and roles (task 067, Q26)",
      "the application role holds its own reporting views, not a workspace's (ADR-40, Q52)",
    ]);
    for (const source of exempt) {
      expect(source.whyNotInMigrationTree ?? "", source.name).toMatch(/control\.organization/);
      // And only the database-reading kind may be exempt: a synchronous source is derived
      // from source code alone, so a migration can and must carry its output.
      expect(source.scope, source.name).toBe("environment-database");
    }
    // Every other source is in the tree, which is what makes direction 1 above cover the
    // whole of the model a migration applies.
    for (const source of GRANT_SOURCES.filter((entry) => entry.inMigrationTree)) {
      expect(source.scope, source.name).not.toBe("environment-database");
      expect(source.whyNotInMigrationTree, source.name).toBeUndefined();
    }
  });

  it("leaves the exempt source out of the migration-tree comparison, by construction", () => {
    // `migrationBackedStatements` is what both directions read, and it must not be able to
    // reach a source that needs a database: a sync walk over an async generator would
    // silently emit nothing and make direction 1 pass vacuously for it.
    const names = GRANT_SOURCES.filter((source) => source.inMigrationTree).map(
      (source) => source.name,
    );
    for (const exempt of [
      "one environment's per-workspace reporting views and roles (task 067, Q26)",
      "the application role holds its own reporting views, not a workspace's (ADR-40, Q52)",
    ]) {
      expect(names).not.toContain(exempt);
    }
    // A floor: the tree-backed half still carries the whole of what the migrations apply.
    expect(migrationBackedStatements(["test"]).length).toBeGreaterThan(5);
  });

  it("names every source, because a failure reports the name and never the statement", () => {
    // SEC-8. `regrant.ts` passes the source name to `refuseWithoutStatement` in place of
    // the SQL, so a source with an empty name would turn a refusal into a line that says
    // nothing.
    for (const source of GRANT_SOURCES) expect(source.name.length).toBeGreaterThan(5);
  });
});
