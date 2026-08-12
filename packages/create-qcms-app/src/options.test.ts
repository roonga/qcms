import { describe, expect, it } from "vitest";

import {
  DEFAULTS,
  helpText,
  normalizeBaseUrl,
  parseArguments,
  validateBaseUrl,
  validateProjectName,
  withDefaults,
} from "./options.js";

const CWD = "/workspace";

function options(argv: readonly string[]) {
  const parsed = parseArguments(argv, CWD);
  if (parsed.kind !== "options") throw new Error(`expected options, got ${parsed.kind}`);
  return parsed;
}

describe("project name validation", () => {
  it("accepts a plain lowercase name", () => {
    expect(validateProjectName("my-forms")).toBeUndefined();
  });

  it.each([
    ["", "empty"],
    ["My Forms", "spaces and capitals"],
    ["-leading", "a leading hyphen"],
    ["../escape", "a path traversal"],
    ["a".repeat(215), "over the length limit"],
  ])("refuses %j (%s)", (name) => {
    expect(validateProjectName(name)).toBeDefined();
  });
});

describe("base URL validation", () => {
  it("accepts an absolute http origin", () => {
    expect(validateBaseUrl("http://localhost:7000", "The portal base URL")).toBeUndefined();
  });

  it("refuses a relative path", () => {
    expect(validateBaseUrl("/forms", "The portal base URL")).toContain("absolute");
  });

  it("refuses a non-http scheme", () => {
    expect(validateBaseUrl("ftp://example.com", "The portal base URL")).toContain("http");
  });

  it("strips one trailing slash, the way the API's own parser does", () => {
    expect(normalizeBaseUrl("https://forms.example.com/")).toBe("https://forms.example.com");
  });
});

describe("argument parsing", () => {
  it("reads the first bare word as the project name and resolves the target", () => {
    const parsed = options(["my-forms"]);
    expect(parsed.options.projectName).toBe("my-forms");
    expect(parsed.options.targetDirectory).toBe("/workspace/my-forms");
  });

  it("reads --flag value and --flag=value the same way", () => {
    expect(options(["--shape", "enterprise"]).options.shape).toBe("enterprise");
    expect(options(["--shape=enterprise"]).options.shape).toBe("enterprise");
  });

  it("records --yes without treating it as a value-taking flag", () => {
    const parsed = options(["forms", "--yes"]);
    expect(parsed.assumeYes).toBe(true);
    expect(parsed.options.projectName).toBe("forms");
  });

  it("turns the negative flags into their options", () => {
    const parsed = options(["--no-install", "--no-git", "--force"]);
    expect(parsed.options.install).toBe(false);
    expect(parsed.options.git).toBe(false);
    expect(parsed.options.force).toBe(true);
  });

  it("normalizes a base URL given by flag", () => {
    expect(options(["--portal-base-url=https://forms.example.com/"]).options.portalBaseUrl).toBe(
      "https://forms.example.com",
    );
  });

  it.each([
    [["--shape", "kubernetes"], "shape"],
    [["--package-manager", "bun"], "package-manager"],
    [["--admin-2fa", "off"], "admin-2fa"],
    [["--portal-base-url", "not a url"], "portal-base-url"],
    [["--shape"], "needs a value"],
    [["--nonsense", "x"], "Unknown option"],
    [["one", "two"], "extra argument"],
    [["Bad Name"], "usable project name"],
  ])("refuses %j", (argv, fragment) => {
    const parsed = parseArguments(argv, CWD);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain(fragment);
  });

  it("reports help and version before anything else", () => {
    expect(parseArguments(["forms", "--help"], CWD).kind).toBe("help");
    expect(parseArguments(["forms", "-v"], CWD).kind).toBe("version");
  });
});

describe("defaults", () => {
  it("fills every unanswered option", () => {
    const filled = withDefaults({}, CWD);
    expect(filled).toMatchObject({
      projectName: DEFAULTS.projectName,
      packageManager: DEFAULTS.packageManager,
      shape: DEFAULTS.shape,
      adminTwoFactor: DEFAULTS.adminTwoFactor,
      portalBaseUrl: DEFAULTS.portalBaseUrl,
      adminBaseUrl: DEFAULTS.adminBaseUrl,
      install: true,
      git: true,
      force: false,
    });
    expect(filled.targetDirectory).toBe("/workspace/my-forms");
  });

  it("never overwrites an answer", () => {
    expect(withDefaults({ shape: "enterprise" }, CWD).shape).toBe("enterprise");
  });
});

describe("help text", () => {
  it("names every option the parser accepts", () => {
    const text = helpText();
    for (const flag of [
      "--yes",
      "--package-manager",
      "--shape",
      "--admin-2fa",
      "--portal-base-url",
      "--admin-base-url",
      "--no-install",
      "--no-git",
      "--force",
    ]) {
      expect(text).toContain(flag);
    }
  });
});
