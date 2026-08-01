import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { API_PORT, PORTAL_PORT } from "./harness-config.js";
import { browserConsoleFault, matchExpectedFailure, scanAppended } from "./gates.js";
import type { ExpectedRequestFailure } from "./gates.js";

/**
 * Gate tests for `gates.ts`, in two halves.
 *
 * The first and larger half covers the **server-log** gate: the `PORTAL_ERROR`
 * fault pattern (issue #120), the `[browser]` / `[server]` prefix policy (#131,
 * #143) and the SGR stripping every pattern now relies on (#143). Its cases feed
 * the gate a log file and read its verdict.
 *
 * The second half, at the bottom of the file, covers the **browser** gate: its
 * `console.warn` coverage (issue #147) and the per-test declaration that lets one
 * spec provoke a failed request on purpose (issue #166). Those cases feed
 * `browserConsoleFault` and `matchExpectedFailure` a live console message and read
 * their verdict.
 *
 * The two halves share one discipline, which is the point of both: a case proves
 * what the *gate* does, never what a regex or a `Set` contains.
 *
 * ---
 *
 * The portal server-log gate's fault pattern (issue #120).
 *
 * Every case here is proved by *feeding the gate a log file* and reading its
 * verdict, never by inspecting `PORTAL_ERROR`. That distinction matters: whether
 * the suite goes red on a given line depends on the source dispatch, the
 * `[browser]` exclusion and the `SERVER_ALLOW` allowlist as much as on the
 * pattern, so a regex-shaped assertion could pass while the gate stayed silent.
 *
 * The two holes #120 closed, both found by reading `gates.ts` rather than by a
 * failing run (the gate is only armed against output a real run happens to
 * produce, so a missed spelling is invisible until it costs a debugging session):
 *
 * 1. `\bError:` matched a bare `Error:` but no subclass name, because there is no
 *    word boundary between `e` and `E` in `RangeError`. `next dev --port 99999`
 *    prints exactly such a line (`Unhandled Rejection: RangeError: options.port
 *    should be >= 0 and < 65536.`, measured for issue #58) and then keeps
 *    running, which is the shape of fault only a log gate can catch.
 * 2. Next 16 spells it `Unhandled Rejection:` (space, title case), which neither
 *    `unhandledRejection` nor `UnhandledPromiseRejection` matches.
 *
 * "Match more" is the easy half. The negative table below is the other half: the
 * widening must not fire on prose, on a question label containing the word
 * "error", on non-5xx request lines, on browser-forwarded output, or on the
 * already-justified allowlist entries.
 */

let dir: string;
let counter = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "qcms-gates-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A fresh log-file path, so no case can read a line another case wrote. */
function nextLogPath(name: string): string {
  counter += 1;
  return join(dir, `${name}-${counter}.log`);
}

/** Write `text` as a fresh log file and return the gate's verdict on all of it. */
function gateVerdict(source: "api" | "postgres" | "portal", text: string): string[] {
  const path = nextLogPath(source);
  writeFileSync(path, `${text}\n`, "utf8");
  return scanAppended(source, path, 0);
}

interface Case {
  /** A single line as it appears in `.playwright/server-logs/portal.log`. */
  readonly line: string;
  /** Why this line has the verdict it does (the test name). */
  readonly why: string;
  /**
   * What the gate prints when this line is a fault. Defaults to `line`; set it
   * only for a coloured line, because since #143 the gate reports the
   * SGR-stripped text so a failing run shows readable output rather than raw
   * colour bytes.
   */
  readonly reported?: string;
}

/** The fault text the gate is expected to report for a case. */
function reportedText(c: Case): string {
  return c.reported ?? c.line;
}

/** Fault spellings the pattern already caught before #120; these must not regress. */
const CAUGHT_BEFORE: readonly Case[] = [
  { why: "Next.js error glyph", line: "⨯ unhandledRejection: [Error: boom]" },
  {
    why: "a bare thrown Error:",
    // The composed API's own harness port, derived rather than written: R8 keeps
    // even a synthetic log line off an invented number (docs/PORTS.md).
    line: `Error: connect ECONNREFUSED 127.0.0.1:${String(API_PORT)}`,
  },
  { why: "the unhandledRejection event name", line: "unhandledRejection [Error: boom]" },
  { why: "Node's UnhandledPromiseRejection spelling", line: "UnhandledPromiseRejection: boom" },
  { why: "a 5xx in the request log", line: "POST /r/tok_abc 500 in 42ms" },
  { why: "a 503 in the request log", line: "GET /r/tok_abc 503 in 7ms" },
];

/**
 * Fault spellings #120 added. Each of these was silently ignored by the previous
 * pattern, so each row is a fault the gate would have let through.
 */
const CAUGHT_BY_120: readonly Case[] = [
  {
    why: "RangeError: (the real next dev --port 99999 line from issue #58)",
    line: "Unhandled Rejection: RangeError: options.port should be >= 0 and < 65536.",
  },
  { why: "a bare RangeError:", line: "RangeError: Invalid array length" },
  { why: "TypeError:", line: "TypeError: Cannot read properties of undefined (reading 'id')" },
  { why: "ReferenceError:", line: "ReferenceError: fetch is not defined" },
  { why: "SyntaxError:", line: "SyntaxError: Unexpected end of JSON input" },
  { why: "AggregateError:", line: "AggregateError: All promises were rejected" },
  {
    why: "the general <Word>Error: shape, including an app-specific subclass",
    line: "QcmsConfigError: QCMS_API_BASE_URL is required",
  },
  {
    why: "Next 16's Unhandled Rejection: spelling with a non-Error reason",
    line: "Unhandled Rejection: 'boom'",
  },
  {
    why: "Uncaught Exception: with a subclass reason",
    line: "Uncaught Exception: RangeError: Maximum call stack size exceeded",
  },
];

/**
 * Benign lines the gate must stay silent on. The first four are the
 * false-positive guards: the widening extends the match leftwards over word
 * characters only, so it can add a prefix to `Error:` but cannot make the
 * trailing colon optional or the capital `E` case-insensitive.
 */
const BENIGN: readonly Case[] = [
  { why: "the plural Errors: in prose", line: "Build completed. Errors: 0, Warnings: 2" },
  {
    why: "a question label containing the word error",
    line: 'Compiled question q_01 label "Did you see an error message?" in 31ms',
  },
  { why: "lower-case error: in a dev-server notice", line: "info  - error overlay enabled" },
  { why: "a word ending in Error with no colon", line: "✓ Compiled /_error in 118ms" },
  {
    why: "a nextjs.org docs link whose slug ends in -error",
    line: "See more info here: https://nextjs.org/docs/messages/react-hydration-error",
  },
  { why: "a 2xx request line", line: "GET /r/tok_abc 200 in 88ms" },
  { why: "a 4xx request line", line: "GET /r/tok_bad 404 in 9ms" },
  { why: "ordinary dev-server readiness output", line: "✓ Ready in 1.2s" },
  {
    why: "a browser-forwarded fault (the browser gate owns those)",
    line: "[browser] TypeError: Failed to fetch",
  },
  {
    why: "the allowlisted client-abort line (SERVER_ALLOW still applies)",
    line: "Error: aborted",
  },
];

describe("portal log gate", () => {
  it.each(CAUGHT_BEFORE)("still fails on $why", (c) => {
    expect(gateVerdict("portal", c.line)).toEqual([reportedText(c)]);
  });

  it.each(CAUGHT_BY_120)("now fails on $why", (c) => {
    expect(gateVerdict("portal", c.line)).toEqual([reportedText(c)]);
  });

  it.each(BENIGN)("stays silent on $why", ({ line }) => {
    expect(gateVerdict("portal", line)).toEqual([]);
  });

  it("reports every fault in a mixed log, and only the faults", () => {
    const log = [...BENIGN, ...CAUGHT_BY_120].map((c) => c.line).join("\n");
    expect(gateVerdict("portal", log)).toEqual(CAUGHT_BY_120.map((c) => c.line));
  });

  it("scans only what was appended after the offset", () => {
    const before = "✓ Ready in 1.2s\n";
    const path = nextLogPath("offset");
    writeFileSync(path, `${before}RangeError: Invalid array length\n`, "utf8");
    expect(scanAppended("portal", path, Buffer.byteLength(before))).toEqual([
      "RangeError: Invalid array length",
    ]);
  });
});

/**
 * The `[browser]` exclusion must be a *prefix* test, not a substring test (issue
 * #131). The Next dev server writes the marker at the start of a line it forwards
 * from the browser console, and those lines belong to the browser gate. A
 * substring test also exempted any server-side fault line that merely quoted the
 * literal text `[browser]` in its message, and that direction of bug is the
 * dangerous one: it makes the gate go quiet on a real fault rather than cry wolf,
 * so nothing ever draws attention to it.
 *
 * The forwarded marker arrives colour-wrapped (`cyan("[browser]")`), and the
 * captured log keeps the escape bytes: every one of the 173 forwarded lines in a
 * 3077-line `portal.log` from a full `pnpm verify:browser` run is
 * `\u001B[36m[browser]\u001B[39m ...` and none is bare. So the colour-wrapped
 * shape below is the shape that actually occurs, and the bare one is the shape
 * this file's older case assumed; both must stay excluded. #131 achieved that with
 * an anchor that tolerated leading SGR escapes; since #143 strips SGR once in
 * `scanAppended`, the exclusion is a plain `startsWith("[browser]")` and both
 * shapes reach it already bare. The cases below are unchanged, and that is the
 * point: the observable behaviour did not move.
 */
const CYAN = "\u001B[36m";
const RESET = "\u001B[39m";

const QUOTES_THE_MARKER_LATER: readonly Case[] = [
  {
    why: "a thrown error whose message quotes the marker",
    line: '⨯ Error: failed to forward a "[browser]" console entry',
  },
  {
    why: "an unhandled rejection whose reason quotes the marker",
    line: "Unhandled Rejection: TypeError: Cannot read properties of undefined (reading '[browser]')",
  },
  {
    why: "a 5xx request line whose path quotes the marker",
    line: "POST /r/tok_abc/[browser] 500 in 42ms",
  },
  {
    why: "a coloured server line whose own text precedes the quoted marker",
    line: `${CYAN}\u001B[31m⨯${RESET} Error: cannot parse a "[browser]" entry`,
    reported: '⨯ Error: cannot parse a "[browser]" entry',
  },
  {
    why: "plain text in front of the coloured marker (the #131 anchoring property)",
    line: `forwarding ${CYAN}[browser]${RESET} TypeError: Failed to fetch`,
    reported: "forwarding [browser] TypeError: Failed to fetch",
  },
];

/** Genuine forwarded browser lines: still the browser gate's business, not this one. */
const PREFIXED_BY_THE_HARNESS: readonly Case[] = [
  {
    why: "the real coloured forwarded shape, carrying a fault the browser gate owns",
    line: `${CYAN}[browser]${RESET} TypeError: Failed to fetch`,
  },
  {
    why: "a coloured forwarded line with the error glyph",
    line: `${CYAN}[browser]${RESET} ⨯ RangeError: boom`,
  },
  { why: "an uncoloured forwarded line (NO_COLOR sinks)", line: "[browser] TypeError: boom" },
  {
    why: "a forwarded line indented in the log (the gate trims first)",
    line: "   [browser] SyntaxError: Unexpected end of JSON input",
  },
];

describe("the [browser] exclusion is anchored to the start of the line", () => {
  it.each(QUOTES_THE_MARKER_LATER)("fails on $why", (c) => {
    expect(gateVerdict("portal", c.line)).toEqual([reportedText(c)]);
  });

  it.each(PREFIXED_BY_THE_HARNESS)("stays silent on $why", ({ line }) => {
    expect(gateVerdict("portal", line)).toEqual([]);
  });
});

/**
 * The #120 widening is scoped to the portal branch of `isErrorLine`. These pin
 * that the API and Postgres branches are untouched by it: the API branch is a
 * JSON level filter, so a plain-text `RangeError:` line is not a fault there, and
 * Postgres faults are still keyed on severity rather than on the portal pattern.
 */
describe("the other two log sources are unaffected", () => {
  it("ignores a non-JSON line in the API log", () => {
    expect(gateVerdict("api", "RangeError: Invalid array length")).toEqual([]);
  });

  it("still allowlists the API's deliberate client-safe 4xx", () => {
    expect(gateVerdict("api", '{"level":"warn","msg":"handled error"}')).toEqual([]);
  });

  it("still fails on an API unhandled error", () => {
    const line = '{"level":"error","msg":"unhandled error"}';
    expect(gateVerdict("api", line)).toEqual([line]);
  });

  it("still keys Postgres faults on severity", () => {
    expect(gateVerdict("postgres", "LOG:  database system is ready to accept connections")).toEqual(
      [],
    );
    const fatal = "FATAL:  role does not exist";
    expect(gateVerdict("postgres", fatal)).toEqual([fatal]);
  });
});

/**
 * SGR escapes are stripped once in `scanAppended` before any pattern runs (issue
 * #143), so no pattern has to know that the captured log is coloured.
 *
 * The exposure this closes is the quiet direction: an escape landing *inside* a
 * token defeats a pattern and the gate simply stops gating. It is not reachable
 * from Next today, because picocolors wraps whole segments rather than parts of
 * tokens, so these cases are synthetic by necessity. They are worth pinning
 * anyway: #120 widened `PORTAL_ERROR` to `\\b\\w*Error:` precisely to catch
 * `<Word>Error:` subclass spellings, and a split token is exactly the shape that
 * defeats a `\\b\\w*` prefix match.
 *
 * Note which shapes actually blind the pattern, because it is not the obvious one.
 * An escape placed *between* two tokens does not blind it: every SGR sequence ends
 * in `m`, a word character, so `\\b\\w*` simply bridges the escape body and
 * `Type\u001B[39mError: boom` still matches. Only an escape *inside* the word
 * `Error` removes the literal `Error:` from the raw line, and that is what the
 * cases below use.
 */
const RESET_MID_TOKEN = `TypeErr\u001B[39mor: Cannot read properties of undefined`;
const RESET_INSIDE_ABORTED = `Error: ab\u001B[39morted`;

/**
 * Verbatim frozen copies of the two patterns as they stood before #143, kept only
 * to demonstrate the *old* verdict. Nothing else may use them: every other
 * assertion in this file goes through `scanAppended`, deliberately, so it measures
 * the gate rather than a regex. If `gates.ts` changes what these patterns mean,
 * these copies are meant to go stale and be deleted with the cases they justify.
 */
const PRE_143_PORTAL_ERROR =
  /(⨯|unhandledRejection|UnhandledPromiseRejection|Unhandled Rejection:|Uncaught Exception:|\b\w*Error:| 5\d\d )/;
const PRE_143_SERVER_ALLOW_ABORTED = /\bError: aborted\b/;

describe("SGR escapes are stripped before any pattern runs (issue #143)", () => {
  it("catches a fault whose Error token is split by a colour escape", () => {
    // Before: the raw line contains no literal `Error:`, so the fault pattern
    // found nothing and the gate stayed silent. That is the blinding case.
    expect(PRE_143_PORTAL_ERROR.test(RESET_MID_TOKEN)).toBe(false);
    // After: stripped first, so the gate sees `TypeError:` and reports it.
    expect(gateVerdict("portal", RESET_MID_TOKEN)).toEqual([
      "TypeError: Cannot read properties of undefined",
    ]);
  });

  it("allowlists a benign line whose allowlisted phrase is split by a colour escape", () => {
    // The same hole in the other direction: `SERVER_ALLOW` could not recognise its
    // own justified line, so the gate would have cried wolf on a client abort.
    expect(PRE_143_PORTAL_ERROR.test(RESET_INSIDE_ABORTED)).toBe(true);
    expect(PRE_143_SERVER_ALLOW_ABORTED.test(RESET_INSIDE_ABORTED)).toBe(false);
    expect(gateVerdict("portal", RESET_INSIDE_ABORTED)).toEqual([]);
  });

  it("reports the stripped text, so a failing gate prints readable output", () => {
    expect(gateVerdict("portal", `${CYAN}⨯${RESET} Error: boom`)).toEqual(["⨯ Error: boom"]);
  });

  it("strips before trimming, so a colour sequence ahead of the indent still anchors", () => {
    expect(gateVerdict("portal", `${CYAN}   [browser]${RESET} TypeError: boom`)).toEqual([]);
  });

  it("strips escapes in the Postgres and API sources too", () => {
    const fatal = `${CYAN}FATAL:${RESET}  role does not exist`;
    expect(gateVerdict("postgres", fatal)).toEqual(["FATAL:  role does not exist"]);
    const apiLine = `${CYAN}${RESET}{"level":"error","msg":"unhandled error"}`;
    expect(gateVerdict("api", apiLine)).toEqual(['{"level":"error","msg":"unhandled error"}']);
  });
});

/**
 * The `[server]` prefix policy (issue #143).
 *
 * `receive-logs.js` builds the same cyan marker as `[server]` rather than
 * `[browser]` when the console entry's origin context is the server or edge
 * runtime (`ctx.isServer || ctx.isEdgeServer`). There are zero occurrences in any
 * captured log so far, so this was undocumented and untested.
 *
 * The decision: `[server]` is NOT exempted. Only browser-origin console output is
 * the browser gate's business; a server-origin fault is exactly what the server
 * gate exists to catch, so letting it through would be the quiet direction. The
 * cases below pin that, so the first real occurrence fails loudly and on purpose
 * rather than looking like a gate bug.
 */
describe("the [server] forwarded prefix is not exempted", () => {
  it("fails on a coloured server-origin forwarded fault", () => {
    expect(gateVerdict("portal", `${CYAN}[server]${RESET} TypeError: Failed to fetch`)).toEqual([
      "[server] TypeError: Failed to fetch",
    ]);
  });

  it("fails on an uncoloured server-origin forwarded fault", () => {
    const line = "[server] Unhandled Rejection: RangeError: boom";
    expect(gateVerdict("portal", line)).toEqual([line]);
  });

  it("stays silent on a benign server-origin forwarded line", () => {
    expect(gateVerdict("portal", `${CYAN}[server]${RESET} fetching form frm_01`)).toEqual([]);
  });
});

/**
 * The browser gate's `warn` coverage (issue #147).
 *
 * Before #147 a browser-side `console.warn` was owned by no gate: the browser
 * gate early-returned on anything that was not `console.error`, and the server
 * gate excludes forwarded `[browser]` lines by design. That is how the issue #144
 * defect ran unnoticed: a required radio group left entirely unreachable by
 * keyboard announced itself 51 times per run at `warn`, into the void.
 *
 * Every case here asks `browserConsoleFault` - the same function the
 * `browserGuard` fixture asks - rather than inspecting `BROWSER_ALLOW`, for the
 * same reason the server cases go through `scanAppended`: whether the suite goes
 * red depends on the level filter and the allowlist together.
 *
 * The level spelling is the trap this pins. Playwright reports `console.warn` as
 * the type `"warning"`, so a gate written against `"warn"` would compile, pass
 * review, and match nothing.
 */
describe("the browser gate fails on an unrecognised console.warn (issue #147)", () => {
  it("reports an unrecognised warning", () => {
    expect(browserConsoleFault("warning", "Cannot update a component while rendering")).toBe(
      "console.warning: Cannot update a component while rendering",
    );
  });

  it("reports the #144 shape of defect: a control that went uncontrolled", () => {
    expect(
      browserConsoleFault("warning", "You provided a `value` prop without an `onChange` handler"),
    ).toBe("console.warning: You provided a `value` prop without an `onChange` handler");
  });

  it("still reports an unrecognised console.error", () => {
    expect(browserConsoleFault("error", "Hydration failed")).toBe(
      "console.error: Hydration failed",
    );
  });
});

/**
 * The two allowlisted shapes, verbatim as a real run emits them. Both strings
 * below were copied from a live capture of a full `pnpm verify:browser` run, so a
 * drift in the upstream wording shows up here as a failing gate rather than as a
 * silently-dead allowlist entry.
 */
describe("the allowlisted browser shapes stay silent (issue #147)", () => {
  it("allows the dev-build eval()/CSP notice, which arrives as an error", () => {
    const text =
      "eval() is not supported in this environment. If this page was served with a " +
      "`Content-Security-Policy` header, make sure that `unsafe-eval` is included. React " +
      "requires eval() in development mode for various debugging features like " +
      "reconstructing callstacks from a different environment.";
    expect(browserConsoleFault("error", text)).toBeNull();
  });

  it("allows the issue #144 DatePicker residue, which arrives as a warning", () => {
    expect(
      browserConsoleFault("warning", "WARN: A component changed from uncontrolled to controlled."),
    ).toBeNull();
  });

  it("does not allowlist a different uncontrolled-to-controlled warning by accident", () => {
    // The entry is anchored, so a fault line that merely quotes the allowlisted
    // sentence is still a fault - the same "no text smuggled in front of the
    // marker" property #131 established for the server gate's `[browser]` anchor.
    const line = "Ignored an error: WARN: A component changed from uncontrolled to controlled.";
    expect(browserConsoleFault("warning", line)).toBe(`console.warning: ${line}`);
  });
});

/**
 * The `info` / `log` / `debug` policy (issue #147), pinned rather than left
 * implicit. Measured over a full run these are development-tooling chatter with
 * no fault semantics: 128 `info` (React DevTools notice), 127 `log` (HMR / Fast
 * Refresh), 0 `debug`. They are not gated, and these cases make that a decision
 * on the record instead of an oversight, so the first person to wonder finds an
 * answer instead of a hole.
 */
describe("info, log and debug are not gated (issue #147)", () => {
  // `as const` keeps each `type` a literal, so these rows are checked against
  // Playwright's own level union rather than widened to `string`.
  const ungated = [
    { type: "info", text: "Download the React DevTools for a better development experience" },
    { type: "log", text: "[HMR] connected" },
    { type: "log", text: "[Fast Refresh] rebuilding" },
    { type: "debug", text: "anything at all" },
  ] as const;

  for (const { type, text } of ungated) {
    it(`stays silent on ${type}`, () => {
      expect(browserConsoleFault(type, text)).toBeNull();
    });
  }
});

/**
 * The per-test declaration of a deliberately-provoked failed request (issue #166).
 *
 * The browser reports any non-2xx resource load as a `console.error`, so before
 * this existed no gated spec could exercise a rejected post: #122's 422 branch in
 * `step-flow.tsx` was covered by no layer at all. The hatch has to be narrow enough
 * that it cannot become a mute, and these cases pin each edge of that narrowness:
 * the message shape, the exact status, the request URL, and the anchor.
 *
 * The message text and the URL are separate arguments because that is how Chromium
 * reports it: measured on this suite, a refused `fetch` arrives as `console.error`
 * with the text below and the request URL in `location().url`, never in the text.
 *
 * What these cases cannot show is the other half of "not a blanket mute" - that a
 * declaration nothing matched fails the test, and that an unrelated console error
 * in the same test still fails it. Neither is expressible without running a nested
 * Playwright runner; both were measured with throwaway probe specs against the real
 * suite (issue #166) and are pinned in the fixture's own assertions.
 */
const ANSWERS_422 =
  "Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)";
const ANSWERS_URL = `http://localhost:${String(PORTAL_PORT)}/s/ses_abc/answers`;
const EXPECT_422: ExpectedRequestFailure = { status: 422, url: /\/answers$/ };
const DECLARED: readonly ExpectedRequestFailure[] = [EXPECT_422];

describe("a declared request failure exempts only itself (issue #166)", () => {
  it("exempts the declared status on the declared request", () => {
    expect(matchExpectedFailure(DECLARED, ANSWERS_422, ANSWERS_URL)).toBe(EXPECT_422);
  });

  it("does not exempt a different status on the same request", () => {
    const text =
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)";
    expect(matchExpectedFailure(DECLARED, text, ANSWERS_URL)).toBeUndefined();
  });

  it("does not exempt the declared status on a different request", () => {
    expect(
      matchExpectedFailure(DECLARED, ANSWERS_422, `http://localhost:${String(PORTAL_PORT)}/s/ses_abc/submit`),
    ).toBeUndefined();
  });

  it("does not exempt an ordinary console error, whatever the URL", () => {
    expect(matchExpectedFailure(DECLARED, "Hydration failed", ANSWERS_URL)).toBeUndefined();
  });

  it("exempts nothing when the test declared nothing", () => {
    expect(matchExpectedFailure([], ANSWERS_422, ANSWERS_URL)).toBeUndefined();
  });

  it("is anchored, so a fault that quotes the shape is still a fault", () => {
    // The same "no text smuggled in front of the marker" property #131 established
    // for the server gate's `[browser]` anchor: a page error whose message happens
    // to contain the browser's own sentence is not a resource-load failure.
    expect(matchExpectedFailure(DECLARED, `Caught: ${ANSWERS_422}`, ANSWERS_URL)).toBeUndefined();
  });

  it("does not confuse a status that merely starts with the declared digits", () => {
    const text = "Failed to load resource: the server responded with a status of 4220 (Nonsense)";
    expect(matchExpectedFailure(DECLARED, text, ANSWERS_URL)).toBeUndefined();
  });

  it("returns the matching declaration itself, so its use can be recorded", () => {
    const wrongStatus: ExpectedRequestFailure = { status: 500, url: /\/answers$/ };
    const two: readonly ExpectedRequestFailure[] = [wrongStatus, EXPECT_422];
    expect(matchExpectedFailure(two, ANSWERS_422, ANSWERS_URL)).toBe(EXPECT_422);
  });
});
