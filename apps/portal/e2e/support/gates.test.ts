import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scanAppended } from "./gates.js";

/**
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
}

/** Fault spellings the pattern already caught before #120; these must not regress. */
const CAUGHT_BEFORE: readonly Case[] = [
  { why: "Next.js error glyph", line: "⨯ unhandledRejection: [Error: boom]" },
  { why: "a bare thrown Error:", line: "Error: connect ECONNREFUSED 127.0.0.1:4010" },
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
  it.each(CAUGHT_BEFORE)("still fails on $why", ({ line }) => {
    expect(gateVerdict("portal", line)).toEqual([line]);
  });

  it.each(CAUGHT_BY_120)("now fails on $why", ({ line }) => {
    expect(gateVerdict("portal", line)).toEqual([line]);
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
 * this file's older case assumed; both must stay excluded, which is why the anchor
 * tolerates leading SGR escapes rather than being a plain `startsWith`.
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
  it.each(QUOTES_THE_MARKER_LATER)("fails on $why", ({ line }) => {
    expect(gateVerdict("portal", line)).toEqual([line]);
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
