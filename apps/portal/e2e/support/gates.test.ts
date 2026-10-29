import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { API_PORT, PORTAL_PORT } from "./harness-config.js";
import { browserConsoleFault, matchExpectedFailure, scanAppended, SPEC_ALLOW } from "./gates.js";
import type { ExpectedRequestFailure } from "./gates.js";

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
function gateVerdict(
  source: "api" | "postgres" | "portal",
  text: string,
  extraAllow: readonly {
    readonly source: "api" | "postgres" | "portal";
    readonly pattern: RegExp;
  }[] = [],
): string[] {
  const path = nextLogPath(source);
  writeFileSync(path, `${text}\n`, "utf8");
  return scanAppended(source, path, 0, extraAllow);
}

interface Case {
  /** A single line as it appears in `.playwright/server-logs/portal.log`. */
  readonly line: string;
  /** Why this line has the verdict it does (the test name). */
  readonly why: string;
  readonly reported?: string;
}

/** The fault text the gate is expected to report for a case. */
function reportedText(c: Case): string {
  return c.reported ?? c.line;
}

/** Fault spellings the pattern already caught before the extension; these must not regress. */
const CAUGHT_BEFORE: readonly Case[] = [
  { why: "Next.js error glyph", line: "⨯ unhandledRejection: [Error: boom]" },
  {
    why: "a bare thrown Error:",
    line: `Error: connect ECONNREFUSED 127.0.0.1:${String(API_PORT)}`,
  },
  { why: "the unhandledRejection event name", line: "unhandledRejection [Error: boom]" },
  { why: "Node's UnhandledPromiseRejection spelling", line: "UnhandledPromiseRejection: boom" },
  { why: "a 5xx in the request log", line: "POST /r/tok_abc 500 in 42ms" },
  { why: "a 503 in the request log", line: "GET /r/tok_abc 503 in 7ms" },
];

/**
 * Fault spellings added later. Each of these was silently ignored by the previous
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

describe("the spec-scoped server allowance (issue #314)", () => {
  const TRUNCATED_JSON = "SyntaxError: Unexpected end of JSON input";
  const throttled = SPEC_ALLOW.filter(
    (allow) => allow.file === "anonymous-flow.pw.ts" && allow.source === "portal",
  );

  it("is registered for exactly the throttled-connection spec", () => {
    expect(throttled).toHaveLength(1);
    expect(throttled[0]?.title).toBe(
      "anonymous at-fault-accident branch completes on a throttled mobile connection",
    );
  });

  it("still fails the gate for every test that does not carry it", () => {
    expect(gateVerdict("portal", TRUNCATED_JSON)).toEqual([TRUNCATED_JSON]);
  });

  it("stays silent for the test it names", () => {
    expect(gateVerdict("portal", TRUNCATED_JSON, throttled)).toEqual([]);
  });

  it("does not cover a different parse fault in the same test", () => {
    const other = "SyntaxError: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON";
    expect(gateVerdict("portal", other, throttled)).toEqual([other]);
  });

  it("does not cover an unrelated fault in the same test", () => {
    const fault = "TypeError: Cannot read properties of undefined (reading 'id')";
    expect(gateVerdict("portal", fault, throttled)).toEqual([fault]);
  });
});

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

const RESET_MID_TOKEN = `TypeErr\u001B[39mor: Cannot read properties of undefined`;
const RESET_INSIDE_ABORTED = `Error: ab\u001B[39morted`;

const PRE_143_PORTAL_ERROR =
  /(⨯|unhandledRejection|UnhandledPromiseRejection|Unhandled Rejection:|Uncaught Exception:|\b\w*Error:| 5\d\d )/;
const PRE_143_SERVER_ALLOW_ABORTED = /\bError: aborted\b/;

describe("SGR escapes are stripped before any pattern runs (issue #143)", () => {
  it("catches a fault whose Error token is split by a colour escape", () => {
    expect(PRE_143_PORTAL_ERROR.test(RESET_MID_TOKEN)).toBe(false);
    expect(gateVerdict("portal", RESET_MID_TOKEN)).toEqual([
      "TypeError: Cannot read properties of undefined",
    ]);
  });

  it("allowlists a benign line whose allowlisted phrase is split by a colour escape", () => {
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

describe("the allowlisted browser shapes stay silent (issue #147)", () => {
  it("allows the dev-build eval()/CSP notice, which arrives as an error", () => {
    const text =
      "eval() is not supported in this environment. If this page was served with a " +
      "`Content-Security-Policy` header, make sure that `unsafe-eval` is included. React " +
      "requires eval() in development mode for various debugging features like " +
      "reconstructing callstacks from a different environment.";
    expect(browserConsoleFault("error", text)).toBeNull();
  });

  it("no longer allowlists the issue #144 DatePicker residue (issue #148)", () => {
    expect(
      browserConsoleFault("warning", "WARN: A component changed from uncontrolled to controlled."),
    ).toBe("console.warning: WARN: A component changed from uncontrolled to controlled.");
  });
});

describe("info, log and debug are not gated (issue #147)", () => {
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
      matchExpectedFailure(
        DECLARED,
        ANSWERS_422,
        `http://localhost:${String(PORTAL_PORT)}/s/ses_abc/submit`,
      ),
    ).toBeUndefined();
  });

  it("does not exempt an ordinary console error, whatever the URL", () => {
    expect(matchExpectedFailure(DECLARED, "Hydration failed", ANSWERS_URL)).toBeUndefined();
  });

  it("exempts nothing when the test declared nothing", () => {
    expect(matchExpectedFailure([], ANSWERS_422, ANSWERS_URL)).toBeUndefined();
  });

  it("is anchored, so a fault that quotes the shape is still a fault", () => {
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
