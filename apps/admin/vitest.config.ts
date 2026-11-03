import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

export const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));

/** Shared with the DOM project so imports and mocks resolve to the same module. */
export const APP_ALIAS = [{ find: /^@\/(.*)$/, replacement: `${APP_ROOT}$1` }];

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
