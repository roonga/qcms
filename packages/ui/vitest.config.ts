import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

// The @qcms/ui component-test project (ADR-23 layer 2): testing-library + axe in
// jsdom over the golden corpus. Registered as a project by the root config's
// `packages/*` glob. JSX is compiled by esbuild with the automatic runtime.
export default defineProject({
  test: {
    name: "@qcms/ui",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
