/**
 * Self-test for the SEC-8 hygiene gate (task 040).
 *
 * A gate nobody has seen refuse anything is not a gate. These cases feed it the
 * violations it exists to catch, one shape at a time, and pin the shapes it must
 * *not* flag: the repo's real logging vocabulary (`questionId`, counts, request
 * metadata) has to keep passing, or the gate gets waived into uselessness on its
 * first false positive.
 */

import { describe, expect, it } from "vitest";

// @ts-expect-error - the gate is plain ESM tooling, deliberately untypechecked.
import { ALLOW_MARKER, scanEnvExample, scanSource, scanSql } from "./check-security-hygiene.mjs";

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
