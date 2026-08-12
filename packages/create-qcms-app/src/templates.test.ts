import { describe, expect, it } from "vitest";

import { outputPath, templateFiles } from "./templates.js";

describe("outputPath", () => {
  it.each([
    ["_gitignore", ".gitignore", false],
    ["_env.example", ".env.example", false],
    ["package.json.tmpl", "package.json", true],
    ["README.md.tmpl", "README.md", true],
    ["docker/api.Dockerfile", "docker/api.Dockerfile", false],
    ["apps/portal/_gitignore", "apps/portal/.gitignore", false],
  ])("maps %j to %j", (input, expected, rendered) => {
    expect(outputPath(input)).toStrictEqual({ path: expected, rendered });
  });

  it("only rewrites the basename, never a directory", () => {
    expect(outputPath("_hidden/file.txt").path).toBe("_hidden/file.txt");
  });
});

describe("templateFiles", () => {
  it("layers the shape overlay over common", () => {
    const solo = templateFiles("solo");
    const enterprise = templateFiles("enterprise");
    expect(solo.has("docker-compose.yml")).toBe(true);
    expect(enterprise.has("docker-compose.yml")).toBe(true);
    expect(solo.has("docker-compose.proxy.yml")).toBe(true);
    expect(enterprise.has("docker-compose.proxy.yml")).toBe(false);
  });

  it("gives each shape its own README, from its own overlay", () => {
    const solo = templateFiles("solo").get("README.md");
    const enterprise = templateFiles("enterprise").get("README.md");
    expect(solo?.source).toContain("/solo/");
    expect(enterprise?.source).toContain("/enterprise/");
    expect(solo?.rendered).toBe(true);
  });

  it("marks exactly the .tmpl files as rendered", () => {
    for (const file of templateFiles("solo").values()) {
      expect(file.rendered).toBe(file.source.endsWith(".tmpl"));
    }
  });
});
