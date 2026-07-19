import { defineConfig } from "vitest/config";

// Single root Vitest configuration - every package and app is a project here;
// no per-package runners or configs. (Vitest 4 removed vitest.workspace.ts;
// test.projects is its replacement - task 001.)
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
  },
});
