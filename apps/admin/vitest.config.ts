import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

// Shared aliases keep imports and mocks bound to the same module in both test projects.
export default defineProject({
  test: {
    name: "qcms-admin",
    root: APP_ROOT,
    include: ["**/*.test.ts"],
  },
  resolve: {
    alias: APP_ALIAS,
  },
});
