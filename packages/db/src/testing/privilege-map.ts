import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The complete **effective** privilege map, as one SQL text (issue #1094).
 *
 * # What it is for
 *
 * "The re-grant cannot widen privilege" is only checkable against the whole set of
 * privileges, not against the ones a test remembered to ask about. So the restore gates
 * snapshot this before a dump and compare it for equality after the re-grant, and a
 * privilege nobody expected appears as an extra row rather than going unnoticed.
 *
 * # Why `has_*_privilege` and not `aclexplode`
 *
 * The first version read `relacl`, `proacl`, `typacl` and `nspacl` through `aclexplode`,
 * which reports what is **stored** rather than what is **held**. Those differ, and the
 * restore drill found the gap: a `REVOKE` on a relation whose ACL is NULL **materialises**
 * it, so `pg_class.relacl` goes from NULL to `{owner=arwdDxt/owner}` and stays there -
 * PostgreSQL does not fold an ACL back to NULL when it becomes equal to the default again.
 * Measured on `postgres:16-alpine`: one `qcms-db-environment regrant` turns
 * `reporting_prod.default_responses -> NULL` into
 * `reporting_prod.default_responses -> {qcms_migrate=arwdDxt/qcms_migrate}`, and a second
 * run leaves it there. Not one privilege changed.
 *
 * A map over stored ACLs therefore fails on a difference that is not a difference, which is
 * worse than useless in a gate: it trains a reader to explain failures away. This asks the
 * server the question the requirement actually asks - does this role hold this privilege on
 * this object - so materialisation, ownership-implied rights and grants through `PUBLIC` all
 * read the same whichever way they are stored.
 *
 * Two kinds stay on `aclexplode`, because there is no `has_*_privilege` form for them:
 * default ACLs (`pg_default_acl`) and large objects. ADR-40 sets no default privileges and
 * QCMS stores no large object, so both are empty today - and that is exactly why they are
 * in the map: a future one would appear.
 *
 * # `public` is a parameter, not a decision made here
 *
 * `$1` is the list of schemas to leave out. The e2e passes none. The restore drill passes
 * `public`, because the documented procedure recreates the database and `public` comes back
 * owned by `pg_database_owner` where it was owned by `qcms_migrate` before, so the migration
 * role's `CREATE` on it genuinely changes - which is Q76, asserted directly rather than
 * through this map.
 */
const PRIVILEGE_MAP_PATH = fileURLToPath(
  new URL("../../privileges/privilege-map.sql", import.meta.url),
);

/**
 * The query text, read from the one file `scripts/drill-restore.mjs` reads.
 *
 * A file rather than a string literal in each caller: the two suites live in different
 * packages and the drill is a `.mjs` script that runs through `psql` before, between and
 * after builds of `dist/`, so a literal would have been three copies of a catalogue query
 * to keep correct. `../../privileges/` resolves the same from `src/testing/` and from
 * `dist/testing/`, which is how `MIGRATIONS_DIR` already addresses the migration files,
 * and `packages/db/package.json` ships the directory. `drill-restore.test.ts` asserts the
 * drill reads this path and not a copy.
 */
export const PRIVILEGE_MAP_SQL = readFileSync(PRIVILEGE_MAP_PATH, "utf8");

/** The path, so a caller outside this package can read the same bytes. */
export { PRIVILEGE_MAP_PATH };
