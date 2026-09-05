import { describe, expect, it } from "vitest";

import {
  bumpFor,
  changesetFileName,
  manifestDependencyMoves,
  renderChangeset,
} from "./dependabot-changeset.mjs";

import { parseChangesetPackages } from "./check-changeset.mjs";

/**
 * Tests for the Dependabot changeset generator (issue #421).
 *
 * The generator's value is that its output satisfies `check:changeset`, so the last
 * assertion here is the round trip: the rendered frontmatter is parsed back by the
 * gate's own reader and must name the packages it was built for. Everything above it
 * pins the two judgements the generator makes on its own - which moves earn a minor,
 * and what it refuses to describe.
 */

const manifest = (fields: Record<string, unknown>): string =>
  JSON.stringify({ name: "@roonga/qcms-db", version: "0.0.0", ...fields });

describe("manifestDependencyMoves", () => {
  it("reports a range that moved", () => {
    const before = manifest({ dependencies: { pg: "^8.22.0" } });
    const after = manifest({ dependencies: { pg: "^8.23.0" } });
    const { moves, otherFieldsChanged } = manifestDependencyMoves(before, after);
    expect(otherFieldsChanged).toBe(false);
    expect(moves).toStrictEqual([
      { field: "dependencies", name: "pg", from: "^8.22.0", to: "^8.23.0" },
    ]);
  });

  it("reports nothing when only key order differs", () => {
    const before = manifest({ dependencies: { pg: "^8.22.0", zod: "^4.0.0" } });
    const after = manifest({ dependencies: { zod: "^4.0.0", pg: "^8.22.0" } });
    expect(manifestDependencyMoves(before, after).moves).toStrictEqual([]);
  });

  it("flags a change outside the dependency blocks", () => {
    // The refusal case. A `files` or `exports` edit riding inside a bump is not
    // dependency maintenance, and describing it as such is the failure mode that would
    // make the generated changelog lie.
    const before = manifest({ dependencies: { pg: "^8.22.0" }, files: ["dist"] });
    const after = manifest({ dependencies: { pg: "^8.23.0" }, files: ["dist", "README.md"] });
    expect(manifestDependencyMoves(before, after).otherFieldsChanged).toBe(true);
  });
});

describe("bumpFor", () => {
  it("takes a minor when the peer contract moves", () => {
    // The precedent is .changeset/deps-410-grouped-minor-and-patch.md: a peer range is
    // what tells a consumer's package manager which versions satisfy the ask that
    // @roonga/qcms-db/testing makes of it (issue #156), so moving it can require action.
    expect(bumpFor([{ field: "peerDependencies" }, { field: "devDependencies" }])).toBe("minor");
  });

  it("takes a patch for everything else", () => {
    expect(bumpFor([{ field: "dependencies" }, { field: "devDependencies" }])).toBe("patch");
  });
});

describe("changesetFileName", () => {
  it("derives a stable name from the branch, so a re-run rewrites its own file", () => {
    expect(changesetFileName("dependabot/npm_and_yarn/minor-and-patch-6dae55273e")).toBe(
      "dependabot-npm-and-yarn-minor-and-patch-6dae55273e.md",
    );
    expect(changesetFileName("dependabot/npm_and_yarn/minor-and-patch-6dae55273e")).toBe(
      changesetFileName("dependabot/npm_and_yarn/minor-and-patch-6dae55273e"),
    );
  });

  it("still produces a name for a branch with nothing usable in it", () => {
    expect(changesetFileName("///")).toBe("dependabot-deps.md");
  });
});

describe("renderChangeset", () => {
  const rendered = renderChangeset([
    {
      name: "@roonga/qcms-db",
      bump: "minor",
      moves: [
        {
          field: "peerDependencies",
          name: "testcontainers",
          from: "^12.0.4",
          to: "^12.1.0",
        },
        { field: "devDependencies", name: "@types/pg", from: "^8.20.3", to: "^8.23.1" },
      ],
    },
    {
      name: "@roonga/qcms-ui",
      bump: "patch",
      moves: [{ field: "devDependencies", name: "@types/react", from: "^19.2.18", to: "^19.2.19" }],
    },
  ]);

  it("is read back by the gate's own frontmatter parser", () => {
    // The whole point: what this writes has to satisfy `check:changeset`, which reads
    // frontmatter with parseChangesetPackages and nothing else.
    expect(parseChangesetPackages(rendered)).toStrictEqual(["@roonga/qcms-db", "@roonga/qcms-ui"]);
  });

  it("separates what a consumer resolves from what it does not", () => {
    expect(rendered).toContain("Ranges a consumer resolves against:");
    expect(rendered).toContain("`testcontainers` ^12.0.4 to ^12.1.0 (peerDependencies)");
    expect(rendered).toContain("Development ranges, which reach no consumer:");
  });
});
