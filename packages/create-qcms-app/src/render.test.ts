import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { withDefaults, type PackageManager } from "./options.js";
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
  it.each<PackageManager>(["pnpm", "npm", "yarn"])("covers every placeholder for %s", (manager) => {
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
    ]) {
      expect(values).toHaveProperty(key);
    }
  });

  it("pins pnpm only for the pnpm choice, and declares workspaces only for the others", () => {
    const pnpm = templateValues(withDefaults({ packageManager: "pnpm" }, "/tmp"));
    expect(pnpm["packageManagerField"]).toContain(PNPM_SPEC);
    expect(pnpm["workspacesField"]).toBe("");

    for (const manager of ["npm", "yarn"] as const) {
      const values = templateValues(withDefaults({ packageManager: manager }, "/tmp"));
      expect(values["packageManagerField"]).toBe("");
      expect(values["workspacesField"]).toContain("apps/*");
    }
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
