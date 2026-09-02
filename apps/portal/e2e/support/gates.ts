/**
 * Shared error gates for every portal Playwright spec (task 045, exit criteria
 * 3 and 5). Import `test` and `expect` from here instead of `@playwright/test`
 * and each test automatically fails on:
 *
 * - **Browser faults (exit 3):** any `console.error`, any `console.warn`, or an
 *   uncaught `pageerror` in the page under test. If one fires, the suite goes
 *   red until it is fixed at the source; an allowlist entry is a last resort and
 *   needs the justification written inline next to it. `warn` was added by issue
 *   #147: it had been owned by no gate at all (see `GATED_CONSOLE_TYPES`). A
 *   deliberately-provoked non-2xx response is declared per test instead of
 *   allowlisted (see {@link ExpectedRequestFailure}, issue #166).
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
 *
 * **The browser gate's verdict is read after a settle** (issue #166), because a
 * console event is delivered asynchronously and a fault emitted in a test's final
 * moments used to be missed while the suite stayed green. See
 * {@link settleBrowserEvents} for what that guarantees and what it cannot.
 */

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

import { test as base, expect } from "@playwright/test";
import type { ConsoleMessage, Page, Request, TestInfo } from "@playwright/test";

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
 * it is re-emitted at another. Every entry below names a specific known artefact
 * with a specific removal condition, so the level a browser happens to pick for
 * it is not information the gate should depend on, and a per-level split would
 * mean re-justifying the same shape twice (issue #147).
 *
 * Entries match by **pattern, never by count**. The population drifts run to run:
 * two observers on issue #144 measured 123 and 121 occurrences of the same shape,
 * and the run this file was last measured against produced 128. A count-based
 * assertion would be flaky by construction.
 *
 * A message a single spec provokes ON PURPOSE does not belong here. This list is
 * exempt in every test, forever, which is why each entry has to name a removal
 * condition; a deliberate one-test fault is declared per test through
 * {@link ExpectedRequestFailure} instead (issue #166). Nothing about a 4xx status
 * may be added here: it would blind every spec in the suite to every failed
 * request at that status.
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
  // The `WARN: A component changed from uncontrolled to controlled.` entry that
  // sat here was DELETED by issue #148, on its own stated removal condition. The
  // DatePicker started with `value={undefined}` and flipped to a string on the
  // first answer, because the vendored control could not accept
  // `value?: string | null`. That upstream change has landed and been re-vendored
  // (the a2ra.json pin move), so the adapter passes `null` and the control is
  // genuinely controlled from first render. The warning is gone rather than
  // tolerated, which is the only reason an entry is ever allowed to go.
];

/**
 * The console levels Playwright itself can report, derived from
 * `ConsoleMessage.type()` rather than restated as `string`.
 *
 * This is a tripwire, not decoration. Playwright spells `console.warn` as
 * `"warning"` (the Chrome DevTools Protocol level name), and a gate written
 * against `"warn"` would compile, pass review, and match nothing - reopening
 * exactly the blind spot #147 closes, silently. Typing `GATED_CONSOLE_TYPES`
 * against the upstream union means a renamed level fails `pnpm typecheck` at
 * upgrade time, automatically, instead of waiting for someone to notice the gate
 * went quiet.
 *
 * The protection is real but bounded, and worth not overstating: it holds only
 * insofar as an upstream rename lands in the type union alongside the runtime
 * string, which is how Playwright has shipped these historically. Nothing here
 * observes what a browser actually emits.
 *
 * It is also the ONLY automatic check on this. The `gates.test.ts` cases pin
 * `browserConsoleFault`'s contract for the string `"warning"`; they cannot notice
 * that Playwright stopped emitting it.
 */
type BrowserConsoleType = ReturnType<ConsoleMessage["type"]>;

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
const GATED_CONSOLE_TYPES: ReadonlySet<BrowserConsoleType> = new Set(["error", "warning"]);

/**
 * The gate's standing verdict on one live browser console message: the fault
 * string to report, or `null` when the message is benign for every spec.
 *
 * `type` is Playwright's own level union rather than `string`, so a call site
 * cannot invent a level the runtime never emits: see {@link BrowserConsoleType}
 * for why that matters here specifically. The values in `GATED_CONSOLE_TYPES` are
 * the ones observed on live messages in a real run.
 *
 * This is the level filter plus `BROWSER_ALLOW`, which is the whole verdict for
 * every message except one: a fault string returned here is still dropped if the
 * running test declared it as an expected request failure
 * ({@link matchExpectedFailure}, issue #166). Splitting it that way is deliberate:
 * what is benign everywhere and what one spec provokes on purpose are different
 * questions, and only the first one belongs to a list read by the whole suite.
 *
 * Exported for `gates.test.ts`, which proves the gate bites by asking this
 * function rather than by inspecting `BROWSER_ALLOW` - the same reason
 * `scanAppended` is exported: the question a gate test must answer is "would the
 * suite go red on this message", which depends on the level filter and the
 * allowlist together, not on either alone.
 */
export function browserConsoleFault(type: BrowserConsoleType, text: string): string | null {
  if (!GATED_CONSOLE_TYPES.has(type)) return null;
  if (BROWSER_ALLOW.some((allow) => allow.test(text))) return null;
  return `console.${type}: ${text}`;
}

/**
 * One non-2xx response a single test provokes ON PURPOSE, declared before it
 * happens (issue #166).
 *
 * The browser reports any failed resource load as a `console.error` ("Failed to
 * load resource: the server responded with a status of 422 (Unprocessable
 * Entity)"), so until this existed no gated spec could exercise a rejected post at
 * all: the 422 branch of `step-flow.tsx` was covered by no layer (issue #122), and
 * `a11y-focus-target.pw.ts` had to answer every question before moving on so a
 * required question's `null` post could not draw one.
 *
 * This is NOT a `BROWSER_ALLOW` entry and the difference is the point.
 * `BROWSER_ALLOW` is exempt in every test forever; this is scoped to one test, one
 * status, and the requests whose URL matches, so a spec provoking a 422 on
 * `/answers` still fails on a 500 anywhere, on a 422 from any other URL, and on
 * every other console error and `pageerror` in the same test. It is also REQUIRED
 * to occur: a declaration nothing matched fails the test, so it cannot quietly rot
 * into a mute once the behaviour it was written for changes.
 */
export interface ExpectedRequestFailure {
  /** The status the browser is expected to report, e.g. `422`. */
  readonly status: number;
  /**
   * Matched against the failing request's URL. Chromium puts that URL in
   * `ConsoleMessage.location().url` and NOT in the message text (measured, issue
   * #166), which is why the status and the request are two fields rather than one
   * pattern over one string.
   */
  readonly url: RegExp;
}

/**
 * The browser's report of a non-2xx resource load, with the status captured as
 * data rather than restated per call site.
 *
 * Anchored at the start of the message, so a page that merely quotes this sentence
 * inside a longer error is not a resource-load failure and stays a fault: the same
 * "no text can be smuggled in front of the marker" property #131 established for
 * the server gate's `[browser]` exclusion.
 */
const RESOURCE_LOAD_FAILURE =
  /^Failed to load resource: the server responded with a status of (\d{3})\b/;

/**
 * The first declared expectation this console message satisfies, or `undefined`
 * when the message is not an expected request failure at all.
 *
 * Returning the declaration rather than a boolean is what lets `browserGuard` mark
 * it as used, so a declaration nothing matched can fail the test. It is generic
 * over the declaration type for the same reason: the caller's own record (with its
 * use count) comes straight back, so nothing has to be matched up by index.
 *
 * Exported for `gates.test.ts` for the same reason `browserConsoleFault` is: the
 * question worth pinning is whether a declared 422 exempts THIS message, which
 * depends on the resource-load shape, the status and the URL together.
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

/**
 * Allowances that hold inside ONE named spec and nowhere else (issue #314).
 *
 * `SERVER_ALLOW` above is keyed on the line, which is the right shape when the
 * line itself is unambiguous: nothing but a client abort writes `Error: aborted`.
 * It is the wrong shape when the benign line and a real fault are spelled
 * identically, and the truncated-JSON parse error is exactly that case. A
 * dev-server `SyntaxError: Unexpected end of JSON input` is the sibling of the
 * `Error: aborted` entry - the same aborted throttled request, seen by whatever
 * was parsing its body rather than by the socket - but the identical sentence is
 * also what a genuinely truncated response from a broken handler produces, and
 * `gates.test.ts` pins that a `SyntaxError:` line must fail the gate.
 *
 * So the exemption is bound to the test that provokes it rather than to the words
 * it is provoked into writing. Outside that one spec the line still reds the run,
 * which is the property a line-keyed entry would have thrown away.
 *
 * Each entry names the spec file and the exact title, because a file-wide
 * allowance would silently cover tests added to that file later.
 */
export const SPEC_ALLOW: readonly {
  readonly file: string;
  readonly title: string;
  readonly source: LogSource;
  readonly pattern: RegExp;
}[] = [
  {
    // The throttled-connection spec, and the most load-sensitive test in the
    // suite: it simulates a 500kbit mobile link on purpose, so a request is
    // genuinely still in flight when the page moves on and the client aborts it.
    // Under host load the abort lands mid-body often enough to be sampled, and
    // the dev server logs the parse failure of the truncated body beside the
    // `Error: aborted` it already logs for the socket. Observed at load average
    // 5.23 with two foreign container stacks live; the journey itself completed
    // and every functional assertion in the spec passed (issue #314).
    file: "anonymous-flow.pw.ts",
    title: "anonymous at-fault-accident branch completes on a throttled mobile connection",
    source: "portal",
    pattern: /^SyntaxError: Unexpected end of JSON input$/,
  },
];

/** The spec-scoped allowances that apply to the test now running. */
function specAllowancesFor(
  testInfo: TestInfo,
): readonly { readonly source: LogSource; readonly pattern: RegExp }[] {
  const file = basename(testInfo.file);
  return SPEC_ALLOW.filter((allow) => allow.file === file && allow.title === testInfo.title);
}

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
 *
 * `extraAllow` carries the spec-scoped allowances of the test now running (issue
 * #314) and defaults to none, so `gates.test.ts` reads the unconditional verdict:
 * a line only one spec is allowed to write must still fail everywhere else, and a
 * test that could exempt itself by omission would be no gate at all.
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
 * Give the browser gate every fault the page has ALREADY produced before its
 * verdict is read (issue #166).
 *
 * The hole this closes: `page.on("console")` fires when Playwright dispatches a
 * protocol event, which is asynchronous with respect to the test body. A probe that
 * provoked a 422 immediately before its test ended therefore PASSED, and the same
 * probe holding the page open for a second failed, deterministically - measured
 * both ways on this suite before and after this function existed. In a gate whose
 * only job is noticing browser-side faults that is the quiet direction: the suite
 * goes green and nothing says otherwise.
 *
 * Two steps, and they are not the same kind of thing:
 *
 * 1. **A page round trip is a real flush, not a hope.** Chromium delivers a
 *    session's events and its command responses over one ordered pipe, so an event
 *    the browser generated before we issued `page.evaluate` is dispatched ahead of
 *    that call's reply. Awaiting one therefore guarantees every console message and
 *    page error generated so far has already reached the handlers above. Two round
 *    trips are needed, not one: the first also flushes the `request` events for a
 *    fetch the test's last gesture had just issued, which is what makes the pending
 *    set below complete.
 * 2. **Draining the pending requests is a bound, not a guarantee.** A fault the
 *    page has not generated yet cannot be flushed by anything, and the common shape
 *    of exactly that is a fire-and-forget post whose non-2xx response has not
 *    arrived (the #122 answer post, and the probe above). Waiting for the requests
 *    that were in flight is what makes those faults exist in time to be flushed by
 *    step 3, and a round-trip-only settle was measured NOT to fix the probe.
 *
 * **The residual window**, stated plainly rather than implied away: a fault whose
 * cause starts after the drain (a timer the page scheduled, a retry, a request
 * issued during teardown) is not observed, and no settle can close that - "no fault
 * happened" is not a provable claim about a live page, only a claim about a window.
 * A request still open when the budget expires reopens the same window for itself.
 * Playwright exposes no "flush pending CDP events" primitive, so step 1 is the
 * closest thing available, and it is enough for everything already generated.
 * Ordering also holds only within one protocol session, so a message from an
 * out-of-process iframe or a worker is outside the guarantee; the portal has
 * neither.
 *
 * This runs before EITHER gate asserts, which is why `browserGuard` depends on
 * `serverGuard`: the server-log gate's scan is subject to the same class of race
 * (a fault line the portal writes when a late response lands), and settling first
 * keeps that line inside the window of the test that caused it.
 *
 * **What it costs**, measured across a full `pnpm verify:browser` before and after
 * (68 shared tests): median +4ms, p90 +200ms, and one outlier at +2.9s on the
 * throttled mobile spec, whose whole subject is a simulated slow connection with
 * requests genuinely still in flight when the test ends. That outlier is the budget
 * doing its job rather than a cost to tune away: it is exactly the shape of test
 * where the old gate could miss a fault. Nothing came near the budget otherwise, so
 * no request in this suite is left hanging at teardown.
 */
async function settleBrowserEvents(page: Page, inflight: ReadonlySet<Request>): Promise<void> {
  if (page.isClosed()) return;
  const roundTrip = async (): Promise<void> => {
    // A closed page/context cannot be flushed; that is a residual window, not an
    // error to report as a browser fault.
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
    // `serverGuard` is destructured for its DEPENDENCY, not its value (it has
    // none): that is what puts this fixture's teardown ahead of the server gate's
    // scan, so the settle below happens before either verdict is read. Playwright
    // has no other way to order two auto fixtures.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async ({ page, serverGuard }, use) => {
      const problems: string[] = [];
      const declared: DeclaredFailure[] = [];
      // The requests Playwright has told us about and not yet reported settled, so
      // the settle below knows what it is waiting for. `requestfailed` covers an
      // aborted request as well as a network error, so nothing lingers in the set.
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
      // A declared failure that never happened is a dead exemption, and a dead
      // exemption is how a gate goes quiet. Reported as a failure of the test that
      // declared it, so the hatch has to be deleted when it stops being needed.
      const unmet = declared.filter((entry) => entry.used === 0).map(describeExpectation);
      expect(unmet, "expected request failures that this test declared but never provoked").toEqual(
        [],
      );
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
    async ({}, use, testInfo) => {
      const before: Offsets = {
        api: byteLength(SERVER_LOG_FILES.api),
        postgres: byteLength(SERVER_LOG_FILES.postgres),
        portal: byteLength(SERVER_LOG_FILES.portal),
      };
      await use();
      // Read once, after the body, so the allowance is attributed to the test that
      // actually ran rather than to whatever the file declares (issue #314).
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
