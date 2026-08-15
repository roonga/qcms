/**
 * Self-test for the SEC-8 hygiene gate (task 040).
 *
 * A gate nobody has seen refuse anything is not a gate. These cases feed it the
 * violations it exists to catch, one shape at a time, and pin the shapes it must
 * *not* flag: the repo's real logging vocabulary (`questionId`, counts, request
 * metadata) has to keep passing, or the gate gets waived into uselessness on its
 * first false positive.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error - the gate is plain ESM tooling, deliberately untypechecked.
import {
  ALLOW_MARKER,
  scanEnvExample,
  scanSource,
  scanSql,
  sourceFiles,
  TEST_FILE,
} from "./check-security-hygiene.mjs";

describe("answer-content logging is refused", () => {
  it.each([
    ['logger.info("answered", { answer });', "answer"],
    ['deps.logger.info("answered", { questionId, value });', "value"],
    ['logger.warn("submit failed", { payload: event.payload });', "payload"],
    ['info("outbox", { body: request.body });', "body"],
    ['logger.error("bad answer", { answers: session.answers });', "answers"],
  ])("flags %s", (line, key) => {
    const hits = scanSource("probe.ts", line);
    expect(hits).toHaveLength(1);
    expect(hits[0].key.toLowerCase()).toBe(key);
  });

  it("reports the line number so the failure is actionable", () => {
    const hits = scanSource("probe.ts", '\n\n\nlogger.info("x", { answers });\n');
    expect(hits[0].line).toBe(4);
  });

  it("honours an explicit waiver on the line above", () => {
    const source = `// ${ALLOW_MARKER} fixture echo, not respondent data\nlogger.info("x", { answers });\n`;
    expect(scanSource("probe.ts", source)).toHaveLength(0);
  });
});

describe("the repository's real logging vocabulary keeps passing", () => {
  it.each([
    'logger.info("request", { requestId, method, path, status, durationMs });',
    'logger.info("retention sweep", { expiredCount });',
    'logger.warn("handled error", { requestId, code, status });',
    'logger.info("outbox delivery pass", { ...metrics });',
    'logger.info("listening", { port, mount, tracing });',
    'logger.warn("skipped", { questionId, visibleQuestions: ids.length });',
  ])("does not flag %s", (line) => {
    expect(scanSource("probe.ts", line)).toHaveLength(0);
  });

  it("ignores a non-logging call that happens to be named info", () => {
    expect(scanSource("probe.ts", "const x = table.info({ value: 1 });")).toHaveLength(0);
  });
});

describe("example env files must carry placeholders, not secrets", () => {
  it.each([
    "QCMS_APP_KEY=8f2c1a9e4b7d6053a1c8e2f4b6d80917",
    "QCMS_INTERNAL_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "QCMS_DB_PASSWORD=hunter2-but-longer-and-real-looking",
  ])("flags a live-looking value: %s", (line) => {
    const hits = scanEnvExample(".env.example", line);
    expect(hits).toHaveLength(1);
  });

  it.each([
    "QCMS_APP_KEY=replace-with-a-random-32-character-app-encryption-key",
    "QCMS_INTERNAL_TOKEN=replace-with-a-32-char-plus-internal-token",
    "QCMS_ADMIN_AUTH_SECRET=<from your secret store>",
    "# QCMS_APP_KEY=anything-at-all-in-a-comment",
    "QCMS_ADMIN_AUTH_SECRET=",
  ])("accepts a placeholder or comment: %s", (line) => {
    expect(scanEnvExample(".env.example", line)).toHaveLength(0);
  });

  it("ignores non-secret variables entirely", () => {
    expect(scanEnvExample(".env.example", "QCMS_PORTAL_BASE_URL=http://localhost:7000")).toEqual(
      [],
    );
  });
});

describe("unparameterized SQL is refused", () => {
  it.each([
    "await exec.execute(sql.raw(`select * from answers where id = '${id}'`));",
    "await pool.query(`select * from sessions where id = '${sessionId}'`);",
    "await client.execute(`delete from answers where value = '${answer}'`);",
  ])("flags %s", (line) => {
    expect(scanSql("probe.ts", line)).toHaveLength(1);
  });

  it.each([
    "await exec.execute(sql`select set_config(${SETTING}, 'on', true)`);",
    "const clause = sql`${outbox.payload} ->> 'sessionId' = ${sessionId}`;",
    "await pool.query('select 1');",
    "await db.select().from(answers).where(eq(answers.sessionId, sessionId));",
  ])("does not flag the parameterized form: %s", (line) => {
    expect(scanSql("probe.ts", line)).toHaveLength(0);
  });

  it("honours a waiver on the line above", () => {
    const source = `// ${ALLOW_MARKER} migration DDL, no user input\nawait exec.execute(sql.raw(ddl));\n`;
    expect(scanSql("probe.ts", source)).toHaveLength(0);
  });
});

describe("SQL concatenation, the form a regex can reach", () => {
  it.each([
    'await db.execute("select * from forms where id = \'" + id + "\'");',
    "await pool.query('delete from answers where id = ' + id);",
    'await db.execute(prefix + " where 1=1");',
    "await client.query(base + '; drop table answers');",
  ])("flags %s", (line) => {
    expect(scanSql("probe.ts", line)).toHaveLength(1);
  });

  it.each([
    "await exec.execute(sql`select set_config(${SETTING}, 'on', true)`);",
    "await pool.query('select 1');",
    'await db.execute("select 1");',
    "const total = pageSize + 1;",
    "await db.select().from(answers).where(eq(answers.sessionId, sessionId));",
  ])("does not flag the safe form: %s", (line) => {
    expect(scanSql("probe.ts", line)).toHaveLength(0);
  });

  it("documents the form it cannot reach, so the gap is visible rather than assumed", () => {
    // A statement assembled elsewhere and passed by variable needs data-flow
    // analysis, not a regex. Asserted as a KNOWN LIMITATION: if a future change
    // makes this detectable, this test fails and the module comment gets
    // updated with it, rather than the claim quietly outrunning the check.
    const assembledElsewhere = "const q = base + id;\nawait db.execute(q);";
    expect(scanSql("probe.ts", assembledElsewhere)).toHaveLength(0);
  });
});

describe("the source globs cover the workspace they claim to", () => {
  /**
   * The gate reported "417 source files" while 34 tracked files, 29 of them
   * `packages/ui/**` TSX, were outside every glob. A list of globs maintained by
   * memory drifts the moment a new file type lands; this derives the expectation
   * from what git actually tracks, so the drift is a red instead of a silence.
   */
  const EXECUTABLE = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
  const ROOTS = ["apps/", "packages/", "scripts/", "tooling/"];

  it("scans every tracked executable source file under apps, packages, scripts and tooling", () => {
    const tracked = execFileSync("/usr/bin/git", ["ls-files"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    })
      .split("\n")
      .filter(
        (path: string) =>
          path !== "" &&
          ROOTS.some((root) => path.startsWith(root)) &&
          EXECUTABLE.test(path) &&
          !TEST_FILE.test(path),
      );

    const scanned = new Set<string>(sourceFiles());
    // The gate skips only itself, because it quotes the constructs it hunts.
    const missed = tracked.filter(
      (path: string) => !scanned.has(path) && path !== "scripts/check-security-hygiene.mjs",
    );
    expect(
      missed,
      "these tracked source files are outside every SOURCE_GLOBS entry, so the gate never opens them",
    ).toEqual([]);
  });

  it("has a non-trivial file count, so an empty scan cannot pass as full coverage", () => {
    expect(sourceFiles().length).toBeGreaterThan(400);
  });

  it("opens files in every root it claims, not just the ones with subdirectories", () => {
    // The original globs used `scripts/**` pathspecs, which matched nothing at
    // all because git fnmatch still wants an intervening directory - so an
    // entire root went unscanned while the file count looked healthy. Asserting
    // per-root presence is what makes that shape impossible to reintroduce.
    const scanned = sourceFiles();
    for (const root of ["apps/", "packages/", "scripts/"]) {
      expect(
        scanned.some((path: string) => path.startsWith(root)),
        `no file under ${root} is scanned`,
      ).toBe(true);
    }
  });
});
