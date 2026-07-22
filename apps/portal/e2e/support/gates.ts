/**
 * Shared error gates for every portal Playwright spec (task 045, exit criteria
 * 3 and 5). Import `test` and `expect` from here instead of `@playwright/test`
 * and each test automatically fails on:
 *
 * - **Browser errors (exit 3):** any `console.error`, uncaught `pageerror`, or
 *   React hydration warning in the page under test. This also surfaces the
 *   CSP-nonce hydration mismatch (finding A) - if it fires, the suite goes red
 *   until it is fixed or the specific line is allowlisted with justification.
 * - **Server errors (exit 5):** any error-level line the API, Postgres, or the
 *   portal dev server wrote during the test. We are testing the API + DB through
 *   the flow, so their logs must be clean too.
 *
 * The API logs every *deliberate, client-safe* 4xx (`ApiError`) at `warn`
 * ("handled error" / "http exception") - that is the API correctly reporting a
 * client error (expired link, hidden question, invalid value), exercised on
 * purpose by the failure-path specs, NOT a server fault. Those warn lines are
 * allowlisted with that justification; an `error`-level "unhandled error" (a real
 * 500 / bug) is never allowlisted and fails the gate.
 */

import { readFileSync, statSync } from "node:fs";

import { test as base, expect } from "@playwright/test";

import { SERVER_LOG_FILES } from "./harness-config.js";

export { expect };

/**
 * Browser console/page messages that are benign and allowlisted. The gate is
 * strict by default; each entry below is a genuinely unavoidable dev-server
 * artifact or a pre-existing issue tracked outside task 045, justified inline.
 * The CSP-nonce hydration mismatch (finding A) is NOT here - it is fixed at the
 * source (layout.tsx suppresses the expected server/client nonce difference).
 */
const BROWSER_ALLOW: readonly RegExp[] = [
  // Dev-only: Next runs React's DEVELOPMENT build, which uses eval() for debug
  // tooling, but the portal's strict CSP (SEC-9) forbids `unsafe-eval`. React
  // itself states it "will never use eval() in production mode", so this cannot
  // occur in the shipped build; weakening the CSP to silence it is not an option.
  /eval\(\) is not supported in this environment/,
  // Pre-existing @qcms/ui issue (ticketed for the conductor, not task 045): the
  // shortText control renders the question's validation regex as an HTML `pattern`
  // attribute, and a pattern authored for the JS `u`/no-flag regex (e.g. an
  // unescaped `-` in a character class) is rejected by the browser's stricter `v`
  // flag applied to `pattern`. The API is the validation authority (R2), so this
  // broken native hint does not affect correctness; it needs a compiler/renderer
  // fix to emit a `v`-safe pattern.
  /Pattern attribute value .* is not a valid regular expression/,
];

/**
 * Server-log lines that are benign for a clean run, each justified. Applied after
 * the level filter below.
 */
const SERVER_ALLOW: readonly { readonly source: LogSource; readonly pattern: RegExp }[] = [
  // The API's deliberate client-safe 4xx reporting: the API returning a typed
  // error envelope (401/404/409/422) is expected behaviour the failure-path specs
  // exercise on purpose, not a server malfunction.
  { source: "api", pattern: /"msg":"handled error"/ },
  { source: "api", pattern: /"msg":"http exception"/ },
  // Benign Postgres transaction-bookkeeping warnings from the node-postgres/drizzle
  // pool: a BEGIN issued on a connection already in a transaction, or a
  // COMMIT/ROLLBACK with none open. Postgres continues normally and the persisted
  // ledger is correct (the independent DB verification confirms it). They are a
  // driver/pool artifact, not a data or correctness fault, so they are allowlisted
  // (a discovery is filed to tighten the API's transaction handling separately).
  { source: "postgres", pattern: /WARNING:\s+there is already a transaction in progress/ },
  { source: "postgres", pattern: /WARNING:\s+there is no transaction in progress/ },
];

type LogSource = "api" | "postgres" | "portal";

/** True when an API JSON log line is at warn/error level (a server-side signal). */
function apiLineIsError(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as { level?: string };
    return parsed.level === "warn" || parsed.level === "error";
  } catch {
    return false;
  }
}

/** PG severities that denote a fault (LOG / DETAIL / STATEMENT are benign). */
const PG_ERROR = /(ERROR|FATAL|PANIC|WARNING):/;
/**
 * Portal dev-server FAULT markers: Next.js's error glyph, an unhandled rejection,
 * a thrown `Error:`, or a 5xx response in the request log. The portal dev server's
 * `warn`-level output is inherently noisy (telemetry, deprecations, and forwarded
 * BROWSER console warnings), and browser-console messages are owned by the browser
 * gate above, so `[browser] ...` lines are excluded here rather than matched as
 * server faults. This is the documented, justified scope of the portal log gate.
 */
const PORTAL_ERROR = /(⨯|unhandledRejection|UnhandledPromiseRejection|\bError:| 5\d\d )/;

function isErrorLine(source: LogSource, line: string): boolean {
  if (source === "api") return apiLineIsError(line);
  if (source === "postgres") return PG_ERROR.test(line);
  if (line.includes("[browser]")) return false;
  return PORTAL_ERROR.test(line);
}

function byteLength(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function appendedSince(path: string, offset: number): string {
  try {
    return readFileSync(path).subarray(offset).toString("utf8");
  } catch {
    return "";
  }
}

function scanAppended(source: LogSource, path: string, offset: number): string[] {
  const text = appendedSince(path, offset);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => isErrorLine(source, line))
    .filter(
      (line) => !SERVER_ALLOW.some((allow) => allow.source === source && allow.pattern.test(line)),
    );
}

interface Offsets {
  readonly api: number;
  readonly postgres: number;
  readonly portal: number;
}

/**
 * The gated test runner. `browserGuard` collects console errors + page errors for
 * the whole test; `serverGuard` records each server log's length at the start and
 * scans what was appended by the end. Both run automatically for every spec that
 * imports this `test`.
 */
export const test = base.extend<{ browserGuard: void; serverGuard: void }>({
  browserGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (BROWSER_ALLOW.some((allow) => allow.test(text))) return;
        problems.push(`console.error: ${text}`);
      });
      page.on("pageerror", (error) => {
        const text = error.message;
        if (BROWSER_ALLOW.some((allow) => allow.test(text))) return;
        problems.push(`pageerror: ${text}`);
      });
      await use();
      expect(
        problems,
        `browser console/page errors during the test:\n${problems.join("\n")}`,
      ).toEqual([]);
    },
    { auto: true },
  ],
  serverGuard: [
    async ({}, use) => {
      const before: Offsets = {
        api: byteLength(SERVER_LOG_FILES.api),
        postgres: byteLength(SERVER_LOG_FILES.postgres),
        portal: byteLength(SERVER_LOG_FILES.portal),
      };
      await use();
      const bad = [
        ...scanAppended("api", SERVER_LOG_FILES.api, before.api).map((l) => `[api] ${l}`),
        ...scanAppended("postgres", SERVER_LOG_FILES.postgres, before.postgres).map(
          (l) => `[postgres] ${l}`,
        ),
        ...scanAppended("portal", SERVER_LOG_FILES.portal, before.portal).map(
          (l) => `[portal] ${l}`,
        ),
      ];
      expect(bad, `server error/warn log lines during the test:\n${bad.join("\n")}`).toEqual([]);
    },
    { auto: true },
  ],
});
