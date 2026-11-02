import { defineProject } from "vitest/config";

import { APP_ALIAS, APP_ROOT } from "./vitest.config.ts";

/** Registered explicitly: the root apps glob only discovers the default Vitest config. */
export default defineProject({
  test: {
    name: "qcms-admin-dom",
    root: APP_ROOT,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.tsx"],
  },
  resolve: {
    alias: APP_ALIAS,
  },
});
