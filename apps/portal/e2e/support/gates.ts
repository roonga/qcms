/**
 * Shared error gates for every portal Playwright spec (task 045, exit criteria
 * 3 and 5). Import `test` and `expect` from here instead of `@playwright/test`
 * and each test automatically fails on:
 *
 * - **Browser errors (exit 3):** any `console.error`, uncaught `pageerror`, or
 *   React hydration warning in the page under test. If one fires, the suite goes
 *   red until it is fixed at the source; an allowlist entry is a last resort and
 *   needs the justification written inline next to it.
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
 * Nothing about the CSP nonce is here and nothing about it may be added (issue
 * #20): the nonce chain is asserted positively in `csp-nonce.pw.ts`, and the one
 * spurious warning it would otherwise raise (browser nonce hiding blanks the
 * `nonce` attribute React hydrates against) is handled at the source, on that
 * single element, in `app/layout.tsx`.
 */
const BROWSER_ALLOW: readonly RegExp[] = [
  // Dev-only: Next runs React's DEVELOPMENT build, which uses eval() for debug
  // tooling, but the portal's strict CSP (SEC-9) forbids `unsafe-eval`. React
  // itself states it "will never use eval() in production mode", so this cannot
  // occur in the shipped build; weakening the CSP to silence it is not an option.
  /eval\(\) is not supported in this environment/,
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
  // The Next dev server logs `Error: aborted` when a request is cancelled
  // client-side (the browser aborts an in-flight fetch/navigation). The throttled
  // mobile spec provokes this by design: under a simulated slow connection a
  // request can still be in flight when the page navigates on, so the client
  // aborts it. It is a client abort, not a server fault - the flow completes and
  // the independent DB verification confirms the persisted answers - so it is
  // allowlisted rather than allowed to false-positive the server-log gate.
  { source: "portal", pattern: /\bError: aborted\b/ },
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
 * Portal dev-server FAULT markers: Next.js's error glyph, an unhandled rejection
 * or uncaught exception, a thrown `*Error:`, or a 5xx response in the request log.
 * The portal dev server's `warn`-level output is inherently noisy (telemetry,
 * deprecations, and forwarded BROWSER console warnings), and browser-console
 * messages are owned by the browser gate above, so `[browser] ...` lines are
 * excluded here rather than matched as server faults. This is the documented,
 * justified scope of the portal log gate.
 *
 * Two spellings this used to miss (issue #120), both covered by `gates.test.ts`:
 *
 * - `\w*Error:` rather than `\bError:`. There is no word boundary between `e` and
 *   `E` in `RangeError`, so the old alternative matched a bare `Error:` but no
 *   subclass name: `RangeError:`, `TypeError:`, `ReferenceError:` and
 *   `SyntaxError:` all slipped through. `\w*` only ever extends the match
 *   leftwards over word characters, so it can add a prefix to `Error:` but cannot
 *   loosen the trailing colon: `Errors:` in prose and a question label containing
 *   the word "error" still do not match, and neither does lower-case `error:`.
 * - `Unhandled Rejection:` / `Uncaught Exception:` (space, title case, colon) are
 *   what Node prints when a handler is installed, which is precisely the case
 *   where the process survives and only a log gate can notice. These are the same
 *   two prefixes `portal-server.mjs` treats as fatal at startup (issue #58);
 *   `unhandledRejection` and `UnhandledPromiseRejection` stay for the spellings
 *   the bare runtime uses.
 */
const PORTAL_ERROR =
  /(⨯|unhandledRejection|UnhandledPromiseRejection|Unhandled Rejection:|Uncaught Exception:|\b\w*Error:| 5\d\d )/;

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

/**
 * Every fault line a source appended to its log after `offset`: the exact set the
 * `serverGuard` fixture below asserts is empty. Exported for `gates.test.ts`,
 * which proves the `PORTAL_ERROR` spellings by writing a log file and reading the
 * gate's verdict on it, rather than by inspecting the pattern. Testing through
 * this function rather than through `PORTAL_ERROR` directly is deliberate: the
 * question a gate test must answer is "would the suite go red on this log line",
 * which depends on the level filter, the `[browser]` exclusion and `SERVER_ALLOW`
 * as much as on the pattern.
 */
export function scanAppended(source: LogSource, path: string, offset: number): string[] {
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
    // Playwright derives a fixture's dependencies by parsing its first parameter
    // and rejects anything that is not an object-destructuring pattern ("First
    // argument must use the object destructuring pattern"). A fixture that needs
    // no other fixture must therefore destructure nothing, so the empty pattern
    // is required here, not an oversight.
    // eslint-disable-next-line no-empty-pattern
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
