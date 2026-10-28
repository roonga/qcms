import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "./instrumentation";

vi.mock("@vercel/otel", () => ({ registerOTel: vi.fn() }));

/** Distinguishes the stubbed `process.exit` from any error the code under test throws. */
const EXIT_SENTINEL = "process.exit() called: the portal process would have terminated here";

/** `Secure` dropped at a public, non-loopback origin. */
function stubRefusedConfiguration(): void {
  vi.stubEnv("QCMS_SECURE_COOKIES", "false");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
}

function stubAcceptedConfiguration(): void {
  vi.stubEnv("QCMS_SECURE_COOKIES", "true");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("QCMS_PORTAL_BASE_URL", "https://forms.example.test");
}

/**
 * `register()` is loaded on both runtimes, so a case has to say which one it speaks for:
 * Vitest is neither, and leaving the variable unset would quietly exercise the edge path
 * in tests written for the Node one.
 */
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
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", undefined);
    const { exit, stderr } = watchProcess();

    expect(() => {
      register();
    }).toThrow(EXIT_SENTINEL);

    expect(exit).toHaveBeenCalledWith(1);

    const written = stderr();
    expect(written).toContain("Refusing to start");
    expect(written).toContain("QCMS_SECURE_COOKIES");
    expect(written).toContain("https://forms.example.test");
  });

  it("refuses before registering OpenTelemetry, so nothing else in boot runs first", async () => {
    stubRefusedConfiguration();
    stubRuntime("nodejs");
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector.example.test:4318");
    const { exit } = watchProcess();
    const { registerOTel } = await import("@vercel/otel");

    expect(() => {
      register();
    }).toThrow(EXIT_SENTINEL);
    expect(exit).toHaveBeenCalledWith(1);
    expect(registerOTel).not.toHaveBeenCalled();
  });

  it("boots normally when the cookie configuration is one a browser will protect", () => {
    stubAcceptedConfiguration();
    stubRuntime("nodejs");
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", undefined);
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
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", undefined);
    const { exit, stderr } = watchProcess();

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

    expect(code.split("process.stderr")).toHaveLength(2);
    expect(code).toContain('if (process.env.NEXT_RUNTIME === "nodejs") { process.stderr');
  });
});
