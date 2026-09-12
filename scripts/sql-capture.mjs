#!/usr/bin/env node
// @ts-check
/**
 * Print the SQL and the parameters Drizzle would send for one `@roonga/qcms-db`
 * query helper (issue #854, first asked for in issue #329).
 *
 * A query helper in `packages/db/src/queries/` is a builder chain, and a review of a
 * change to one is a review of the chain rather than of the statement it produces. The
 * two are not the same reading. `notExists(...)` around a correlated subquery, an `or()`
 * that supplies the parentheses a raw fragment would not, `sql.param` binding a list as
 * one array instead of ten thousand placeholders: each of those is a comment in
 * `queries/outbox.ts` explaining a statement nobody in the review could see. The
 * alternative to seeing it has been booting a Testcontainers Postgres, which is minutes
 * and a Docker daemon for a question that needs neither, so in practice the statement
 * went unread and the chain was reviewed instead.
 *
 * This prints the statement. No connection, no container, no network: Drizzle's
 * dialect turns a builder into `{ sql, params }` on its own, and the driver underneath
 * is a callback that records what it was handed and hands back rows.
 *
 * ## What it does
 *
 * Loads a named export from the built `@roonga/qcms-db`, calls it with a recording
 * executor as its first argument (every helper in that package takes one, by contract),
 * and prints each statement it issued with its parameters in order.
 *
 * Two consequences of running the helper rather than inspecting it, both deliberate:
 *
 * - A helper that issues **several** statements prints all of them. The outbox retention
 *   sweep probes for candidates and then updates under an anti-join, and the anti-join
 *   is the half worth reading.
 * - A helper that reads its own result to decide what to do next needs that result. So
 *   by default every statement returns **one row with no columns**, which is enough for
 *   the probe-then-act shape to reach its second statement. Every field a helper reads
 *   off that row is `undefined`, and a parameter bound from one prints as `null` only
 *   because that is how `JSON.stringify` renders it. `--rows` supplies real values where
 *   a helper does arithmetic on what it read.
 *
 * ## Scope, and the refusals
 *
 * Anything exported from `@roonga/qcms-db` that is not a query helper is refused by
 * name, in one of three ways: no such export, an export that is not a function (a table,
 * an enum, a constant), or a function that ran without issuing a statement (`computeBackoff`
 * and friends are pure). None of the three is half-answered - a printed "no statements"
 * would read like a query helper that generates no SQL, which is not a thing.
 *
 * `transaction` is run against the same recording handle, so a read-modify-write helper's
 * statements are captured in order. No `begin`/`commit` is printed, because the proxy
 * driver issues none and the statements are what is under review.
 *
 * Dependency-free in the sense `scripts/png-preview.mjs` is: it adds nothing to any
 * manifest. Drizzle is resolved through `packages/db`, which already depends on it, so
 * exactly one copy of the library is loaded - the same one the built package imports.
 * The package itself is reached by path rather than by name for the same reason: the
 * repository root declares no workspace dependencies, and adding one so that a tooling
 * script can read a build output is a manifest change this tool exists to not need.
 *
 * Usage:
 *   pnpm sql:capture <export>
 *   pnpm sql:capture <export> --args '<json array>'
 *   pnpm sql:capture <export> --args '<json array>' --rows '<json array>'
 *   pnpm sql:capture --list
 *
 * `--args` is the argument list **after** the executor, as JSON. A `Date` is written
 * `{"$date": "2026-01-01T00:00:00.000Z"}`, because JSON has no date and an ISO-looking
 * string is a string in this repository's schemas as often as it is a timestamp.
 *
 * `--rows` is what the recording driver returns, statement by statement: element N is
 * the rows for statement N, each row an array of column values in the order the select
 * lists them. `[]` is no rows; `null` is also no rows; an element that is not supplied
 * falls back to the default of one row with no columns.
 *
 * Exit codes: 0 on a printed capture, 1 with `sql-capture: <reason>` on stderr for an
 * unbuilt package, a bad argument, a refused export, or a helper that threw.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { argv, exit } from "node:process";
import { pathToFileURL } from "node:url";

/** The built package this reads its query helpers from. */
export const DB_ENTRY = new URL("../packages/db/dist/index.js", import.meta.url);

/** Resolution anchor for Drizzle: the package that already declares the dependency. */
const DB_PACKAGE_JSON = new URL("../packages/db/package.json", import.meta.url);

/** What to run when the package has not been built. */
export const BUILD_HINT = "pnpm --filter @roonga/qcms-db build";

/**
 * Statements captured before the run is abandoned. A helper that loops until a read
 * comes back empty never terminates against a driver that always returns a row, and a
 * hung script with no output is a worse answer than a refusal that names the cap.
 */
export const STATEMENT_LIMIT = 50;

/** A refusal a caller is meant to print, rather than a bug. */
export class SqlCaptureError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "SqlCaptureError";
  }
}

/**
 * @typedef {{ sql: string; params: unknown[] }} CapturedStatement
 */

/**
 * @typedef {{
 *   name: string;
 *   statements: CapturedStatement[];
 *   failure?: string;
 * }} Capture
 */

/**
 * Revive the one JSON-hostile value the query helpers take: a `Date`.
 *
 * Tagged rather than sniffed. `secure_links` and the answer ledger both carry
 * string columns whose values are ISO-shaped in fixtures, so a rule that promoted any
 * ISO-looking string to a `Date` would silently change what a capture is a capture of.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function reviveArgs(value) {
  if (Array.isArray(value)) return value.map(reviveArgs);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  if (entries.length === 1 && entries[0][0] === "$date") {
    const raw = entries[0][1];
    const date = typeof raw === "string" ? new Date(raw) : new Date(Number.NaN);
    if (Number.isNaN(date.getTime())) {
      throw new SqlCaptureError(
        `--args: {"$date": ...} needs a parseable date, got ${JSON.stringify(raw)}`,
      );
    }
    return date;
  }
  return Object.fromEntries(entries.map(([key, member]) => [key, reviveArgs(member)]));
}

/**
 * @param {string} option
 * @param {string} text
 * @returns {unknown}
 */
function parseJson(option, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SqlCaptureError(
      `${option} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * `--rows`, validated into the shape the recording driver reads.
 *
 * @param {unknown} value
 * @returns {(unknown[][] | null)[]}
 */
export function parseRows(value) {
  if (!Array.isArray(value)) {
    throw new SqlCaptureError("--rows must be a JSON array, one element per statement");
  }
  return value.map((element, index) => {
    if (element === null) return null;
    if (!Array.isArray(element) || element.some((row) => !Array.isArray(row))) {
      throw new SqlCaptureError(
        `--rows[${String(index)}] must be null or an array of rows, each row an array of column values`,
      );
    }
    return /** @type {unknown[][]} */ (element);
  });
}

/**
 * @param {string[]} args
 * @returns {{ name?: string; args: unknown[]; rows: (unknown[][] | null)[]; list: boolean }}
 */
export function parseArgs(args) {
  /** @type {string | undefined} */
  let name;
  /** @type {unknown[]} */
  let callArgs = [];
  /** @type {(unknown[][] | null)[]} */
  let rows = [];
  let list = false;
  const remaining = [...args];

  /**
   * @param {string} option
   * @param {string | undefined} inline
   * @returns {string}
   */
  const valueFor = (option, inline) => {
    const value = inline ?? remaining.shift();
    if (value === undefined) throw new SqlCaptureError(`${option} requires a value`);
    return value;
  };

  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    const [flag, ...rest] = arg.split("=");
    const inline = arg.includes("=") ? rest.join("=") : undefined;
    if (flag === "--args") {
      const parsed = reviveArgs(parseJson("--args", valueFor("--args", inline)));
      if (!Array.isArray(parsed)) {
        throw new SqlCaptureError(
          "--args must be a JSON array of the arguments after the executor",
        );
      }
      callArgs = parsed;
    } else if (flag === "--rows") {
      rows = parseRows(parseJson("--rows", valueFor("--rows", inline)));
    } else if (flag === "--list") {
      list = true;
    } else if (arg.startsWith("-")) {
      throw new SqlCaptureError(`unknown option: ${arg}`);
    } else if (name === undefined) {
      name = arg;
    } else {
      throw new SqlCaptureError(`unexpected argument: ${arg}`);
    }
  }

  if (name === undefined && !list) {
    throw new SqlCaptureError(
      "usage: pnpm sql:capture <export> [--args json] [--rows json] | --list",
    );
  }
  return { name, args: callArgs, rows, list };
}

/**
 * Load Drizzle's proxy driver through `packages/db`.
 *
 * `require.resolve` answers with the CommonJS build because that is the condition a
 * `require` resolution asks for; the ESM sibling beside it is what the built package
 * itself imports, so preferring it keeps one copy of Drizzle in the process rather than
 * two that disagree about every `instanceof`.
 *
 * The `.cjs` fallback is safe rather than merely unlikely, which is worth recording
 * because it is not visible from here. Importing `pg-proxy/index.cjs` from ESM yields
 * the named binding as well as the default (`Object.keys` is `PgProxyTransaction`,
 * `PgRemoteDatabase`, `PgRemoteSession`, `PreparedQuery`, `default`, `drizzle`,
 * `module.exports`, with `typeof drizzle === "function"`), because `cjs-module-lexer`
 * reads the build's export list. So no `default` unwrapping is needed on either path.
 *
 * @returns {Promise<{ drizzle: Function }>}
 */
export async function loadProxyDriver() {
  const require = createRequire(DB_PACKAGE_JSON);
  let resolved;
  try {
    resolved = require.resolve("drizzle-orm/pg-proxy");
  } catch {
    throw new SqlCaptureError("cannot resolve drizzle-orm from packages/db; run pnpm install");
  }
  const sibling = resolved.endsWith(".cjs") ? `${resolved.slice(0, -".cjs".length)}.js` : resolved;
  const entry = existsSync(sibling) ? sibling : resolved;
  return import(pathToFileURL(entry).href);
}

/**
 * Load the built query surface.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadQueries() {
  if (!existsSync(DB_ENTRY)) {
    throw new SqlCaptureError(
      `packages/db is not built: no dist/index.js. Run \`${BUILD_HINT}\` and try again`,
    );
  }
  return import(DB_ENTRY.href);
}

/**
 * The rows statement `index` gets back.
 *
 * @param {(unknown[][] | null)[]} rows
 * @param {number} index
 * @returns {unknown[][]}
 */
export function rowsForStatement(rows, index) {
  const configured = index < rows.length ? rows[index] : undefined;
  if (configured === null) return [];
  // One row, no columns: every field a helper reads off it is `undefined`. Enough for a
  // probe-then-act helper to take its found-something branch, which is the only reason
  // a default row exists at all.
  return configured ?? [[]];
}

/**
 * A Drizzle handle that records statements instead of sending them.
 *
 * @param {Function} drizzle the proxy driver's factory
 * @param {unknown} schema the package's schema namespace, for relational queries
 * @param {(unknown[][] | null)[]} rows
 * @returns {{ executor: Record<string, unknown>; statements: CapturedStatement[] }}
 */
export function createRecordingExecutor(drizzle, schema, rows) {
  /** @type {CapturedStatement[]} */
  const statements = [];
  /**
   * @param {string} sql
   * @param {unknown[]} params
   */
  const client = (sql, params) => {
    if (statements.length >= STATEMENT_LIMIT) {
      throw new SqlCaptureError(
        `stopped after ${String(STATEMENT_LIMIT)} statements; a helper that reads until it finds nothing needs --rows to terminate`,
      );
    }
    statements.push({ sql, params });
    return Promise.resolve({ rows: rowsForStatement(rows, statements.length - 1) });
  };

  const executor = /** @type {Record<string, unknown>} */ (drizzle(client, { schema }));

  // The proxy driver refuses transactions outright, and several helpers wrap a
  // read-modify-write in one. Running the callback against the same recording handle
  // captures its statements in the order it issues them, which is the whole question a
  // reader of `recordFailure` has.
  executor.transaction = /** @param {Function} run */ (run) => run(executor);

  // `db.execute` answers with a bare row array under the proxy driver and with a
  // node-postgres `QueryResult` under the driver this repository actually runs. The
  // helpers that write their statement as a raw `sql` template read `.rows` off it, so
  // without this reshape they cannot complete: `listResponses` issues both of its
  // statements and then throws at `packages/db/src/queries/reporting.ts:116` when it maps
  // the page, and the capture exits 1 on an error from the helper's own code instead of
  // printing a clean result. Restoring the node-postgres shape is not a fiction about the
  // SQL: it runs after `client` has already recorded, so nothing here changes what was
  // sent, only what the caller reads back.
  const proxyExecute = /** @type {Function} */ (executor.execute).bind(executor);
  executor.execute = /** @param {unknown} query */ async (query) => {
    const result = await proxyExecute(query);
    return Array.isArray(result) ? { rows: result, rowCount: result.length } : result;
  };

  return { executor, statements };
}

/**
 * Every exported function, which is the candidate set `--list` prints and the refusal
 * message points at.
 *
 * A `pgEnum` is callable - it doubles as a column builder - so the schema's enums would
 * otherwise sit in the list beside the query helpers. They are dropped by the property
 * that makes them enums rather than by name, so a new one never has to be remembered.
 * The list is still candidates rather than a guarantee: a pure helper such as
 * `computeBackoff` is a function too, and is refused when it turns out to issue nothing.
 *
 * @param {Record<string, unknown>} queries
 * @returns {string[]}
 */
export function exportedFunctions(queries) {
  return Object.keys(queries)
    .filter((key) => {
      const value = queries[key];
      if (typeof value !== "function") return false;
      return !Array.isArray(/** @type {{ enumValues?: unknown }} */ (value).enumValues);
    })
    .sort((left, right) => left.localeCompare(right));
}

/**
 * @param {Record<string, unknown>} queries
 * @param {string} name
 * @returns {Function}
 */
export function resolveQueryBuilder(queries, name) {
  if (!(name in queries)) {
    throw new SqlCaptureError(
      `no export named '${name}' in @roonga/qcms-db; run \`pnpm sql:capture --list\` for the candidates`,
    );
  }
  const candidate = queries[name];
  if (typeof candidate !== "function") {
    throw new SqlCaptureError(
      `'${name}' is not a query builder: the export is of type ${candidate === null ? "null" : typeof candidate}, not a function`,
    );
  }
  return candidate;
}

/**
 * Run one query helper against a recording executor.
 *
 * @param {{ name: string; args?: unknown[]; rows?: (unknown[][] | null)[] }} request
 * @returns {Promise<Capture>}
 */
export async function capture({ name, args = [], rows = [] }) {
  const queries = await loadQueries();
  const builder = resolveQueryBuilder(queries, name);
  const { drizzle } = await loadProxyDriver();
  const { executor, statements } = createRecordingExecutor(drizzle, queries.schema, rows);

  /** @type {string | undefined} */
  let failure;
  try {
    await builder(executor, ...args);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (statements.length === 0) {
    throw new SqlCaptureError(
      failure === undefined
        ? `'${name}' is not a query builder: it ran without issuing a statement`
        : `'${name}' issued no statement and threw: ${failure}`,
    );
  }
  return failure === undefined ? { name, statements } : { name, statements, failure };
}

/**
 * @param {Capture} result
 * @returns {string[]}
 */
export function formatCapture({ name, statements }) {
  const count = statements.length;
  const lines = [`${name}: ${String(count)} statement${count === 1 ? "" : "s"}`];
  statements.forEach((statement, index) => {
    // Trimmed only at the ends. A helper that writes its statement as a raw template
    // arrives with the source file's leading newline and closing indentation, and both
    // are noise in a PR body; the internal shape is left exactly as it was written.
    lines.push("", `-- statement ${String(index + 1)}`, statement.sql.trim());
    if (statement.params.length === 0) {
      lines.push("-- no parameters");
      return;
    }
    lines.push("-- parameters");
    statement.params.forEach((param, position) => {
      lines.push(`$${String(position + 1)} = ${JSON.stringify(param) ?? "undefined"}`);
    });
  });
  return lines;
}

/**
 * @param {string[]} args
 * @returns {Promise<number>} process exit code
 */
export async function main(args) {
  try {
    const request = parseArgs(args);
    if (request.list) {
      for (const name of exportedFunctions(await loadQueries())) console.log(name);
      return 0;
    }
    const result = await capture({
      name: /** @type {string} */ (request.name),
      args: request.args,
      rows: request.rows,
    });
    for (const line of formatCapture(result)) console.log(line);
    if (result.failure === undefined) return 0;
    // The statements above are real and worth reading; the helper simply could not get
    // past them on the rows it was given. Both halves are reported.
    console.error(
      `sql-capture: '${result.name}' threw after ${String(result.statements.length)} statement(s): ${result.failure}`,
    );
    return 1;
  } catch (error) {
    console.error(`sql-capture: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(await main(argv.slice(2)));
}
