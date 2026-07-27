/**
 * Shared error gates for every portal Playwright spec (task 045, exit criteria
 * 3 and 5). Import `test` and `expect` from here instead of `@playwright/test`
 * and each test automatically fails on:
 *
 * - **Browser faults (exit 3):** any `console.error`, any `console.warn`, or an
 *   uncaught `pageerror` in the page under test. If one fires, the suite goes
 *   red until it is fixed at the source; an allowlist entry is a last resort and
 *   needs the justification written inline next to it. `warn` was added by issue
 *   #147: it had been owned by no gate at all (see `GATED_CONSOLE_TYPES`).
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
 *
 * **Every server-log pattern below matches STRIPPED text** (issue #143). The
 * captured logs carry ANSI SGR colour bytes, and `scanAppended` removes them once
 * before any pattern runs, so no pattern here needs to know about escapes and none
 * can be blinded by one landing inside a token. The single exception is
 * `BROWSER_ALLOW`, which is not a log pattern at all: it matches live browser
 * console text, which never carries these escapes.
 */

import { readFileSync, statSync } from "node:fs";

import { test as base, expect } from "@playwright/test";

import { SERVER_LOG_FILES } from "./harness-config.js";

export { expect };

/**
 * Browser console/page messages that are benign and allowlisted. Unlike every
 * other pattern in this file these match live Playwright console/page text rather
 * than a captured log, so they never see SGR escapes and `scanAppended`'s strip
 * does not apply to them. The gate is
 * strict by default; each entry below is a genuinely unavoidable dev-server
 * artifact or a pre-existing issue tracked outside task 045, justified inline.
 * Nothing about the CSP nonce is here and nothing about it may be added (issue
 * #20): the nonce chain is asserted positively in `csp-nonce.pw.ts`, and the one
 * spurious warning it would otherwise raise (browser nonce hiding blanks the
 * `nonce` attribute React hydrates against) is handled at the source, on that
 * single element, in `app/layout.tsx`.
 *
 * One list covers every gated surface (`console.error`, `console.warn`,
 * `pageerror`) rather than one list per level. That is deliberate and it is the
 * looser of the two options: a shape allowlisted at one level is allowlisted if
 * it is re-emitted at another. Both entries below name a specific known artefact
 * with a specific removal condition, so the level a browser happens to pick for
 * it is not information the gate should depend on, and a per-level split would
 * mean re-justifying the same two shapes twice (issue #147).
 *
 * Entries match by **pattern, never by count**. The population drifts run to run:
 * two observers on issue #144 measured 123 and 121 occurrences of the same shape,
 * and the run this file was last measured against produced 128. A count-based
 * assertion would be flaky by construction.
 */
const BROWSER_ALLOW: readonly RegExp[] = [
  // Dev-only: Next runs React's DEVELOPMENT build, which uses eval() for debug
  // tooling, but the portal's strict CSP (SEC-9) forbids `unsafe-eval`. React
  // itself states it "will never use eval() in production mode", so this cannot
  // occur in the shipped build; weakening the CSP to silence it is not an option.
  // Arrives as `console.error` (~128 per suite run, measured), so it was already
  // gated and already allowlisted before #147.
  // REMOVED BY: nothing here. It goes when the e2e suite stops running against a
  // development React build, not before.
  /eval\(\) is not supported in this environment/,
  // The documented issue #144 residue, and the one shape that was invisible to
  // both gates until #147: React emits it as `console.warn`, the browser gate
  // only looked at `console.error`, and the server gate deliberately excludes
  // forwarded `[browser]` lines. 25 per suite run, measured.
  // The DatePicker starts with `value={undefined}` and flips to a string on the
  // first answer, because the vendored control cannot yet accept
  // `value?: string | null`, so React sees an uncontrolled input become
  // controlled. It is a real defect and it is NOT fixed here.
  // REMOVED BY: issue #148. Once that upstream `value?: string | null` change
  // lands in the sibling checkout `../a2-react-aria`, the control is genuinely
  // controlled from first render, the warning stops, and this entry must be
  // deleted (leaving it would re-open the exact blind spot #147 closed).
  /^WARN: A component changed from uncontrolled to controlled\./,
];

/**
 * The browser console levels the gate treats as a fault (issue #147).
 *
 * `error` was always gated. `warn` is the addition, and the justification is
 * concrete rather than tidiness: issue #144 shipped an accessibility-blocking
 * production defect (a required radio group left entirely unreachable by
 * keyboard, every option at `tabindex="-1"`) whose only runtime signal was a
 * browser `console.warn`. The browser gate ignored every non-`error` message and
 * the server gate excludes forwarded `[browser]` lines by design, so 51 warnings
 * per run announced the defect to nobody for as long as it took a human to notice
 * the keyboard trap.
 *
 * `info`, `log` and `debug` are deliberately NOT gated. Measured over a full
 * `pnpm verify:browser` run, they are pure development-tooling chatter with no
 * fault semantics: 128 `info` (React's "Download the React DevTools" notice), 127
 * `log` (`[HMR] connected`, `[Fast Refresh] rebuilding/done`), 0 `debug`. None of
 * that can indicate a defect, all of it exists only because the suite runs
 * against a dev server, and gating it would buy nothing but a third allowlist
 * entry per dev-tool release. `warn` is different in kind: it is the level React
 * and the browser platform APIs use to report behaviour that is actually wrong.
 * If a future defect ever announces itself at `info`, the fix is to gate `info`
 * then, on evidence, not to pre-emptively gate noise now.
 */
const GATED_CONSOLE_TYPES: ReadonlySet<string> = new Set(["error", "warning"]);

/**
 * The gate's verdict on one live browser console message: the fault string to
 * report, or `null` when the message is benign.
 *
 * Note the level spelling. Playwright reports `console.warn` as the message type
 * `"warning"` (the Chrome DevTools Protocol level name), not `"warn"`, which is a
 * gate that silently matches nothing if got wrong. The value in
 * `GATED_CONSOLE_TYPES` is the one observed on live messages in a real run.
 *
 * Exported for `gates.test.ts`, which proves the gate bites by asking this
 * function rather than by inspecting `BROWSER_ALLOW` - the same reason
 * `scanAppended` is exported: the question a gate test must answer is "would the
 * suite go red on this message", which depends on the level filter and the
 * allowlist together, not on either alone.
 */
export function browserConsoleFault(type: string, text: string): string | null {
  if (!GATED_CONSOLE_TYPES.has(type)) return null;
  if (BROWSER_ALLOW.some((allow) => allow.test(text))) return null;
  return `console.${type}: ${text}`;
}

/**
 * Server-log lines that are benign for a clean run, each justified. Applied after
 * the level filter below, to SGR-stripped text (issue #143), so a colour escape
 * landing inside `aborted` can no longer defeat the allowlist and false-positive
 * the gate.
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

/**
 * True when an API JSON log line is at warn/error level (a server-side signal).
 * Receives SGR-stripped text (issue #143); the API writes uncoloured JSON, but a
 * stray escape would otherwise make `JSON.parse` throw and silently downgrade a
 * real fault line to "not an error".
 */
function apiLineIsError(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as { level?: string };
    return parsed.level === "warn" || parsed.level === "error";
  } catch {
    return false;
  }
}

/**
 * PG severities that denote a fault (LOG / DETAIL / STATEMENT are benign).
 * Matches SGR-stripped text (issue #143).
 */
const PG_ERROR = /(ERROR|FATAL|PANIC|WARNING):/;
/**
 * Portal dev-server FAULT markers: Next.js's error glyph, an unhandled rejection
 * or uncaught exception, a thrown `*Error:`, or a 5xx response in the request log.
 * The portal dev server's `warn`-level output is inherently noisy (telemetry,
 * deprecations, and forwarded BROWSER console warnings), and browser-console
 * messages are owned by the browser gate above, so `[browser] ...` lines are
 * excluded here rather than matched as server faults. This is the documented,
 * justified scope of the portal log gate, and since #147 the claim it rests on is
 * actually true: the browser gate now covers forwarded `warn` output as well as
 * `error`, so excluding these lines here hands them to a gate that reads them
 * instead of dropping them on the floor. The exclusion is anchored to the start
 * of the (stripped, then trimmed) line, because that is where the Next dev server
 * writes the prefix: an unanchored substring test exempted any server-side fault
 * line that merely quoted the literal text `[browser]` somewhere in its message,
 * which is a gate going silent rather than a gate crying wolf (issue #131).
 *
 * This pattern matches SGR-stripped text (issue #143), which is what makes the
 * `\b\w*` prefix below trustworthy: an escape landing inside `Error` would
 * otherwise leave no literal `Error:` in the raw line for it to extend leftwards
 * from, and the fault would pass silently.
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

/**
 * The marker the Next dev server writes at the START of a line it forwards from
 * the browser console. The test is a plain `startsWith`, so a server-side fault
 * line that merely quotes the literal text `[browser]` in its message is not
 * exempted (issue #131) and no text can be smuggled in front of the marker.
 *
 * The dev server colours the marker (`cyan("[browser]")`) and the captured log
 * keeps those bytes, so a real line in `.playwright/server-logs/portal.log` is
 * `ESC[36m[browser]ESC[39m ...`, never a bare `[browser] ...`. #131 therefore had
 * to spell this out as a regex tolerating leading escapes, plus a
 * `no-control-regex` disable. Since #143 strips SGR in `scanAppended` before any
 * pattern runs, a plain string prefix is enough and that disable is gone.
 *
 * Only `[browser]` is exempted. `receive-logs.js` builds the same cyan marker as
 * `[server]` for console output whose origin context is the server or edge runtime
 * (`ctx.isServer || ctx.isEdgeServer`). Those are server-side faults the browser
 * gate does not own, so they are deliberately NOT exempted: a
 * `[server] TypeError: ...` line fails the server gate, which is the loud
 * direction and the one we want. There are zero occurrences in any log captured so
 * far; `gates.test.ts` pins the decision so the first one is not a surprise.
 */
const BROWSER_FORWARD_PREFIX = "[browser]";

function isErrorLine(source: LogSource, line: string): boolean {
  if (source === "api") return apiLineIsError(line);
  if (source === "postgres") return PG_ERROR.test(line);
  if (line.startsWith(BROWSER_FORWARD_PREFIX)) return false;
  return PORTAL_ERROR.test(line);
}

/**
 * One ANSI SGR (colour) escape sequence: `ESC [ params m`. Written as the
 * six-character `\u001B` source escape, never a literal ESC byte, so
 * `check:no-control-chars` stays green.
 *
 * `no-control-regex` guards against a control character reaching a pattern by
 * accident. This is the single place in the file where matching the ESC byte is
 * the entire purpose, and stripping here is what lets every other pattern be
 * written in plain text, so one deliberate disable lives here instead of one per
 * call site (issue #143).
 */
// eslint-disable-next-line no-control-regex
const SGR_ESCAPE = /\u001B\[[0-9;]*m/g;

/**
 * Drop every SGR colour sequence from a captured log line.
 *
 * Next colours its dev-server output via picocolors and the captured log keeps
 * the bytes, so 753 of 3097 non-empty lines in a real `portal.log` carry escapes.
 * Every pattern in this file used to match that coloured text, and an escape
 * landing inside a token defeats a pattern silently: `PORTAL_ERROR`'s `\b\w*Error:`
 * finds nothing in `TypeErr<ESC>[39mor:`, and `SERVER_ALLOW`'s
 * `\bError: aborted\b` fails to allowlist `Error: ab<ESC>[39morted`. Stripping once
 * here removes the whole category rather than one instance of it (issue #143).
 *
 * Only SGR (`ESC [ params m`) is stripped, which is what picocolors emits. A
 * cursor-movement or erase-line CSI would survive; none occur in any captured log
 * measured so far, and widening the strip would change what the patterns see
 * beyond the colour bytes this issue is about.
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
 * Every fault line a source appended to its log after `offset`: the exact set the
 * `serverGuard` fixture below asserts is empty. Exported for `gates.test.ts`,
 * which proves the `PORTAL_ERROR` spellings by writing a log file and reading the
 * gate's verdict on it, rather than by inspecting the pattern. Testing through
 * this function rather than through `PORTAL_ERROR` directly is deliberate: the
 * question a gate test must answer is "would the suite go red on this log line",
 * which depends on the level filter, the `[browser]` exclusion and `SERVER_ALLOW`
 * as much as on the pattern.
 *
 * SGR escapes are stripped here, once, before any pattern runs (issue #143), so
 * every pattern above is written against plain text. The order is **strip, then
 * trim**, which is the only order robust to both interleavings: trimming first
 * handles `   <ESC>[36m[browser]` but leaves `<ESC>[36m   [browser]` with leading
 * whitespace, defeating the anchor. Stripping first collapses both to a bare
 * `[browser]` prefix. (Only the first shape is known to occur today; the ordering
 * costs nothing and removes the question.)
 * Anchoring itself is unaffected, because a strip only ever removes escape bytes:
 * it can never move non-escape text to the front of a line, so the #131 property
 * that text cannot be smuggled in front of the marker still holds.
 *
 * The lines this returns are the stripped ones, so a failing gate prints readable
 * text rather than raw colour bytes.
 */
export function scanAppended(source: LogSource, path: string, offset: number): string[] {
  const text = appendedSince(path, offset);
  return text
    .split(/\r?\n/)
    .map((line) => stripSgr(line).trim())
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
 */
export const test = base.extend<{ browserGuard: void; serverGuard: void }>({
  browserGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (msg) => {
        const fault = browserConsoleFault(msg.type(), msg.text());
        if (fault !== null) problems.push(fault);
      });
      page.on("pageerror", (error) => {
        const text = error.message;
        if (BROWSER_ALLOW.some((allow) => allow.test(text))) return;
        problems.push(`pageerror: ${text}`);
      });
      await use();
      expect(
        problems,
        `browser console/page faults during the test:\n${problems.join("\n")}`,
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
