#!/usr/bin/env node
// @ts-check
/**
 * Prints the SQL and parameters Drizzle would send for one `@roonga/qcms-db` query helper, with no
 * connection. Each statement returns one row with no columns unless `--rows` supplies values. In
 * `--args` a `Date` is `{"$date": "..."}`; `packages/db` is reached by path as the root declares no workspace dependencies.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { argv, exit } from "node:process";
import { pathToFileURL } from "node:url";

export const DB_ENTRY = new URL("../packages/db/dist/index.js", import.meta.url);

/** Resolved through the package that already declares Drizzle, so one copy is loaded. */
const DB_PACKAGE_JSON = new URL("../packages/db/package.json", import.meta.url);

export const BUILD_HINT = "pnpm --filter @roonga/qcms-db build";

/**
 * A helper that loops until a read comes back empty never terminates against a driver
 * that always returns a row, and a hung script is worse than a refusal naming the cap.
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
 * Tagged rather than sniffed: `secure_links` and the answer ledger carry string columns
 * whose fixture values are ISO-shaped, so promoting any such string would change what a
 * capture is a capture of.
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
 * `require.resolve` answers with the CommonJS build, so the ESM sibling is preferred:
 * that is what the built package imports, and two copies of Drizzle would disagree
 * about every `instanceof`. Neither path needs `default` unwrapping, because
 * `cjs-module-lexer` exposes the named binding from the `.cjs` build too.
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

/** @returns {Promise<Record<string, unknown>>} */
export async function loadQueries() {
  if (!existsSync(DB_ENTRY)) {
    throw new SqlCaptureError(
      `packages/db is not built: no dist/index.js. Run \`${BUILD_HINT}\` and try again`,
    );
  }
  return import(DB_ENTRY.href);
}

/**
 * @param {(unknown[][] | null)[]} rows
 * @param {number} index
 * @returns {unknown[][]}
 */
export function rowsForStatement(rows, index) {
  const configured = index < rows.length ? rows[index] : undefined;
  if (configured === null) return [];
  // One row, no columns: every field read off it is `undefined`, which is enough for a
  // probe-then-act helper to take its found-something branch.
  return configured ?? [[]];
}

/**
 * @param {Function} drizzle
 * @param {unknown} schema
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

  // The proxy driver refuses transactions outright, so the callback runs against the
  // same recording handle to capture a read-modify-write helper's statements in order.
  executor.transaction = /** @param {Function} run */ (run) => run(executor);

  // `db.execute` answers with a bare row array under the proxy driver and a `QueryResult` under the real
  // one, and helpers read `.rows`. This runs after `client` has recorded, so it never changes what was sent.
  const proxyExecute = /** @type {Function} */ (executor.execute).bind(executor);
  executor.execute = /** @param {unknown} query */ async (query) => {
    const result = await proxyExecute(query);
    return Array.isArray(result) ? { rows: result, rowCount: result.length } : result;
  };

  return { executor, statements };
}

/**
 * Every exported function, the candidate set `--list` prints. A `pgEnum` is callable, so enums are
 * dropped by the property that makes them enums rather than by name.
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
    // Trimmed only at the ends: a raw template arrives with the source file's leading
    // newline and closing indentation, and the internal shape is worth keeping.
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
 * @returns {Promise<number>}
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
    // The statements above are real; the helper simply could not get past them on the
    // rows it was given, so both halves are reported.
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
