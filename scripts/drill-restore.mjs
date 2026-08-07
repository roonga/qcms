/**
 * The restore drill (task 036, exit criterion 1): prove that a `pg_dump` of a QCMS
 * database can actually be restored and that the product still works on top of it.
 *
 * ## Why this is a script and not a page in the runbook
 *
 * A backup nobody has restored is not a backup, it is a file. The failure modes that
 * matter (a dump missing an extension, an ownership mismatch, a restore that lands
 * the schema but not the auth tables) are all invisible until someone tries, and the
 * moment someone tries is the worst possible moment to find out. So the drill runs on
 * a schedule against the real images, and its verdict is a green or red CI job.
 *
 * ## What makes it a real drill
 *
 * The weak version of this test dumps a database and restores it somewhere else, then
 * checks the row counts match. That proves `pg_dump` can round-trip bytes, which was
 * never in doubt. Two things here are deliberately stronger:
 *
 * 1. **The data is destroyed for real.** The database is dropped, and the drill
 *    asserts the public schema is genuinely empty before restoring. A drill that
 *    restores over live data silently passes forever.
 * 2. **The application is the judge, not a row count.** After the restore the
 *    full-stack browser suite runs a second time and signs in with the
 *    **pre-dump administrator credentials**. That is the assertion that matters: it
 *    exercises the restored auth tables, the restored schema and the restored domain
 *    data through the real product, rather than trusting `count(*)`.
 *
 * The second suite run is safe to repeat against a database it has already written
 * to: `apps/e2e/full-stack-conditional-form.pw.ts` derives every slug and question id
 * from a per-run timestamp, so the two runs never collide.
 *
 * ## What is deliberately NOT recreated
 *
 * The `postgres` container keeps running; only the database inside it is dropped and
 * rebuilt. That is not a shortcut, it is a constraint of the harness: inside the dev
 * container the suite reaches the stack through a loopback forwarder that resolved
 * the **portal and admin container IP addresses** when `up()` ran (issue #316). The
 * `api` and `postgres` containers can be restarted freely because nothing forwards to
 * them and Compose resolves them by service name, but recreating portal or admin
 * would strand the forwarder on stale addresses and the failure would look like a
 * restore bug rather than a networking one.
 *
 * Dropping the database exercises exactly the path an operator's restore takes
 * (`psql` into an empty database). It does not exercise "the Postgres host was lost",
 * which is a topology drill rather than a data drill and belongs to the operator's
 * own infrastructure. `docs/backup-restore.md` is explicit about that boundary.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { composeCapture, composeRun, down, test, up } from "./compose-e2e.mjs";
import { REPOSITORY_ROOT } from "./docker.mjs";
import { assertPortSeatChosen } from "./ports.mjs";

/** Where the dump lands inside the `postgres` container, and on the host. */
const CONTAINER_DUMP = "/tmp/qcms-drill.dump.sql";

/**
 * Row counts for every table in the public schema, as a stable printable string.
 *
 * Deliberately not a hand-written table list: a drill that only counts the tables
 * someone remembered in 2026 stops covering the ones added afterwards, and silently.
 * `query_to_xml` is the standard idiom for a count over a dynamic relation name from
 * inside a single query.
 *
 * @returns {string}
 */
function fingerprint() {
  const sql = `
    select table_name || '=' || (
      xpath(
        '/row/c/text()',
        query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')
      )
    )[1]::text
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name;
  `;
  return psql(["--tuples-only", "--no-align", "--command", sql.replace(/\s+/g, " ").trim()]);
}

/**
 * Run `psql` inside the `postgres` container as the database owner.
 *
 * The credentials come from the container's own `POSTGRES_*` environment rather than
 * from the host's env file. Same allocation, one source: the drill never has to agree
 * with `docker-compose.yml` about what the database is called.
 *
 * @param {string[]} args
 * @returns {string}
 */
function psql(args) {
  return composeCapture([
    "exec",
    "--no-TTY",
    "postgres",
    "sh",
    "-c",
    `psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" ${args.map(shellQuote).join(" ")}`,
  ]);
}

/** @param {string} value */
function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Number of tables in the public schema, as a number. */
function tableCount() {
  const out = psql([
    "--tuples-only",
    "--no-align",
    "--command",
    "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';",
  ]);
  return Number(out.trim());
}

/**
 * Dump the database to a host file, through a file in the container rather than
 * through this process's stdio: a dump is the one artifact in the flow that must
 * survive byte for byte, and piping it through a captured stdout invites exactly the
 * trailing-whitespace and encoding trims that make a restore fail at 3am.
 *
 * @param {string} hostPath
 */
function dumpTo(hostPath) {
  composeRun([
    "exec",
    "--no-TTY",
    "postgres",
    "sh",
    "-c",
    `pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges > ${CONTAINER_DUMP}`,
  ]);
  composeRun(["cp", `postgres:${CONTAINER_DUMP}`, hostPath]);
}

/**
 * Drop and recreate the database, so the restore has nothing to hide behind.
 *
 * Connections are terminated first: Postgres refuses to drop a database that anything
 * is still connected to, and the API holds a pool open. The API is restarted
 * afterwards rather than before, because a pool whose database vanished underneath it
 * is exactly the state the restart exists to clear.
 */
function destroyDatabase() {
  composeRun([
    "exec",
    "--no-TTY",
    "postgres",
    "sh",
    "-c",
    [
      `psql --username "$POSTGRES_USER" --dbname postgres --command`,
      `"select pg_terminate_backend(pid) from pg_stat_activity where datname = '$POSTGRES_DB' and pid <> pg_backend_pid();"`,
      `&& dropdb --username "$POSTGRES_USER" "$POSTGRES_DB"`,
      `&& createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" "$POSTGRES_DB"`,
    ].join(" "),
  ]);
}

/** @param {string} hostPath */
function restoreFrom(hostPath) {
  composeRun(["cp", hostPath, `postgres:${CONTAINER_DUMP}`]);
  composeRun([
    "exec",
    "--no-TTY",
    "postgres",
    "sh",
    "-c",
    // ON_ERROR_STOP is the difference between a restore that failed and a restore
    // that reported success while skipping every statement after the first error.
    `psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=on --file ${CONTAINER_DUMP}`,
  ]);
}

/** @param {string} message */
function step(message) {
  process.stdout.write(`\ndrill-restore: ${message}\n`);
}

async function drill() {
  const workspace = mkdtempSync(join(tmpdir(), "qcms-drill-"));
  const hostDump = join(workspace, "qcms-drill.dump.sql");
  try {
    step("bringing up a fresh stack and bootstrapping an administrator");
    await up();

    step("seeding real domain data by running the full-stack suite");
    test();

    step("fingerprinting the seeded database");
    const before = fingerprint();
    const seededTables = tableCount();
    if (seededTables === 0) {
      throw new Error("drill-restore: the seeded database has no tables; the stack never migrated");
    }
    process.stdout.write(`${before}\n`);

    step(`dumping to ${hostDump}`);
    dumpTo(hostDump);

    step("destroying the database");
    destroyDatabase();
    const emptied = tableCount();
    if (emptied !== 0) {
      throw new Error(
        `drill-restore: the database still has ${String(emptied)} tables after the drop, so the restore below would prove nothing`,
      );
    }

    step("restoring from the dump");
    restoreFrom(hostDump);

    step("restarting the API so it reconnects to the restored database");
    composeRun(["up", "--detach", "--wait", "api"]);

    step("comparing the restored fingerprint against the pre-dump one");
    const after = fingerprint();
    if (after !== before) {
      throw new Error(
        `drill-restore: the restored database does not match the dump.\nbefore:\n${before}\nafter:\n${after}`,
      );
    }
    process.stdout.write(`${after}\n`);

    step("re-running the full-stack suite against the restored database");
    // The assertion that actually matters: this run signs in with the administrator
    // created BEFORE the dump, so a restore that lost the auth tables fails here even
    // though the row counts above would have matched.
    test();

    step("PASSED: the dump restored and the product works on top of it");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function main() {
  assertPortSeatChosen(REPOSITORY_ROOT, "pnpm qcms:drill-restore");
  /** @type {unknown} */
  let failure;
  try {
    await drill();
  } catch (error) {
    failure = error;
  }
  try {
    down();
  } catch (error) {
    if (failure === undefined) failure = error;
    else process.stderr.write(`drill-restore: teardown also failed: ${String(error)}\n`);
  }
  if (failure !== undefined) throw failure;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.exitCode = 1;
    process.stderr.write(
      `drill-restore: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
  });
}
