// Root ESLint flat config — the single lint configuration for the whole workspace.
// Per-package `lint` scripts run `eslint src`; ESLint resolves this file by walking up.
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/coverage/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // @qcms/core is fetch-pure (R4) and I/O-free (R3): no Node built-ins,
    // ever — WebCrypto (`crypto.subtle`) instead of `node:crypto` (task 010).
    // Tests may use Node ambient types for fixtures, but never Node imports
    // in shipped source; keep both honest.
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:*",
                "crypto",
                "fs",
                "path",
                "os",
                "util",
                "stream",
                "buffer",
                "child_process",
                "worker_threads",
                "events",
                "url",
              ],
              message:
                "@qcms/core is fetch-pure (R4): use Web APIs (crypto.subtle, TextEncoder), never Node built-ins.",
            },
          ],
        },
      ],
    },
  },
);
