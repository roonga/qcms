// Root ESLint flat config - the single lint configuration for the whole workspace.
// Per-package `lint` scripts run `eslint src`; ESLint resolves this file by walking up.
import eslint from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      // Vendored a2-react-aria component sources (task 028) are upstream-owned -
      // kept byte-for-byte for a clean `a2ra diff` (ADR-22) and tested upstream.
      // qcms lint rules apply to the qcms renderer code, not the vendored copy.
      "packages/ui/src/components/**",
      "**/__snapshots__/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // SonarSource's JS/TS analyzer rules (bugs, code smells, cognitive
  // complexity) as a per-commit gate: "SonarQube without a server" (issue #14).
  sonarjs.configs.recommended,
  {
    // Project-level sonarjs tuning (rationale required for every entry; these
    // are conventions, not silencing). Applies workspace-wide.
    rules: {
      // OFF by design. Determinism is a non-negotiable: the engine sorts ASCII
      // ids/keys where Array.prototype.sort's default UTF-16 code-unit order is
      // stable and locale-independent. This rule pushes String.localeCompare,
      // which is locale-DEPENDENT - the opposite of the guarantee we want.
      "sonarjs/no-alphabetical-sort": "off",
    },
  },
  {
    // Test files legitimately trip several sonarjs rules by design: fixture IPs
    // (1.2.3.4, 1.1.1.1) exercise rate-limit/audit paths; the SSRF guard tests
    // MUST feed http/ftp URLs to prove they are rejected; and generic length
    // assertions read fine in a test. None of these are code smells in tests.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts", "**/e2e/**/*.ts"],
    rules: {
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/prefer-specific-assertions": "off",
      "sonarjs/no-trivial-assertions": "off",
    },
  },
  {
    // The pure kernel concentrates essential-complexity algorithms by design
    // (regex-safety scanner, rule evaluator, answer validator). Correctness is
    // guaranteed by the golden corpus and property tests, not a line-count
    // heuristic; fragmenting them would relocate complexity and add bug surface
    // in determinism-critical code. Rule stays an error for app code (api/ui/db).
    files: ["packages/core/src/**/*.ts"],
    rules: { "sonarjs/cognitive-complexity": "off" },
  },
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
    // ever - WebCrypto (`crypto.subtle`) instead of `node:crypto` (task 010).
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
  {
    // @qcms/a2ui-compiler shipped source is a pure projection (task 011): its
    // runtime stays React-free and never imports the renderer/spec package
    // (`@a2ra/*` is a *test-only* devDependency, used to validate compiled
    // output against the Zod schemas), never the db, and no Node built-ins.
    // Tests may use Node ambient imports (fixture loading) and @a2ra/core; the
    // shipped source may not - keep both honest.
    files: ["packages/a2ui-compiler/src/**/*.ts"],
    ignores: ["packages/a2ui-compiler/src/**/*.test.ts"],
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
                "@qcms/a2ui-compiler runtime is I/O-free: no Node built-ins in shipped source.",
            },
            {
              group: ["react", "react-*", "react/*"],
              message:
                "@qcms/a2ui-compiler runtime is React-free (it emits plain-data A2UI nodes): no React imports in shipped source.",
            },
            {
              group: ["@a2ra/*"],
              message:
                "@a2ra/core is a test-only devDependency (schema validation): never import it from shipped compiler source - the runtime stays React-free (ADR-22).",
            },
            {
              group: ["@qcms/db", "@qcms/db/*"],
              message:
                "The compiler depends on @qcms/core types only - never @qcms/db (ARCHITECTURE §3).",
            },
          ],
        },
      ],
    },
  },
  {
    // @qcms/ui import-surface rule (ADR-22): the renderer imports ONLY the a2ra
    // stack - @a2ra/core, react-aria-components (+ its @internationalized/date
    // and zod), React, and its own vendored sources. No other component library,
    // ever. Vendored sources (ignored above) and test files are exempt; the
    // exhaustive allow-list is asserted by the import-surface test. This lint
    // block is the fast fence against a future "just add a widget library".
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    ignores: ["packages/ui/src/**/*.test.{ts,tsx}", "packages/ui/src/test-support/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@mui/*",
                "@material-ui/*",
                "antd",
                "antd/*",
                "@chakra-ui/*",
                "@mantine/*",
                "@radix-ui/*",
                "react-bootstrap",
                "bootstrap",
                "@headlessui/*",
                "@fluentui/*",
                "flowbite",
                "flowbite-react",
                "@nextui-org/*",
                "@ariakit/*",
                "@base-ui-components/*",
                "@shadcn/*",
              ],
              message:
                "@qcms/ui builds only on the a2-react-aria stack (ADR-22): use the vendored components (src/components/a2ui) or react-aria-components - never a second component library.",
            },
          ],
        },
      ],
    },
  },
);
