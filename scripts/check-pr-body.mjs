#!/usr/bin/env node
// @ts-check
/**
 * The written text rule for a pull request body. Imports only `node:`, because the
 * `changes (ci)` job runs it before any install.
 */

import { argv, env } from "node:process";
import { pathToFileURL } from "node:url";

export const MAX_BODY_LINES = 30;
export const REQUIRED_HEADINGS = ["## Summary", "## Test plan"];
export const SKIPPED_AUTHORS = ["dependabot[bot]"];

export function bodyProblems(body) {
  const lines = body.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const problems = REQUIRED_HEADINGS.filter(
    (heading) => !lines.some((line) => line.trimEnd() === heading),
  ).map((heading) => `missing a "${heading}" heading`);
  if (lines.length > MAX_BODY_LINES) {
    problems.push(`${lines.length} lines (limit ${MAX_BODY_LINES})`);
  }
  return problems;
}

function main() {
  if (env["GITHUB_EVENT_NAME"] !== "pull_request") {
    console.log("check-pr-body: not a pull request, skipped");
    return;
  }
  if (SKIPPED_AUTHORS.includes(env["PR_AUTHOR"] ?? "")) {
    console.log(`check-pr-body: ${env["PR_AUTHOR"]} pull request, skipped`);
    return;
  }
  const problems = bodyProblems(env["PR_BODY"] ?? "");
  if (problems.length === 0) {
    console.log("check-pr-body: OK");
    return;
  }
  for (const problem of problems) console.error(`::error::PR body: ${problem}`);
  console.error(
    'See "Written text" in PROJECT_INSTRUCTIONS.md: "## Summary" and "## Test plan", in short bullets.',
  );
  process.exitCode = 1;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
