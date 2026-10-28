/**
 * Shared error gates for every portal Playwright spec. Import `test` and `expect` from
 * here instead of `@playwright/test` and each test fails on a browser fault, meaning any
 * `console.error`, `console.warn` or uncaught `pageerror`, and on any error-level line
 * the API, Postgres or the portal dev server wrote during it: the flow exercises those
 * services, so their logs have to be clean too.
 *
 * An allowlist entry is a last resort and carries its justification inline. A
 * deliberately provoked non-2xx is declared per test instead (see
 * {@link ExpectedRequestFailure}). The API logs every client-safe 4xx at warn, which is
 * it correctly reporting a client error rather than a server fault, so those shapes are
 * allowlisted; an error-level unhandled one never is.
 *
 * Every server-log pattern below matches stripped text: the captured logs carry ANSI SGR
 * bytes and `scanAppended` removes them once, so no pattern needs to know about escapes
 * and none can be blinded by one landing inside a token. `BROWSER_ALLOW` is the
 * exception, matching live console text, which never carries them.
 *
 * The browser gate's verdict is read after a settle, because a console event is
 * delivered asynchronously and a fault emitted in a test's final moments used to be
 * missed while the suite stayed green.
 */

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import { test as base, expect } from "@playwright/test";
import type { ConsoleMessage, Page, Request, TestInfo } from "@playwright/test";

import { SERVER_LOG_FILES } from "./harness-config.js";

export { expect };

/**
 * Benign, allowlisted browser messages. These match live console text rather than a
 * captured log, so the SGR strip does not apply to them.
 *
 * Nothing about the CSP nonce is here and nothing about it may be added: the chain is
 * asserted positively in `csp-nonce.pw.ts`, and the one spurious warning is handled at
 * the source, on that single element.
 *
 * One list covers every gated level rather than one per level, which is the looser of
 * the two options: each entry names a specific artefact with a removal condition, so the
 * level a browser happens to pick is not information the gate should depend on.
 *
 * Entries match by pattern, never by count: the population drifts run to run, so a
 * count-based assertion would be flaky by construction.
 *
 * A message a single spec provokes on purpose does not belong here, because this list is
 * exempt in every test, for ever; such a fault is declared per test through
 * {@link ExpectedRequestFailure}. Nothing about a 4xx status may be added, which would
 * blind every spec to every failed request at that status.
 */
const BROWSER_ALLOW: readonly RegExp[] = [
  // Dev-only: Next runs React's development build, which uses eval() for debug tooling,
  // while the portal's strict CSP forbids `unsafe-eval`. React states it will never use
  // eval() in production, so this cannot occur in the shipped build, and weakening the
  // CSP to silence it is not an option. Removed when the dev build stops using eval().
  /eval\(\) is not supported in this environment/,
];

/**
 * Derived from `ConsoleMessage.type()` rather than restated as `string`, which is a
 * tripwire: Playwright spells `console.warn` as `"warning"`, and a gate written against
 * `"warn"` would compile, pass review and match nothing. Typing the gated set against
 * the upstream union makes a renamed level a typecheck failure at upgrade time.
 *
 * Bounded, and worth not overstating: it holds only insofar as an upstream rename lands
 * in the type union alongside the runtime string. Nothing here observes what a browser
 * actually emits.
 */
type BrowserConsoleType = ReturnType<ConsoleMessage["type"]>;

/**
 * `warn` is gated because it is the level React and the browser platform APIs use to
 * report behaviour that is actually wrong: an accessibility-blocking defect once shipped
 * whose only runtime signal was 51 browser warnings a run, which the gate ignored.
 *
 * `info`, `log` and `debug` are deliberately not gated. Measured over a full run they
 * are development-tooling chatter with no fault semantics, and they exist only because
 * the suite runs against a dev server. If a future defect announces itself at `info`,
 * gating `info` then, on evidence, is the fix.
 */
const GATED_CONSOLE_TYPES: ReadonlySet<BrowserConsoleType> = new Set(["error", "warning"]);

/**
 * The gate's standing verdict on one live browser console message: the fault
 * string to report, or `null` when the message is benign for every spec.
 *
 * `type` is Playwright's own level union rather than `string`, so a call site cannot
 * invent a level the runtime never emits.
 *
 * This is the level filter plus the allowlist, and a fault string returned here is still
 * dropped if the running test declared it as an expected request failure. Splitting it
 * that way is deliberate: what is benign everywhere and what one spec provokes on
 * purpose are different questions, and only the first belongs to a suite-wide list.
 *
 * Exported because the question a gate test has to answer is whether the suite would go
 * red on a given message, which depends on the level filter and the allowlist together
 * rather than on either alone.
 */
export function browserConsoleFault(type: BrowserConsoleType, text: string): string | null {
  if (!GATED_CONSOLE_TYPES.has(type)) return null;
  if (BROWSER_ALLOW.some((allow) => allow.test(text))) return null;
  return `console.${type}: ${text}`;
}

/**
 * One non-2xx response a single test provokes on purpose, declared before it happens.
 * The browser reports any failed resource load as a `console.error`, so without this no
 * gated spec could exercise a rejected post at all.
 *
 * Not a `BROWSER_ALLOW` entry, and the difference is the point: this is scoped to one
 * test, one status and the requests whose URL matches, so a spec provoking a 422 on one
 * route still fails on a 500 anywhere or a 422 elsewhere. It is also required to occur,
 * so it cannot rot into a mute once the behaviour changes.
 */
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

/**
 * Allowances that hold inside one named spec and nowhere else. A line-keyed entry is the
 * right shape when the line is unambiguous, and the wrong shape when the benign line and
 * a real fault are spelled identically: a truncated-JSON parse error is the sibling of
 * an aborted request, and also what a broken handler produces.
 *
 * So the exemption is bound to the test that provokes it rather than to the words it is
 * provoked into writing, and outside that spec the line still reds the run. Each entry
 * names the file and the exact title, because a file-wide allowance would silently cover
 * tests added later.
 */
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
/**
 * Portal dev-server fault markers. Forwarded browser lines are excluded here because the
 * browser gate owns them, and that gate covers forwarded `warn` as well as `error`, so
 * excluding them hands them on rather than dropping them.
 *
 * `\w*Error:` rather than `\bError:`, because there is no word boundary between `e` and
 * `E` in `RangeError`, so a bare `\b` matched no subclass name. `\w*` only extends
 * leftwards over word characters, so `Errors:` in prose and a label containing the word
 * still do not match.
 *
 * `Unhandled Rejection:` and `Uncaught Exception:` are what Node prints when a handler is
 * installed, which is precisely the case where the process survives and only a log gate
 * can notice; the camel-case spellings stay for the bare runtime's own.
 */
const PORTAL_ERROR =
  /(⨯|unhandledRejection|UnhandledPromiseRejection|Unhandled Rejection:|Uncaught Exception:|\b\w*Error:| 5\d\d )/;

/**
 * A plain `startsWith`, so a server-side fault line that merely quotes the marker in its
 * message is not exempted and no text can be smuggled in front of it. The dev server
 * colours the marker, which the SGR strip removes before any pattern runs.
 *
 * Only the browser marker is exempted. The dev server builds the same marker for console
 * output from the server or edge runtime, and those are faults the browser gate does not
 * own, so they deliberately still fail the server gate.
 */
const BROWSER_FORWARD_PREFIX = "[browser]";

function isErrorLine(source: LogSource, line: string): boolean {
  if (source === "api") return apiLineIsError(line);
  if (source === "postgres") return PG_ERROR.test(line);
  if (line.startsWith(BROWSER_FORWARD_PREFIX)) return false;
  return PORTAL_ERROR.test(line);
}

/**
 * Written as the `\u001B` source escape, never a literal ESC byte, so
 * `check:no-control-chars` stays green. Stripping here is what lets every other pattern
 * in the file be written in plain text, so one deliberate disable lives here rather than
 * one per call site.
 */
// eslint-disable-next-line no-control-regex -- the SGR escapes are the subject of this pattern
const SGR_ESCAPE = /\u001B\[[0-9;]*m/g;

/**
 * The dev server colours its output and the captured log keeps the bytes, so an escape
 * landing inside a token defeats a pattern silently: a fault marker finds nothing in a
 * word split by a colour reset, and an allowlist entry fails to match the line it was
 * written for. Stripping once here removes the whole category.
 *
 * Only SGR is stripped, which is what the colour library emits. A cursor-movement CSI
 * would survive, and none occurs in any captured log measured so far.
 */
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

/**
 * Every fault line a source appended after `offset`: the set the `serverGuard` fixture
 * asserts is empty. Exported so a gate test can answer whether the suite would go red on
 * a given line, which depends on the level filter, the forwarded-line exclusion and the
 * allowlist as much as on the pattern.
 *
 * SGR escapes are stripped here, once, before any pattern runs. The order is strip then
 * trim, which is the only order robust to both interleavings: trimming first leaves an
 * escape-then-whitespace line with leading whitespace, defeating the anchor. Anchoring
 * is otherwise unaffected, because a strip removes only escape bytes and so can never
 * move text to the front of a line.
 *
 * The lines returned are the stripped ones, so a failing gate prints readable text.
 *
 * `extraAllow` defaults to none, so a gate test reads the unconditional verdict: a line
 * only one spec may write must still fail everywhere else.
 */
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

/**
 * How long {@link settleBrowserEvents} waits for the requests that were still in
 * flight when the test body ended. Three seconds is four orders of magnitude more
 * than a localhost round trip needs, and a request still open after it is not
 * going to be closed by waiting longer - it is a stream, a hung route handler, or
 * a spec that walked away from it on purpose.
 */
const REQUEST_SETTLE_BUDGET_MS = 3000;

/** How often the settle re-checks the pending set. */
const REQUEST_SETTLE_POLL_MS = 25;

/** A pending-set re-check tick, as a promise (no page round trip involved). */
function tick(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Give the browser gate every fault the page has already produced before its verdict is
 * read. `page.on("console")` fires when Playwright dispatches a protocol event, which is
 * asynchronous with respect to the test body, so a probe provoking a 422 immediately
 * before its test ended passed while the same probe holding the page open failed.
 *
 * Three steps, of two kinds. A page round trip is a real flush rather than a hope:
 * Chromium delivers a session's events and command responses over one ordered pipe, so
 * an event generated before the call is dispatched ahead of its reply, and it also
 * flushes the `request` events that make the pending set complete. Draining those
 * pending requests is a bound and not a guarantee, because a fault the page has not
 * generated yet cannot be flushed by anything, and the common shape is a
 * fire-and-forget post whose non-2xx has not arrived. A second round trip then
 * dispatches the faults the drain waited into existence, which is the step that does the
 * work: a round-trip-only settle was measured not to fix the probe.
 *
 * The residual window, stated rather than implied away: a fault whose cause starts after
 * the drain is not observed, and no settle can close that, "no fault happened" being a
 * claim about a window rather than about a live page. Ordering also holds only within one
 * protocol session, so an out-of-process iframe or worker is outside the guarantee; the
 * portal has neither.
 *
 * This runs before either gate asserts, which is why `browserGuard` depends on
 * `serverGuard`: the log scan is subject to the same race, and settling first keeps a
 * late fault line inside the window of the test that caused it.
 */
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

/**
 * The browser gate, as a test sees it: the one sanctioned door onto its per-test
 * state (issue #166).
 */
export interface BrowserFaultGate {
  /**
   * Declare a non-2xx response this test provokes on purpose, before provoking it.
   * The console error the browser logs for it stops being a fault FOR THIS TEST
   * only; every other fault still reds it, and a declaration nothing matched reds
   * it too. See {@link ExpectedRequestFailure} for the scope and why this is not an
   * allowlist entry.
   */
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

/**
 * The gated test runner. `browserGuard` collects gated console messages (`error`
 * and, since #147, `warn`) plus page errors for the whole test; `serverGuard`
 * records each server log's length at the start and scans what was appended by
 * the end. Both run automatically for every spec that imports this `test`.
 *
 * The browser gate watches **live Playwright console events**, not the forwarded
 * copies the Next dev server writes into `portal.log`. Both surfaces carry the
 * same messages (measured: 25 forwarded `[browser] WARN:` lines in a captured
 * `portal.log` against 25 live `warning` events in the same run), and the live one
 * is the right place to gate them: it is per-test rather than per-run, it carries
 * the message type as data instead of as a text prefix to be re-parsed, and
 * gating the log copy instead would mean weakening the server gate's `[browser]`
 * exclusion, which #131 anchored deliberately.
 *
 * `browserGuard` DEPENDS on `serverGuard` (that is the whole reason it destructures
 * it), which inverts their teardown order so the browser guard runs first. That is
 * what puts {@link settleBrowserEvents} ahead of both verdicts rather than only
 * ahead of the browser one: without it, a late response would land after the server
 * log had already been scanned and its fault line would fall into the gap between
 * two tests, seen by neither (issue #166).
 */
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
