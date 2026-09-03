import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PACKAGE_MANAGER, PACKAGE_MANAGER_RATIONALE, helpText, withDefaults } from "./options.js";
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
  it("covers every placeholder", () => {
    const values = templateValues(withDefaults({}, "/tmp"));
    for (const key of [
      "projectName",
      "shape",
      "adminTwoFactor",
      "portalBaseUrl",
      "adminBaseUrl",
      "installCommand",
      "runPrefix",
      "recursiveBuild",
      "recursiveTypecheck",
      "packageManagerField",
      "packageManagerRationale",
    ]) {
      expect(values).toHaveProperty(key);
    }
  });

  it("defines no per-manager placeholder any more", () => {
    // `workspacesField` existed for npm and yarn, and `packageManager` named a choice
    // the adopter no longer makes. A placeholder nothing sets is how a deleted path
    // comes back: a template that referenced one would render it and nobody would
    // notice. `renderTemplate` throws on an undefined placeholder, so their absence
    // here is what keeps them out of the templates (issue #449).
    const values = templateValues(withDefaults({}, "/tmp"));
    expect(values).not.toHaveProperty("workspacesField");
    expect(values).not.toHaveProperty("packageManager");
  });

  it("always pins a packageManager, which corepack needs to resolve pnpm in the image", () => {
    // Never empty. An empty field was the third npm/yarn breakage (issue #449): the
    // Dockerfiles run `corepack enable` then `pnpm install`, so with nothing pinned an
    // arbitrary pnpm major runs against a `pnpm-workspace.yaml` that uses pnpm-11-only
    // `allowBuilds` syntax.
    const values = templateValues(withDefaults({}, "/tmp"));
    expect(values["packageManagerField"]).toContain(PNPM_SPEC);
    expect(values["packageManagerField"]).not.toBe("");
  });

  it("renders every command through pnpm and nothing else", () => {
    // The Code Owner's ruling on issue #449, checked at the values the templates
    // actually receive rather than at a list of offered names: if a second manager
    // ever comes back, the Dockerfiles have to come with it, because they COPY
    // pnpm-lock.yaml and prune with `pnpm deploy --legacy --prod`.
    const values = templateValues(withDefaults({}, "/tmp"));
    for (const key of ["installCommand", "runPrefix", "recursiveBuild", "recursiveTypecheck"]) {
      expect(values[key]).toContain(PACKAGE_MANAGER);
    }
    expect(PACKAGE_MANAGER_RATIONALE).toContain("pnpm deploy");
  });

  it("states the reason in --help, where an adopter meets it first", () => {
    // Wrapped for a terminal, so compare the words rather than the line breaks: the
    // constant is one string shared with two Markdown READMEs, which reflow it.
    expect(helpText().replace(/\s+/g, " ")).toContain(
      PACKAGE_MANAGER_RATIONALE.replace(/\s+/g, " "),
    );
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
