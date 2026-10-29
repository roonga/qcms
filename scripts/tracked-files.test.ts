import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

describe("trackedFilesUnder", () => {
  it("returns paths relative to the root it is given", () => {
    const files = trackedFilesUnder(join(REPO_ROOT, "scripts"), { match: /^tracked-files\./ });
    expect(files).toEqual(["tracked-files.d.mts", "tracked-files.mjs", "tracked-files.test.ts"]);
  });

  it("sorts the result, so a caller comparing two sets does not have to", () => {
    const files = trackedFilesUnder(join(REPO_ROOT, "scripts"), { match: /\.mjs$/ });
    expect(files).toEqual([...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("omits a git-ignored path, which is the whole point of asking git", () => {
    // A walk of `apps/admin` reads whatever a previous build left in the ignored
    // `.next` directories, whether or not this checkout has run one.
    const files = trackedFilesUnder(join(REPO_ROOT, "apps", "admin"));
    expect(files.filter((path) => path.startsWith(".next"))).toEqual([]);
    expect(files).toContain("lib/rail-routes.test.ts");
  });

  it("counts a new, unstaged source file, so the set is not defeatable by not staging", () => {
    const directory = mkdtempSync(join(REPO_ROOT, "scripts", "tmp-tracked-files-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "new-file.ts"), "export const added = true;\n", "utf8");
    expect(trackedFilesUnder(directory)).toEqual(["new-file.ts"]);
  });

  it("refuses a global match, which would silently drop about half the paths", () => {
    // `test` on a `g` pattern advances `lastIndex` and resumes there, so filtering with one
    // returns a shorter corpus and no error. Refused rather than repaired.
    expect(() => trackedFilesUnder(join(REPO_ROOT, "scripts"), { match: /\.mjs$/g })).toThrow(
      /must not be global or sticky/,
    );
  });

  it("refuses a sticky match for the same reason", () => {
    expect(() => trackedFilesUnder(join(REPO_ROOT, "scripts"), { match: /\.mjs$/y })).toThrow(
      /must not be global or sticky/,
    );
  });

  it("shows the shrink the refusal prevents, so the guard is not taken on faith", () => {
    const paths = ["a.mjs", "b.mjs", "c.mjs", "d.mjs"];
    const stateful = /\.mjs$/g;
    expect(paths.filter((path) => stateful.test(path)).length).toBeLessThan(paths.length);
    expect(paths.filter((path) => /\.mjs$/.test(path))).toEqual(paths);
  });

  it("throws rather than returning nothing when the root is not a directory", () => {
    expect(() => trackedFilesUnder(join(REPO_ROOT, "scripts", "no-such-directory"))).toThrow(
      /not a directory/,
    );
  });

  it("throws when git lists nothing, so an empty set is never a vacuous pass", () => {
    const directory = mkdtempSync(join(REPO_ROOT, "scripts", "tmp-tracked-files-"));
    temporaryDirectories.push(directory);
    expect(() => trackedFilesUnder(directory)).toThrow(/listed no files/);
  });
});
