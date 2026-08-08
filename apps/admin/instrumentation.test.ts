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
 * The twin is `apps/portal/instrumentation.test.ts`. The two `register()` functions
 * are separate call sites that can be unwired independently, so they get separate
 * tests rather than one shared one - a single test would let one of them rot silently.
 * **Change one, change the other.**
 */

/** Distinguishes our stubbed `process.exit` from any error the code under test throws. */
const EXIT_SENTINEL = "process.exit() called: the admin process would have terminated here";

/**
 * The configuration the guard exists to refuse: `Secure` dropped from the admin's
 * session, enrollment and recovery-view cookies at a public, non-loopback origin.
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
    const { exit, stderr } = watchProcess();

    // The control for the case above: it must be red because of the poisoned
    // environment, not because `register()` refuses everything.
    expect(() => {
      register();
    }).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
    expect(stderr()).toBe("");
  });
});
