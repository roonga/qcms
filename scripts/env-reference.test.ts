import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REPOSITORY_ROOT } from "./docker.mjs";
import {
  apiRequirementFromParsers,
  BEGIN_MARKER,
  currentBlock,
  END_MARKER,
  ENV_REFERENCE,
  OPERATIONS_DOC,
  rateClassSuffixes,
  renderEnvReference,
  scanEnvNames,
} from "./env-reference.mjs";

/**
 * The env-reference drift gate (task 036, exit criterion 2: "env reference
 * generated and asserted against the config schema").
 *
 * `scripts/env-reference.mjs` holds a hand-written table of every variable an
 * operator can set, and renders it into `docs/operations.md`. A hand-written table
 * is the right shape (a useful description cannot be extracted from a parser call)
 * and the wrong shape (prose rots silently while the code moves). This file is the
 * seam between the two: **the machine owns the names and the requirement, the human
 * owns the prose.**
 *
 * That split is what makes the gate honest. Asserting the whole table against the
 * code would mean generating the descriptions too, and asserting nothing would let
 * 017's composition root grow a variable that no operator ever hears about. So the
 * two columns that drift silently are the two that are checked, in both directions:
 * a variable added to `apps/api/src/config.ts` fails here until it is documented,
 * and a variable deleted from the code fails here until its row goes.
 *
 * The document check is byte-for-byte rather than "contains the name", because the
 * generator is only trustworthy if running it is a no-op on a clean tree. Anyone
 * who edits the table and forgets `node scripts/env-reference.mjs --write` gets a
 * diff here rather than a stale table in the published docs.
 */

/** The processes whose source is scanned. Compose is checked separately, below. */
const APPLICATION_PROCESSES = ["api", "portal", "admin"] as const;

/** The table's rows for one process, as a sorted name list. */
function documented(process: string): string[] {
  return ENV_REFERENCE.filter((entry) => entry.process === process)
    .map((entry) => entry.name)
    .sort();
}

/** What the source actually reads, as a sorted name list. */
function scanned(process: string): string[] {
  return [...scanEnvNames(process)].sort();
}

describe("env reference matches the code that reads the variables", () => {
  it.each(APPLICATION_PROCESSES)("documents exactly what %s reads", (process) => {
    // Both directions in one assertion, so the failure message names the offending
    // variable rather than reporting two counts that differ by one.
    expect(documented(process)).toEqual(scanned(process));
  });

  it("agrees with the API parsers about which variables are required", () => {
    // The API's composition root is the only process whose requirement is machine
    // readable: every variable arrives through a `parseX(env, "NAME", ...)` helper,
    // and which helper it is decides whether a missing value is fatal. Portal and
    // admin read `process.env` directly, so their requirement column stays prose.
    const fromParsers = apiRequirementFromParsers();
    const fromTable = new Map(
      ENV_REFERENCE.filter((entry) => entry.process === "api").map((entry) => [
        entry.name,
        entry.requirement,
      ]),
    );
    // Not emptiness for its own sake: if the helper regex ever stops matching, every
    // per-variable check below vacuously passes and the gate silently stops working.
    // This guard has already earned its place once, catching a scan that returned
    // nothing while the loop below reported a clean bill of health.
    expect(fromParsers.size).toBeGreaterThan(10);
    for (const [name, requirement] of fromParsers) {
      expect(fromTable.get(name), `${name} requirement`).toBe(requirement);
    }
  });

  it("keeps a rate-class prefix's two real variables in the table", () => {
    // `parseRateClass(env, "PREFIX", ...)` reads `PREFIX_WINDOW_MS` and `PREFIX_MAX`.
    // The prefix itself is not a variable, so a table listing it would document a
    // name no operator can set. The suffixes are read out of the helper's own body,
    // and this asserts that read still returns something usable.
    const suffixes = rateClassSuffixes();
    expect(suffixes).toEqual(["_WINDOW_MS", "_MAX"]);
    const names = new Set(ENV_REFERENCE.map((entry) => entry.name));
    for (const name of names) {
      if (!name.endsWith("_WINDOW_MS")) continue;
      const prefix = name.slice(0, -"_WINDOW_MS".length);
      expect(names.has(`${prefix}_MAX`), `${prefix} documents a window but no max`).toBe(true);
    }
  });
});

describe("group membership", () => {
  it("files a shared variable under the application, never twice", () => {
    // A name both an app and the Compose files read (QCMS_LINK_KEYS is the obvious
    // one) belongs to the app group: that is where its meaning lives. The compose
    // group is therefore the compose scan MINUS the three app scans, and a row
    // appearing in both groups would render the same variable twice in one document.
    const applicationNames = new Set(APPLICATION_PROCESSES.flatMap((p) => scanned(p)));
    const composeOnly = [...scanEnvNames("compose")]
      .filter((name) => !applicationNames.has(name))
      .sort();
    expect(documented("compose")).toEqual(composeOnly);
  });

  it("gives every variable exactly one row per process that reads it", () => {
    // Uniqueness is per (name, process), not per name. Eleven variables are read by
    // more than one process (`QCMS_INTERNAL_TOKEN` by all three, `NODE_ENV` likewise),
    // and each gets its own row because what an operator needs to know differs by
    // process: the API's `QCMS_ADMIN_BASE_URL` is the origin better-auth trusts, the
    // admin's is its own public identity. Collapsing them would lose that.
    const keys = ENV_REFERENCE.map((entry) => `${entry.process}:${entry.name}`);
    expect(keys).toEqual([...new Set(keys)]);
  });
});

describe("the operator-facing sample environment", () => {
  it("documents every variable .env.compose.example sets", () => {
    // The sample file is what an adopter copies. A variable it sets that the
    // reference never mentions is a variable nobody can look up.
    const sample = readFileSync(join(REPOSITORY_ROOT, ".env.compose.example"), "utf8");
    const assigned = [...sample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
    expect(assigned.length).toBeGreaterThan(0);
    const documentedNames = new Set(ENV_REFERENCE.map((entry) => entry.name));
    for (const name of assigned) {
      expect(documentedNames.has(name), `${name} is set in the sample but undocumented`).toBe(true);
    }
  });
});

describe("the generated block in the operations guide", () => {
  it("is byte-for-byte what the generator produces", () => {
    // Equivalent to running `node scripts/env-reference.mjs --write` and finding no
    // diff. The fix when this fails is exactly that command.
    expect(currentBlock()).toBe(renderEnvReference());
  });

  it("renders a secret's name without ever rendering a value", () => {
    // SEC-8: secrets are named, never echoed. The table has a `secret` flag and no
    // value column at all, and the sample values live in .env.compose.example.
    const block = currentBlock();
    for (const entry of ENV_REFERENCE) {
      if (entry.secret !== true) continue;
      expect(block).toContain(`\`${entry.name}\` (secret)`);
    }
  });

  it("is the guide's one generated region, delimited once", () => {
    // Deliberately NOT `expect(doc).toContain(currentBlock())`: `currentBlock()` is a
    // slice of this very document, so that assertion cannot fail and reads as coverage
    // it does not provide. What is worth asserting is that there is exactly one region
    // to slice. A second copy of either marker would leave `currentBlock()` describing
    // one region while a reader read the other, and the drift test above would then
    // pass while the visible table rotted.
    const doc = readFileSync(join(REPOSITORY_ROOT, OPERATIONS_DOC), "utf8");
    expect(doc.split(BEGIN_MARKER)).toHaveLength(2);
    expect(doc.split(END_MARKER)).toHaveLength(2);
    expect(doc.indexOf(BEGIN_MARKER)).toBeLessThan(doc.indexOf(END_MARKER));
  });
});
