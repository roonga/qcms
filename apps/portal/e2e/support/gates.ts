import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import { test as base, expect } from "@playwright/test";
import type { ConsoleMessage, Page, Request, TestInfo } from "@playwright/test";

import { SERVER_LOG_FILES } from "./harness-config.js";

export { expect };

const BROWSER_ALLOW: readonly RegExp[] = [/eval\(\) is not supported in this environment/];

// Typing the gated set against the upstream union makes a renamed level a typecheck failure at upgrade time.
type BrowserConsoleType = ReturnType<ConsoleMessage["type"]>;

const GATED_CONSOLE_TYPES: ReadonlySet<BrowserConsoleType> = new Set(["error", "warning"]);

export function browserConsoleFault(type: BrowserConsoleType, text: string): string | null {
  if (!GATED_CONSOLE_TYPES.has(type)) return null;
  if (BROWSER_ALLOW.some((allow) => allow.test(text))) return null;
  return `console.${type}: ${text}`;
}

export interface ExpectedRequestFailure {
  /** The status the browser is expected to report, e.g. `422`. */
  readonly status: number;
  /**
   * Chromium puts the failing URL in `ConsoleMessage.location().url` and not in the
   * message text, which is why the status and the request are two fields rather than one
   * pattern over one string.
   */
  readonly url: RegExp;
}

/**
 * Anchored at the start of the message, so a page that merely quotes this sentence
 * inside a longer error stays a fault: no text can be smuggled in front of the marker.
 */
const RESOURCE_LOAD_FAILURE =
  /^Failed to load resource: the server responded with a status of (\d{3})\b/;

/**
 * Returning the declaration rather than a boolean is what lets the guard mark it used,
 * so a declaration nothing matched can fail the test, and it is generic so the caller's
 * own record comes back rather than being matched up by index.
 */
export function matchExpectedFailure<T extends ExpectedRequestFailure>(
  declared: readonly T[],
  text: string,
  url: string,
): T | undefined {
  const match = RESOURCE_LOAD_FAILURE.exec(text);
  if (match === null) return undefined;
  const status = Number(match[1]);
  return declared.find((expected) => expected.status === status && expected.url.test(url));
}

/**
 * Server-log lines that are benign for a clean run, each justified. Applied to
 * SGR-stripped text, so a colour escape landing inside a token cannot defeat the
 * allowlist and false-positive the gate.
 */
const SERVER_ALLOW: readonly { readonly source: LogSource; readonly pattern: RegExp }[] = [
  // The API reporting a typed client-safe 4xx, which the failure-path specs exercise on
  // purpose. Removed if the API stops logging a handled error at warn.
  { source: "api", pattern: /"msg":"handled error"/ },
  { source: "api", pattern: /"msg":"http exception"/ },
  // A client abort, not a server fault: under a simulated slow connection a request can
  // still be in flight when the page navigates on, and the flow completes with the
  // answers verified in the database. Removed when no spec throttles a connection.
  { source: "portal", pattern: /\bError: aborted\b/ },
  // The security control working: a model asked for a verb outside the assistant's four
  // and the server refused it before dispatch, which the admin agent spec provokes with
  // a scripted hostile model. Removed with that spec.
  { source: "api", pattern: /"msg":"draft assistant tool call rejected"/ },
];

export const SPEC_ALLOW: readonly {
  readonly file: string;
  readonly title: string;
  readonly source: LogSource;
  readonly pattern: RegExp;
}[] = [
  {
    // Under host load the abort lands mid-body often enough to be sampled, and the dev
    // server logs the truncated body's parse failure beside the socket's own abort. The
    // journey completes and every functional assertion passes.
    file: "anonymous-flow.pw.ts",
    title: "anonymous at-fault-accident branch completes on a throttled mobile connection",
    source: "portal",
    pattern: /^SyntaxError: Unexpected end of JSON input$/,
  },
];

function specAllowancesFor(
  testInfo: TestInfo,
): readonly { readonly source: LogSource; readonly pattern: RegExp }[] {
  const file = basename(testInfo.file);
  return SPEC_ALLOW.filter((allow) => allow.file === file && allow.title === testInfo.title);
}

type LogSource = "api" | "postgres" | "portal";

/**
 * Receives SGR-stripped text: the API writes uncoloured JSON, but a stray escape would
 * make `JSON.parse` throw and silently downgrade a real fault line.
 */
function apiLineIsError(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as { level?: string };
    return parsed.level === "warn" || parsed.level === "error";
  } catch {
    return false;
  }
}

/** `LOG`, `DETAIL` and `STATEMENT` are benign. */
const PG_ERROR = /(ERROR|FATAL|PANIC|WARNING):/;
const PORTAL_ERROR =
  /(⨯|unhandledRejection|UnhandledPromiseRejection|Unhandled Rejection:|Uncaught Exception:|\b\w*Error:| 5\d\d )/;

const BROWSER_FORWARD_PREFIX = "[browser]";

function isErrorLine(source: LogSource, line: string): boolean {
  if (source === "api") return apiLineIsError(line);
  if (source === "postgres") return PG_ERROR.test(line);
  if (line.startsWith(BROWSER_FORWARD_PREFIX)) return false;
  return PORTAL_ERROR.test(line);
}

// eslint-disable-next-line no-control-regex -- the SGR escapes are the subject of this pattern
const SGR_ESCAPE = /\u001B\[[0-9;]*m/g;

function stripSgr(line: string): string {
  return line.replace(SGR_ESCAPE, "");
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

export function scanAppended(
  source: LogSource,
  path: string,
  offset: number,
  extraAllow: readonly { readonly source: LogSource; readonly pattern: RegExp }[] = [],
): string[] {
  const allowed = [...SERVER_ALLOW, ...extraAllow];
  const text = appendedSince(path, offset);
  return text
    .split(/\r?\n/)
    .map((line) => stripSgr(line).trim())
    .filter((line) => line.length > 0)
    .filter((line) => isErrorLine(source, line))
    .filter(
      (line) => !allowed.some((allow) => allow.source === source && allow.pattern.test(line)),
    );
}

interface Offsets {
  readonly api: number;
  readonly postgres: number;
  readonly portal: number;
}

const REQUEST_SETTLE_BUDGET_MS = 3000;

/** How often the settle re-checks the pending set. */
const REQUEST_SETTLE_POLL_MS = 25;

/** A pending-set re-check tick, as a promise (no page round trip involved). */
function tick(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function settleBrowserEvents(page: Page, inflight: ReadonlySet<Request>): Promise<void> {
  if (page.isClosed()) return;
  const roundTrip = async (): Promise<void> => {
    try {
      await page.evaluate(() => undefined);
    } catch {
      /* page or context gone */
    }
  };
  await roundTrip();
  const pending = new Set(inflight);
  const deadline = Date.now() + REQUEST_SETTLE_BUDGET_MS;
  while (pending.size > 0 && Date.now() < deadline) {
    await tick(REQUEST_SETTLE_POLL_MS);
    for (const request of pending) {
      if (!inflight.has(request)) pending.delete(request);
    }
  }
  await roundTrip();
}

export interface BrowserFaultGate {
  readonly expectRequestFailure: (expected: ExpectedRequestFailure) => void;
}

/** One declaration and how many messages it exempted (0 means it never happened). */
interface DeclaredFailure extends ExpectedRequestFailure {
  used: number;
}

/** How a never-matched declaration is reported, so the failure names the shape. */
function describeExpectation(expected: ExpectedRequestFailure): string {
  return `status ${expected.status} on a request matching ${String(expected.url)}`;
}

export const test = base.extend<{ browserGuard: BrowserFaultGate; serverGuard: void }>({
  browserGuard: [
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `serverGuard` is declared to order the two auto fixtures, which Playwright has no other way to do
    async ({ page, serverGuard }, use) => {
      const problems: string[] = [];
      const declared: DeclaredFailure[] = [];
      const inflight = new Set<Request>();
      page.on("request", (request) => inflight.add(request));
      const settled = (request: Request): void => {
        inflight.delete(request);
      };
      page.on("requestfinished", settled);
      page.on("requestfailed", settled);
      page.on("console", (msg) => {
        const fault = browserConsoleFault(msg.type(), msg.text());
        if (fault === null) return;
        const matched = matchExpectedFailure(declared, msg.text(), msg.location().url);
        if (matched !== undefined) {
          matched.used += 1;
          return;
        }
        problems.push(fault);
      });
      page.on("pageerror", (error) => {
        const text = error.message;
        if (BROWSER_ALLOW.some((allow) => allow.test(text))) return;
        problems.push(`pageerror: ${text}`);
      });
      await use({
        expectRequestFailure: (expected) => {
          declared.push({ ...expected, used: 0 });
        },
      });
      await settleBrowserEvents(page, inflight);
      expect(
        problems,
        `browser console/page faults during the test:\n${problems.join("\n")}`,
      ).toEqual([]);
      const unmet = declared.filter((entry) => entry.used === 0).map(describeExpectation);
      expect(unmet, "expected request failures that this test declared but never provoked").toEqual(
        [],
      );
    },
    { auto: true },
  ],
  serverGuard: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern, so a fixture needing no other fixture destructures nothing
    async ({}, use, testInfo) => {
      const before: Offsets = {
        api: byteLength(SERVER_LOG_FILES.api),
        postgres: byteLength(SERVER_LOG_FILES.postgres),
        portal: byteLength(SERVER_LOG_FILES.portal),
      };
      await use();
      const spec = specAllowancesFor(testInfo);
      const bad = [
        ...scanAppended("api", SERVER_LOG_FILES.api, before.api, spec).map((l) => `[api] ${l}`),
        ...scanAppended("postgres", SERVER_LOG_FILES.postgres, before.postgres, spec).map(
          (l) => `[postgres] ${l}`,
        ),
        ...scanAppended("portal", SERVER_LOG_FILES.portal, before.portal, spec).map(
          (l) => `[portal] ${l}`,
        ),
      ];
      expect(bad, `server error/warn log lines during the test:\n${bad.join("\n")}`).toEqual([]);
    },
    { auto: true },
  ],
});
