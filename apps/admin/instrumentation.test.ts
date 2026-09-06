import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "./instrumentation";

/**
 * The cookie-downgrade boot refusal is actually **wired into boot** (issue #409).
 *
 * `lib/server/config.test.ts` already covers `assertSecureCookiesConfigured()`
 * exhaustively: which environments it accepts, which it refuses, and what the message
 * says. What nothing covered is the one line that turns that decision into a control -
 * `register()` calling it. Deleting that call left the whole admin and portal unit
 * suite green (666 tests passed), which is how issue #409 was found.
 *
 * That gap matters more than an ordinary uncovered line because of the direction the
 * failure points: an unwired refusal does not fail, it **succeeds**. The deployment
 * the guard exists to stop boots normally, setting an authoring credential without
 * `Secure` at a public origin, and every gate we run agrees nothing is wrong.
 *
 * So these cases deliberately assert the *observable refusal* rather than the fact
 * that some function was called:
 *
 * - the poisoned environment is real (`vi.stubEnv`, the real `lib/server/config`), so
 *   nothing here can pass against a guard that was stubbed into a no-op;
 * - `process.exit` is spied on to **throw**, which is the closest an in-process test
 *   can get to a call that never returns. Asserting that `register()` does not
 *   complete pins "the process stops here", not "a function was reached";
 * - the refusal message is read back off `process.stderr`, so a call that ran but
 *   decided nothing cannot satisfy it.
 *
 * The second thing pinned here is narrower, and it is about compilation rather than
 * behaviour (issue #829). Turbopack compiles `instrumentation.ts` for the edge target as
 * well as the Node one, so a bare `process.stderr` made every dev boot print `Ecmascript
 * file had an error` against this file. The reference now sits inside a
 * `process.env.NEXT_RUNTIME === "nodejs"` block, which Next's build-time substitution
 * turns into dead code on the edge target, and `the edge compilation path` below reads
 * the source to keep it there. A source-level assertion is the honest instrument for
 * that: no in-process test can observe what a Turbopack target did or did not emit.
 *
 * The twin is `apps/portal/instrumentation.test.ts`. The two `register()` functions
 * are separate call sites that can be unwired independently, so they get separate
 * tests rather than one shared one - a single test would let one of them rot silently.
 * **Change one, change the other.**
 */

/** Distinguishes our stubbed `process.exit` from any error the code under test throws. */
const EXIT_SENTINEL = "process.exit() called: the admin process would have terminated here";

/**
 * The configuration the guard exists to refuse: `Secure` dropped from the admin's
 * session, enrollment and recovery-code cookies at a public, non-loopback origin.
 */
function stubRefusedConfiguration(): void {
  vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
}

/** The same deployment served over HTTPS with the downgrade off: boot must proceed. */
function stubAcceptedConfiguration(): void {
  vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "true");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
}

/**
 * The runtime Next reports through `NEXT_RUNTIME`.
 *
 * `register()` is loaded on both runtimes, so a case has to say which one it speaks for.
 * Vitest is neither, and leaving the variable unset would quietly exercise the edge path
 * in tests written to cover the Node one.
 */
function stubRuntime(runtime: "nodejs" | "edge"): void {
  vi.stubEnv("NEXT_RUNTIME", runtime);
}

/** Spies on the two calls a refusal is observable through. */
function watchProcess() {
  const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`${EXIT_SENTINEL} (code ${String(code)})`);
  });
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  return { exit, stderr: () => stderr.mock.calls.map((call) => String(call[0])).join("") };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("register", () => {
  it("terminates the process instead of booting when cookie security is downgraded off loopback", () => {
    stubRefusedConfiguration();
    stubRuntime("nodejs");
    const { exit, stderr } = watchProcess();

    // `process.exit` never returns, so a `register()` that runs to completion here
    // would mean the server went on to serve requests. This is the assertion the
    // issue is about: it fails the moment the guard call leaves `register()`.
    expect(() => {
      register();
    }).toThrow(EXIT_SENTINEL);

    // Non-zero, so the container dies and the orchestrator reports a failed start
    // rather than a process that is "running" and 500ing on everything.
    expect(exit).toHaveBeenCalledWith(1);

    // The operator's only copy of the reason: it has to survive to stderr, and it has
    // to name what to change. A guard that ran but decided nothing writes nothing.
    const written = stderr();
    expect(written).toContain("Refusing to start");
    expect(written).toContain("QCMS_ADMIN_SECURE_COOKIES");
    expect(written).toContain("https://admin.example.test");
  });

  it("boots normally when the cookie configuration is one a browser will protect", () => {
    stubAcceptedConfiguration();
    stubRuntime("nodejs");
    const { exit, stderr } = watchProcess();

    // The control for the case above: it must be red because of the poisoned
    // environment, not because `register()` refuses everything.
    expect(() => {
      register();
    }).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
    expect(stderr()).toBe("");
  });

  it("still refuses, and writes nothing, when Next loads the hook on the edge runtime", () => {
    stubRefusedConfiguration();
    stubRuntime("edge");
    const { exit, stderr } = watchProcess();

    // Only the write is gated, never the refusal. `process.exit` exists here because the
    // test process is Node; in the real edge sandbox it does not, and the rethrow is what
    // an operator gets instead - the behaviour the `typeof` guard above already chose.
    expect(() => {
      register();
    }).toThrow(EXIT_SENTINEL);
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr()).toBe("");
  });
});

describe("the edge compilation path", () => {
  /** The module with its comments removed, so prose about this rule cannot satisfy it. */
  function moduleCode(): string {
    return readFileSync(new URL("./instrumentation.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
      .replace(/\s+/g, " ");
  }

  it("references process.stderr exactly once, inside the Node-runtime guard", () => {
    const code = moduleCode();

    // Turbopack drops the guarded block on the edge target because Next substitutes a
    // literal for `NEXT_RUNTIME` before this compiles, so a reference anywhere else - a
    // second write, or this one hoisted out of the block - is an `Ecmascript file had an
    // error` line on every `pnpm dev:admin` boot and every build.
    expect(code.split("process.stderr")).toHaveLength(2);
    expect(code).toContain('if (process.env.NEXT_RUNTIME === "nodejs") { process.stderr');
  });
});
