import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bodyProblems, MAX_BODY_LINES } from "./check-pr-body.mjs";

const SCRIPT = fileURLToPath(new URL("./check-pr-body.mjs", import.meta.url));

const good = ["## Summary", "", "- One change.", "", "## Test plan", "", "- pnpm verify"].join(
  "\n",
);

function run(environment: Record<string, string>): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env["PATH"] ?? "", ...environment },
      encoding: "utf8",
      stdio: "pipe",
    });
    return { status: 0, output };
  } catch (error) {
    const failed = error as { status: number; stderr: string };
    return { status: failed.status, output: failed.stderr };
  }
}

describe("bodyProblems", () => {
  it("accepts a body with both headings", () => {
    expect(bodyProblems(good)).toEqual([]);
  });

  it("accepts CRLF line endings and trailing whitespace on a heading", () => {
    expect(bodyProblems(good.replaceAll("\n", "\r\n").replace("Summary", "Summary  "))).toEqual([]);
  });

  it("fires on each missing heading", () => {
    expect(bodyProblems(good.replace("## Summary", "Summary"))).toEqual([
      'missing a "## Summary" heading',
    ]);
    expect(bodyProblems(good.replace("## Test plan", "### Test plan"))).toEqual([
      'missing a "## Test plan" heading',
    ]);
    expect(bodyProblems("")).toHaveLength(2);
  });

  it("allows exactly the line limit and fires one line over it", () => {
    const filler = (count: number): string =>
      [good, ...Array.from({ length: count }, (_, i) => `- line ${String(i)}`)].join("\n");
    const atLimit = filler(MAX_BODY_LINES - 7);
    expect(atLimit.split("\n")).toHaveLength(MAX_BODY_LINES);
    expect(bodyProblems(atLimit)).toEqual([]);
    expect(bodyProblems(filler(MAX_BODY_LINES - 6))).toEqual([
      `${String(MAX_BODY_LINES + 1)} lines (limit ${String(MAX_BODY_LINES)})`,
    ]);
  });

  it("does not count trailing blank lines", () => {
    expect(bodyProblems(`${good}${"\n".repeat(40)}`)).toEqual([]);
  });
});

describe("check-pr-body CLI", () => {
  it("warns on a pull request with a bad body without failing", () => {
    const result = run({ GITHUB_EVENT_NAME: "pull_request", PR_AUTHOR: "someone", PR_BODY: "x" });
    expect(result.status).toBe(0);
    expect(result.output).toContain("::warning::");
    expect(result.output).toContain("## Summary");
  });

  it("passes a pull request with a good body", () => {
    expect(
      run({ GITHUB_EVENT_NAME: "pull_request", PR_AUTHOR: "someone", PR_BODY: good }).status,
    ).toBe(0);
  });

  it("skips Dependabot and non pull request events", () => {
    expect(
      run({ GITHUB_EVENT_NAME: "pull_request", PR_AUTHOR: "dependabot[bot]", PR_BODY: "x" }).status,
    ).toBe(0);
    expect(run({ GITHUB_EVENT_NAME: "push", PR_BODY: "x" }).status).toBe(0);
  });
});
