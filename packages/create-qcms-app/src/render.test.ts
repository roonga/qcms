import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PACKAGE_MANAGERS, PACKAGE_MANAGER_RATIONALE, withDefaults } from "./options.js";
import { PNPM_SPEC, renderTemplate, templateValues } from "./render.js";

const REPOSITORY_ROOT = new URL("../../../", import.meta.url);

describe("renderTemplate", () => {
  it("substitutes every occurrence of a placeholder", () => {
    expect(renderTemplate("{{a}}-{{a}}-{{b}}", { a: "x", b: "y" }, "fixture")).toBe("x-x-y");
  });

  it("throws on a placeholder nobody defined, rather than rendering it empty", () => {
    expect(() => renderTemplate("{{nope}}", { a: "x" }, "fixture.tmpl")).toThrow(/\{\{nope\}\}/);
  });

  it("names the file and the known placeholders, so the error is actionable", () => {
    expect(() => renderTemplate("{{nope}}", { known: "x" }, "fixture.tmpl")).toThrow(
      /fixture\.tmpl.*known/s,
    );
  });

  it("leaves text with no placeholders alone", () => {
    expect(renderTemplate("plain { text }", {}, "fixture")).toBe("plain { text }");
  });
});

describe("templateValues", () => {
  it.each(PACKAGE_MANAGERS)("covers every placeholder for %s", (manager) => {
    const values = templateValues(withDefaults({ packageManager: manager }, "/tmp"));
    for (const key of [
      "projectName",
      "packageManager",
      "shape",
      "adminTwoFactor",
      "portalBaseUrl",
      "adminBaseUrl",
      "installCommand",
      "runPrefix",
      "recursiveBuild",
      "recursiveTypecheck",
      "packageManagerField",
      "workspacesField",
      "packageManagerRationale",
    ]) {
      expect(values).toHaveProperty(key);
    }
  });

  it("always pins a packageManager, which corepack needs to resolve pnpm in the image", () => {
    // Never empty, for every offered manager. An empty field was the third npm/yarn
    // breakage (issue #449): the Dockerfiles run `corepack enable` then `pnpm
    // install`, so with nothing pinned an arbitrary pnpm major runs against a
    // `pnpm-workspace.yaml` that uses pnpm-11-only `allowBuilds` syntax.
    for (const manager of PACKAGE_MANAGERS) {
      const values = templateValues(withDefaults({ packageManager: manager }, "/tmp"));
      expect(values["packageManagerField"]).toContain(PNPM_SPEC);
      expect(values["packageManagerField"]).not.toBe("");
    }
  });

  it("offers pnpm and nothing else, and says why", () => {
    // The Code Owner's ruling on issue #449. If this list ever grows again, the
    // Dockerfiles have to grow with it: they COPY pnpm-lock.yaml and prune with
    // `pnpm deploy --legacy --prod`.
    expect([...PACKAGE_MANAGERS]).toStrictEqual(["pnpm"]);
    expect(PACKAGE_MANAGER_RATIONALE).toContain("pnpm deploy");
  });
});

describe("PNPM_SPEC", () => {
  it("matches the pnpm this repository itself pins", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL("package.json", REPOSITORY_ROOT), "utf8"),
    );
    if (typeof manifest !== "object" || manifest === null || !("packageManager" in manifest)) {
      throw new Error("The repository root manifest has no packageManager field to compare with.");
    }
    expect(PNPM_SPEC).toBe(manifest.packageManager);
  });
});
