import { defineProject } from "vitest/config";

import { APP_ALIAS, APP_ROOT } from "./vitest.config.ts";

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
