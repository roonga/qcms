import { defineConfig } from "vitest/config";

// Single root Vitest configuration - every package and app is a project here;
// no per-package runners or configs. (Vitest 4 removed vitest.workspace.ts;
// test.projects is its replacement - task 001.)
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*"],
    // Coverage is a root-level concern in Vitest 4 (projects cannot carry
    // their own). Scope: the kernel (task 009 exit criterion 4 - lines
    // >= 95% across tasks 002-009, `pnpm --filter @qcms/core coverage`).
    // Test files are excluded by Vitest's defaults.
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**"],
      thresholds: {
        lines: 95,
      },
    },
  },
});
