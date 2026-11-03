import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "./instrumentation";

/** Exercise real poisoned configuration and a throwing exit spy so an unwired guard cannot pass. Source checks separately enforce the Node-only stream reference that edge compilation requires. */

const EXIT_SENTINEL = "process.exit() called: the admin process would have terminated here";

function stubRefusedConfiguration(): void {
  vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "false");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
}

function stubAcceptedConfiguration(): void {
  vi.stubEnv("QCMS_ADMIN_SECURE_COOKIES", "true");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("QCMS_ADMIN_BASE_URL", "https://admin.example.test");
}

/** Vitest has no Next runtime; set nodejs explicitly so refusal tests cannot silently exercise only the edge path. */
function stubRuntime(runtime: "nodejs" | "edge"): void {
  vi.stubEnv("NEXT_RUNTIME", runtime);
}

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

    /** A successful return would allow the process to keep serving after a refused deployment. */
    expect(() => {
      register();
    }).toThrow(EXIT_SENTINEL);

    /** Nonzero exit makes refusal visible to the orchestrator. */
    expect(exit).toHaveBeenCalledWith(1);

    /** The operator must receive the reason and variable name on stderr. */
    const written = stderr();
    expect(written).toContain("Refusing to start");
    expect(written).toContain("QCMS_ADMIN_SECURE_COOKIES");
    expect(written).toContain("https://admin.example.test");
  });

  it("boots normally when the cookie configuration is one a browser will protect", () => {
    stubAcceptedConfiguration();
    stubRuntime("nodejs");
    const { exit, stderr } = watchProcess();

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

    /** Only stderr is Node-gated; edge compilation must retain the refusal and rethrow. */
    expect(() => {
      register();
    }).toThrow(EXIT_SENTINEL);
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr()).toBe("");
  });
});

describe("the edge compilation path", () => {
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

    /** Next substitutes NEXT_RUNTIME at build time; only the guarded block can contain Node streams in the edge target. */
    expect(code.split("process.stderr")).toHaveLength(2);
    expect(code).toContain('if (process.env.NEXT_RUNTIME === "nodejs") { process.stderr');
  });
});
