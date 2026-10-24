import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

// The component-test project (ADR-23 layer 2), registered by the root config's
// `packages/*` glob.
export default defineProject({
  test: {
    name: "@roonga/qcms-ui",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
