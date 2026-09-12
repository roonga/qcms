import { existsSync } from "node:fs";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  BUILD_HINT,
  DB_ENTRY,
  STATEMENT_LIMIT,
  SqlCaptureError,
  capture,
  createRecordingExecutor,
  exportedFunctions,
  formatCapture,
  loadQueries,
  main,
  parseArgs,
  parseRows,
  resolveQueryBuilder,
  reviveArgs,
  rowsForStatement,
} from "./sql-capture.mjs";

/**
 * The Drizzle SQL capture (issue #854).
 *
 * Every assertion below that matters is made against a **real** query helper from
 * `@roonga/qcms-db` rather than a fixture chain written here. A fixture would only
 * prove that Drizzle renders what Drizzle renders; what this script has to be right
 * about is the shapes this repository actually writes - a select with a compound
 * `where`, an order and a row lock; an insert with defaults and a `returning`; an
 * update; a read-modify-write inside a transaction; a raw `sql` template executed
 * through `db.execute`; and the correlated anti-join in `queries/outbox.ts`, which is
 * the statement the tool exists to make readable.
 *
 * These run against the built package. `pnpm test` builds before it tests (turbo's
 * `test` task depends on `build`, and CI runs `pnpm build` first besides), so the
 * guard below is for the one case that skips both: `pnpm test:tooling` on a checkout
 * that has never been built.
 */

beforeAll(() => {
  if (!existsSync(DB_ENTRY)) {
    throw new Error(`packages/db is not built; run \`${BUILD_HINT}\` before this suite`);
  }
});

const AT = { $date: "2026-03-01T00:00:00.000Z" };
const ISO = "2026-03-01T00:00:00.000Z";
const OUTBOX_ID = "0198c0de-0000-7000-8000-000000000001";

/** Run `main` and capture what it printed, so exit code and output are asserted together. */
async function run(args: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    out.push(String(parts[0]));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    err.push(String(parts[0]));
  });
  try {
    return { code: await main(args), out, err };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("capture, against real query helpers", () => {
  it("renders a select with a compound where, an order, a limit and a row lock", async () => {
    const result = await capture({ name: "claimDue", args: [25, new Date(ISO)] });

    expect(result.statements).toHaveLength(1);
    const [statement] = result.statements;
    expect(statement.sql).toContain('from "outbox"');
    expect(statement.sql).toContain('"outbox"."delivered_at" is null');
    expect(statement.sql).toContain('"outbox"."payload_redacted_at" is null');
    expect(statement.sql).toContain('"outbox"."next_attempt_at" <= $1');
    expect(statement.sql).toContain('order by "outbox"."next_attempt_at" asc');
    expect(statement.sql).toContain("limit $2");
    expect(statement.sql).toContain("for update skip locked");
    expect(statement.params).toEqual([ISO, 25]);
  });

  it("renders an insert with its column defaults and its returning list", async () => {
    const result = await capture({
      name: "createSession",
      args: [
        {
          sessionId: "ses_01",
          formId: "frm_01",
          formVersion: 3,
          accessMode: "secure_link",
          expiresAt: new Date(ISO),
          linkId: "lnk_01",
        },
      ],
    });

    expect(result.statements).toHaveLength(1);
    const [statement] = result.statements;
    expect(statement.sql).toContain('insert into "sessions"');
    // `status` and `created_at` are column defaults, so they are `default` in the
    // values list rather than parameters. That distinction is invisible in the builder.
    expect(statement.sql).toContain("values ($1, $2, $3, $4, $5, default, $6, default)");
    expect(statement.sql).toContain('returning "session_id"');
    expect(statement.params).toEqual(["ses_01", "frm_01", 3, "secure_link", "lnk_01", ISO]);
  });

  it("renders an update with its where and returning", async () => {
    const result = await capture({ name: "markDelivered", args: [OUTBOX_ID, new Date(ISO)] });

    expect(result.statements).toHaveLength(1);
    const [statement] = result.statements;
    expect(statement.sql).toContain('update "outbox" set "delivered_at" = $1');
    expect(statement.sql).toContain('where "outbox"."id" = $2');
    expect(statement.sql).toContain("returning");
    expect(statement.params).toEqual([ISO, OUTBOX_ID]);
  });

  it("renders the outbox retention anti-join, both statements", async () => {
    const result = await capture({
      name: "redactAgedOutboxPayloads",
      args: [new Date(ISO)],
      rows: [[[OUTBOX_ID]]],
    });

    expect(result.statements).toHaveLength(2);
    const [probe, update] = result.statements;

    expect(probe.sql).toContain('select "id" from "outbox"');
    expect(probe.sql).toContain('jsonb_exists("outbox"."payload", \'answers\')');
    expect(probe.sql).toContain(
      'greatest("outbox"."delivered_at", "outbox"."dead_lettered_at") < $1',
    );

    // The list binds as ONE array parameter, not one placeholder per id. That is a
    // comment in `queries/outbox.ts`, and this is the statement that proves it.
    expect(update.sql).toContain('"outbox"."id" = any($1::uuid[])');
    expect(update.params[0]).toEqual([OUTBOX_ID]);
    // The correlation lives inside the subquery, and the `or` is parenthesised.
    expect(update.sql).toContain('not exists (select 1 from "webhook_deliveries" "d"');
    expect(update.sql).toContain('"d"."outbox_id" = "outbox"."id"');
    expect(update.sql).toContain(
      'greatest("d"."delivered_at", "d"."dead_lettered_at", "d"."cancelled_at") is null or',
    );
    expect(update.sql).toContain('payload_redacted_at" = now()');
  });

  it("renders both halves of a read-modify-write that runs inside a transaction", async () => {
    const result = await capture({
      name: "recordFailure",
      args: [OUTBOX_ID, "connect ETIMEDOUT", new Date(ISO)],
      rows: [[[3]]],
    });

    expect(result.statements).toHaveLength(2);
    const [read, write] = result.statements;
    expect(read.sql).toContain('select "attempts" from "outbox"');
    expect(read.sql).toContain("for update");
    expect(write.sql).toContain('update "outbox" set "attempts" = $1');
    // Backoff arithmetic done on the row the probe returned: the fourth attempt is due
    // 125 minutes later, and 4 is short of the dead-letter threshold.
    expect(write.params.slice(0, 3)).toEqual([4, "2026-03-01T02:05:00.000Z", null]);
  });

  it("renders a raw sql template executed through db.execute, parameters and all", async () => {
    const result = await capture({
      name: "listResponses",
      args: [{ formId: "frm_01", status: "submitted", limit: 25, offset: 0 }],
    });

    expect(result.statements).toHaveLength(2);
    const [page, total] = result.statements;
    expect(page.sql).toContain("from reporting.responses r");
    expect(page.sql).toContain("where r.form_id = $1");
    expect(page.sql).toContain("order by r.submitted_at desc, r.session_id desc");
    expect(page.sql).toContain("limit $2 offset $3");
    expect(page.params).toEqual(["frm_01", 25, 0]);
    expect(total.sql).toContain('count(*)::int as "total"');
  });

  it("returns one row with no columns per statement when no rows are configured", async () => {
    // Without a default row the probe comes back empty and the sweep returns early, so
    // the anti-join - the statement worth reading - would never be issued.
    const result = await capture({ name: "redactAgedOutboxPayloads", args: [new Date(ISO)] });

    expect(result.statements).toHaveLength(2);
    // The default row carries no columns, so the id the sweep read back is `undefined`
    // and the array parameter it binds says so. Real values come from `--rows`.
    expect(result.statements[1].params[0]).toEqual([undefined]);
  });
});

describe("refusals", () => {
  it("refuses an export that does not exist, naming it", async () => {
    await expect(capture({ name: "claimDueish" })).rejects.toThrow(
      /no export named 'claimDueish' in @roonga\/qcms-db/,
    );
  });

  it("refuses an export that is not a function, naming it", async () => {
    await expect(capture({ name: "outbox" })).rejects.toThrow(
      /'outbox' is not a query builder: the export is of type object/,
    );
  });

  it("refuses a function that issues no statement, naming it", async () => {
    // `backoffDelayMs` is a pure schedule calculation that happens to be exported
    // beside the helpers. Printing "0 statements" for it would read like a query
    // builder that generates no SQL.
    await expect(capture({ name: "backoffDelayMs", args: [3] })).rejects.toThrow(
      /'backoffDelayMs' is not a query builder: it ran without issuing a statement/,
    );
  });

  it("reports what it captured when a helper throws part way through", async () => {
    // No rows at all, so `recordFailure` reads `undefined` for `attempts` and computes
    // an invalid date. The first statement is still real and still printed.
    const { code, out, err } = await run([
      "recordFailure",
      "--args",
      JSON.stringify([OUTBOX_ID, "boom"]),
      "--rows",
      JSON.stringify([[[]]]),
    ]);

    expect(code).toBe(1);
    expect(out.join("\n")).toContain('select "attempts" from "outbox"');
    expect(err.join("\n")).toMatch(/threw after 1 statement/);
  });

  it("stops rather than looping when a helper reads until it finds nothing", () => {
    let client: ((sql: string, params: unknown[]) => unknown) | undefined;
    const fakeDrizzle = (callback: (sql: string, params: unknown[]) => unknown): unknown => {
      client = callback;
      return { execute: () => Promise.resolve([]) };
    };

    const { statements } = createRecordingExecutor(fakeDrizzle, {}, []);
    for (let i = 0; i < STATEMENT_LIMIT; i += 1) client?.(`select ${String(i)}`, []);

    expect(statements).toHaveLength(STATEMENT_LIMIT);
    expect(() => client?.("select once more", [])).toThrow(SqlCaptureError);
    expect(() => client?.("select once more", [])).toThrow(/stopped after 50 statements/);
  });
});

describe("parseArgs", () => {
  it("reads an export name, --args and --rows in either spelling", () => {
    const parsed = parseArgs(["claimDue", "--args=[10]", "--rows", "[null]"]);
    expect(parsed.name).toBe("claimDue");
    expect(parsed.args).toEqual([10]);
    expect(parsed.rows).toEqual([null]);
    expect(parsed.list).toBe(false);
  });

  it("accepts --list without an export name", () => {
    expect(parseArgs(["--list"])).toMatchObject({ list: true, name: undefined });
  });

  it("refuses an empty invocation, an unknown option and a second positional", () => {
    expect(() => parseArgs([])).toThrow(/usage: pnpm sql:capture/);
    expect(() => parseArgs(["claimDue", "--explain"])).toThrow(/unknown option: --explain/);
    expect(() => parseArgs(["claimDue", "enqueue"])).toThrow(/unexpected argument: enqueue/);
    expect(() => parseArgs(["claimDue", "--args"])).toThrow(/--args requires a value/);
    expect(() => parseArgs(["claimDue", "--args", "{"])).toThrow(/--args is not valid JSON/);
    expect(() => parseArgs(["claimDue", "--args", "10"])).toThrow(/--args must be a JSON array/);
  });
});

describe("reviveArgs", () => {
  it("promotes a tagged date and leaves an ISO-shaped string alone", () => {
    const revived = reviveArgs({ at: AT, note: ISO, nested: [{ $date: ISO }] }) as {
      at: unknown;
      note: unknown;
      nested: unknown[];
    };
    expect(revived.at).toBeInstanceOf(Date);
    expect((revived.at as Date).toISOString()).toBe(ISO);
    expect(revived.note).toBe(ISO);
    expect(revived.nested[0]).toBeInstanceOf(Date);
  });

  it("refuses a tag that is not a date", () => {
    expect(() => reviveArgs({ $date: "not a date" })).toThrow(SqlCaptureError);
  });
});

describe("parseRows", () => {
  it("accepts a per-statement list of rows and null for none", () => {
    expect(parseRows([null, [[1, "a"]], []])).toEqual([null, [[1, "a"]], []]);
  });

  it("refuses anything that is not rows of columns", () => {
    expect(() => parseRows("[]")).toThrow(/--rows must be a JSON array/);
    expect(() => parseRows([[1]])).toThrow(/--rows\[0\] must be null or an array of rows/);
  });
});

describe("rowsForStatement", () => {
  it("falls back to one row with no columns and honours an explicit empty", () => {
    expect(rowsForStatement([], 0)).toEqual([[]]);
    expect(rowsForStatement([null], 0)).toEqual([]);
    expect(rowsForStatement([[[7]]], 0)).toEqual([[7]]);
    expect(rowsForStatement([[[7]]], 1)).toEqual([[]]);
  });
});

describe("the exported surface", () => {
  it("lists query helpers and drops the schema's callable enums", async () => {
    const names = exportedFunctions(await loadQueries());
    expect(names).toContain("claimDue");
    expect(names).toContain("redactAgedOutboxPayloads");
    // `pgEnum` returns a callable, so `accessMode` and `sessionStatus` would otherwise
    // sit in this list looking like helpers.
    expect(names).not.toContain("accessMode");
    expect(names).not.toContain("sessionStatus");
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
  });

  it("resolves a helper by name", async () => {
    expect(typeof resolveQueryBuilder(await loadQueries(), "claimDue")).toBe("function");
  });
});

describe("formatCapture", () => {
  it("numbers the statements, trims the ends and lists the parameters", () => {
    const lines = formatCapture({
      name: "example",
      statements: [
        { sql: "\n  select 1 where a = $1\n  ", params: ["x"] },
        { sql: "select 2", params: [] },
      ],
    });

    expect(lines[0]).toBe("example: 2 statements");
    expect(lines).toContain("-- statement 1");
    expect(lines).toContain("select 1 where a = $1");
    expect(lines).toContain('$1 = "x"');
    expect(lines).toContain("-- no parameters");
  });
});

describe("main", () => {
  it("prints a capture and exits 0", async () => {
    const { code, out, err } = await run(["claimDue", "--args", JSON.stringify([10, AT])]);

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out[0]).toBe("claimDue: 1 statement");
    expect(out.join("\n")).toContain("for update skip locked");
    expect(out.join("\n")).toContain(`$1 = "${ISO}"`);
  });

  it("prints the candidate list for --list", async () => {
    const { code, out } = await run(["--list"]);
    expect(code).toBe(0);
    expect(out).toContain("enqueue");
  });

  it("exits 1 with a named reason on stderr", async () => {
    const { code, out, err } = await run(["nope"]);
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toMatch(/^sql-capture: no export named 'nope'/);
  });
});
