import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  checkAllEntries,
  checkScriptsIn,
  compareLists,
  workflowEntries,
} from "./check-ci-parity.mjs";

const REPO_ROOT = new URL("../", import.meta.url);
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, REPO_ROOT)), "utf8");

const manifest = (checkAll: string): string =>
  JSON.stringify({ scripts: { "check:all": checkAll, verify: "pnpm check:all && pnpm build" } });

describe("reading the check list out of a shell command", () => {
  it("takes every pnpm-invoked check, in order, without duplicates", () => {
    expect(
      checkScriptsIn("pnpm check:ports && pnpm run check:licenses && pnpm check:ports"),
    ).toEqual(["check:ports", "check:licenses"]);
  });

  it("ignores a check name that is not being invoked", () => {
    expect(checkScriptsIn("see check:ports in scripts/check-ports.mjs")).toEqual([]);
    expect(checkScriptsIn("node scripts/check-ports.mjs")).toEqual([]);
  });
});

describe("reading the workflow", () => {
  it("does not count a check named only in a YAML comment", () => {
    // `.github/workflows/ci.yml` names gates in prose comments, so counting a mention
    // would report a step that does not exist.
    const workflow = [
      "jobs:",
      "  verify:",
      "    steps:",
      "      # Adding a gate to `pnpm check:all` does NOT run it in CI (issue #463).",
      "      # Not this either: pnpm check:security-hygiene",
      "      - run: pnpm check:ports",
    ].join("\n");
    expect(workflowEntries(workflow)).toEqual(["check:ports"]);
  });

  it("does not count the plan-only fast lane as a member of check:all", () => {
    // `check:plan` replaces `check:all` on a plan-only pull request, so it is a CI step
    // that must never be required to appear in `check:all`.
    const workflow = ["      - run: pnpm check:plan", "      - run: pnpm check:ports"].join("\n");
    expect(workflowEntries(workflow)).toEqual(["check:ports"]);
  });
});

describe("comparing the two lists", () => {
  it("names a gate that runs locally and never in CI", () => {
    const inCheckAll = checkAllEntries(manifest("pnpm check:ports && pnpm check:new-gate"));
    const inWorkflow = workflowEntries("      - run: pnpm check:ports");
    expect(compareLists(inCheckAll, inWorkflow)).toEqual({
      missingFromWorkflow: ["check:new-gate"],
      missingFromCheckAll: [],
    });
  });

  it("names a gate that runs in CI and not in check:all", () => {
    // CONTRIBUTING requires `pnpm verify` to be a superset of CI, or a local green stops
    // predicting the merge verdict.
    const inCheckAll = checkAllEntries(manifest("pnpm check:ports"));
    const inWorkflow = workflowEntries(
      ["      - run: pnpm check:ports", "      - run: pnpm check:only-in-ci"].join("\n"),
    );
    expect(compareLists(inCheckAll, inWorkflow)).toEqual({
      missingFromWorkflow: [],
      missingFromCheckAll: ["check:only-in-ci"],
    });
  });

  it("reports parity when the same set is in both, whatever the order", () => {
    const inCheckAll = checkAllEntries(manifest("pnpm check:ports && pnpm check:licenses"));
    const inWorkflow = workflowEntries(
      ["      - run: pnpm check:licenses", "      - run: pnpm check:ports"].join("\n"),
    );
    expect(compareLists(inCheckAll, inWorkflow)).toEqual({
      missingFromWorkflow: [],
      missingFromCheckAll: [],
    });
  });
});

describe("the repository's own lists", () => {
  it("has every check:all gate as a ci.yml step and vice versa", () => {
    const inCheckAll = checkAllEntries(read("package.json"));
    const inWorkflow = workflowEntries(read(".github/workflows/ci.yml"));
    expect(inCheckAll.length).toBeGreaterThan(0);
    expect(compareLists(inCheckAll, inWorkflow)).toEqual({
      missingFromWorkflow: [],
      missingFromCheckAll: [],
    });
  });

  it("includes itself in both lists", () => {
    expect(checkAllEntries(read("package.json"))).toContain("check:ci-parity");
    expect(workflowEntries(read(".github/workflows/ci.yml"))).toContain("check:ci-parity");
  });
});
