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
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error - the gate is plain ESM tooling, deliberately untypechecked.
import {
  ALLOW_MARKER,
  blankComments,
  scanEnvExample,
  scanEnvNamesInBodies,
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

describe("the scanned roots cover the workspace they claim to", () => {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  /**
   * The gate reported "417 source files" while 59 tracked files were outside its
   * enumeration: 29 `packages/ui/**` TSX, 5 `apps/**` mjs, and every one of the
   * 24 `scripts/*.mjs` including the gate itself, because a `scripts/**\/*.mjs`
   * pathspec matches nothing when the files sit at the top level.
   *
   * This derives the expectation from what git actually tracks, so drift is a
   * red instead of a silence. It deliberately keeps its **own** copies of the
   * roots and extensions rather than importing `SOURCE_ROOTS` and
   * `SOURCE_EXTENSIONS`: importing them would make the test restate the
   * implementation and pass no matter what either says.
   */
  const EXECUTABLE = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
  const ROOTS = ["apps/", "packages/", "scripts/", "tooling/"];

  it("scans every tracked executable source file under apps, packages, scripts and tooling", () => {
    const tracked = execFileSync("/usr/bin/git", ["ls-files"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(
        (path: string) =>
          path !== "" &&
          existsSync(`${repoRoot}${path}`) &&
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
      "these tracked source files are outside SOURCE_ROOTS/SOURCE_EXTENSIONS in scripts/check-security-hygiene.mjs, so the gate never opens them",
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

describe("backtick concatenation, the evasion a quote-only alternation missed", () => {
  it.each([
    "await db.execute(`select * from forms where id = ` + id);",
    "await db.execute(prefix + `where 1=1`);",
    "await pool.query(`delete from answers where id = ` + id);",
  ])("flags %s", (line) => {
    expect(scanSql("probe.ts", line)).toHaveLength(1);
  });

  it("still leaves the sql tagged template alone, which is the safe form", () => {
    // The regression this guards: adding a backtick to the quote class must not
    // start flagging Drizzle's parameterizing template.
    expect(scanSql("probe.ts", "await exec.execute(sql`select ${a} from t`);")).toHaveLength(0);
    expect(scanSql("probe.ts", "await db.execute(sql`select 1`);")).toHaveLength(0);
  });
});

/**
 * ADR-24's widened rule, as a gate rather than a review catch (issue #910).
 *
 * The rule: no environment identifier may appear in an API response body. It was caught
 * by a reviewer twice in two weeks - the webhook refusal prose ending "set
 * QCMS_WEBHOOK_ALLOW_PRIVATE for on-prem targets" (issue #756) and the breach-check 503
 * ending "set QCMS_ADMIN_PASSWORD_BREACH_CHECK=false" (issue #910) - so these cases
 * plant each shape the gate must name, and, at least as important, the shapes it must
 * not, because the same file that must not ship a variable name to a client is full of
 * operator log lines and boot refusals that legitimately do.
 *
 * `label` is load-bearing in every case: the rule reads `apps/api/src/` only.
 */
describe("an environment identifier in a response body is refused", () => {
  /** A path inside the scanned root, so the rule engages at all. */
  const API = "apps/api/src/features/auth/instance.ts";

  it("names a variable spelled straight into a wire-shaped property", () => {
    const source =
      'throw new ApiError("x", 503, "");\nconst e = { message: "set QCMS_A=false" };\n';
    const hits = scanEnvNamesInBodies(API, source);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ file: API, line: 2, name: "QCMS_A" });
  });

  it("follows one hop through a named constant, which is how #910 hid", () => {
    // The exact shape of the defect: the literal is nowhere near the response, and a
    // scan of constructor arguments alone reads clean.
    const source = [
      'const FAILED = "... or set QCMS_ADMIN_PASSWORD_BREACH_CHECK=false ...";',
      'throw new APIError("SERVICE_UNAVAILABLE", { message: FAILED, code: "X" });',
    ].join("\n");

    const names = scanEnvNamesInBodies(API, source).map((hit) => hit.name);
    expect(names).toContain("QCMS_ADMIN_PASSWORD_BREACH_CHECK");
  });

  it("reads a positional message, which no property scan can see", () => {
    const source = 'throw new ApiError("refused", 422, "set QCMS_WEBHOOK_ALLOW_PRIVATE");';
    expect(scanEnvNamesInBodies(API, source)).toHaveLength(1);
  });

  it("is not fooled by a comma inside the sentence", () => {
    // The first version of this rule sliced a property value with `[^,}]*` and missed
    // the assist stream's "Try a smaller request, or raise QCMS_AGENT_MAX_STEPS." - the
    // comma in the English ended the slice before the variable.
    const source =
      '  const e = {\n    message:\n      "Try a smaller request, or raise QCMS_AGENT_MAX_STEPS.",\n  };\n';
    const hits = scanEnvNamesInBodies(API, source);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ name: "QCMS_AGENT_MAX_STEPS" });
  });

  it("names every hit rather than stopping at the first", () => {
    const source = [
      'const a = { message: "QCMS_ONE and QCMS_TWO" };',
      'const b = { reason: "QCMS_THREE" };',
    ].join("\n");

    expect(
      scanEnvNamesInBodies(API, source)
        .map((hit) => hit.name)
        .sort(),
    ).toEqual(["QCMS_ONE", "QCMS_THREE", "QCMS_TWO"]);
  });

  it("reports the line of the offending literal, not of the file", () => {
    const source = '\n\n\nconst e = { message: "QCMS_LATE" };\n';
    expect(scanEnvNamesInBodies(API, source)[0]).toMatchObject({ line: 4 });
  });
});

describe("the operator channels keep naming variables, because that is the point", () => {
  const API = "apps/api/src/features/auth/instance.ts";

  it("leaves a logger line alone", () => {
    const source =
      'const WARNING = "QCMS_ADMIN_SIGNIN_THROTTLE is set to a false value";\nlogger.warn(WARNING, fields);';
    expect(scanEnvNamesInBodies(API, source)).toHaveLength(0);
  });

  it("leaves a boot refusal alone", () => {
    // `config.ts` raises these before the process serves a request, so no client exists
    // to receive one. Twelve of them, none of which may start needing a waiver.
    const source = "issues.push(`QCMS_AGENT_MODEL is required when QCMS_FLAG_AGENT_AUTHORING=x`);";
    expect(scanEnvNamesInBodies(API, source)).toHaveLength(0);
  });

  it("leaves a CLI line and a bare environment read alone", () => {
    const cli = 'process.stderr.write("Set QCMS_ADMIN_EMAIL and QCMS_ADMIN_PASSWORD\\n");';
    const read = 'const HOPS_ENV = "QCMS_ADMIN_TRUSTED_PROXY_HOPS";\nconst v = env[HOPS_ENV];';
    expect(scanEnvNamesInBodies(API, cli)).toHaveLength(0);
    expect(scanEnvNamesInBodies(API, read)).toHaveLength(0);
  });

  it("does not read a TypeScript parameter annotation as a body", () => {
    // `warn: (message: string) => void,` has a `message:` and then a `)` before any
    // comma. An earlier version let the value slice run negative on that bracket and
    // swallow the rest of the file, reporting every variable named anywhere in it.
    const source = [
      "export interface Input {",
      "  readonly warn?: (message: string) => void;",
      "}",
      'const WARNING = "QCMS_SOMETHING is off";',
    ].join("\n");
    expect(scanEnvNamesInBodies(API, source)).toHaveLength(0);
  });

  it("ignores a variable named in a comment, including its own documentation", () => {
    const source = [
      "/** Why QCMS_ADMIN_PASSWORD_BREACH_CHECK must not appear in a body. */",
      '// message: "set QCMS_ADMIN_PASSWORD_BREACH_CHECK=false"',
      'const e = { message: "the check is unavailable" };',
    ].join("\n");
    expect(scanEnvNamesInBodies(API, source)).toHaveLength(0);
  });

  it("reads only apps/api/src, where the response bodies are", () => {
    const source = 'const e = { message: "QCMS_A" };';
    expect(scanEnvNamesInBodies("apps/admin/lib/forms/assist-stream.ts", source)).toHaveLength(0);
    expect(scanEnvNamesInBodies("scripts/env-reference.mjs", source)).toHaveLength(0);
    expect(scanEnvNamesInBodies("apps/api/src/x.ts", source)).toHaveLength(1);
  });

  it("takes a waiver on the line above, like the rules beside it", () => {
    const source = `  // ${ALLOW_MARKER} a fixture, not a body\n  const e = { message: "QCMS_A" };\n`;
    expect(scanEnvNamesInBodies("apps/api/src/x.ts", source)).toHaveLength(0);
  });
});

describe("comments are blanked without moving a single character", () => {
  it("keeps the offsets and line numbers identical, which the waiver depends on", () => {
    const source = 'const a = 1; // QCMS_A\n/* QCMS_B */ const b = "QCMS_C";\n';
    const blanked = blankComments(source);

    expect(blanked).toHaveLength(source.length);
    expect(blanked.split("\n")).toHaveLength(source.split("\n").length);
    expect(blanked).not.toContain("QCMS_A");
    expect(blanked).not.toContain("QCMS_B");
    // The string literal survives: that is the half the rule is about.
    expect(blanked).toContain("QCMS_C");
  });

  it("does not mistake a slash inside a string for the start of a comment", () => {
    // "http://" appears throughout this repository's prose and URLs, and a regex that
    // blanked from the first `//` would eat the rest of the line - including, in the
    // real file, the variable name the rule exists to find.
    const blanked = blankComments('const e = { message: "see http://x/ QCMS_A" };');
    expect(blanked).toContain("QCMS_A");
  });

  it("does not mistake an apostrophe in prose for an opening quote", () => {
    // The failure this prevents is silent and total: a comment containing "process's"
    // would open a string that never closes, and every literal after it in the file
    // would be read as comment text and skipped.
    const source = ["// this process's environment", 'const e = { message: "QCMS_A" };'].join("\n");
    expect(scanEnvNamesInBodies("apps/api/src/x.ts", source)).toHaveLength(1);
  });
});
