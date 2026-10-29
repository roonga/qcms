// Lint must run with the working directory pinned here (`scripts/eslint-workspace.mjs`):
// sonarjs rules read `context.cwd` and give the same file a different verdict without it.
import { builtinModules } from "node:module";

import eslint from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

import { noUnhandledThen } from "./scripts/eslint-rules/no-unhandled-then.mjs";

/**
 * `node:*` leads as the forward guard: `builtinModules` describes the Node running ESLint,
 * so a built-in newer than it is absent from the derived half, and the prefixed spelling is
 * the only one a new built-in gets.
 */
const nodeBuiltinPatterns = [
  "node:*",
  ...new Set(
    builtinModules.flatMap((name) => (name.startsWith("node:") ? [name] : [name, `node:${name}`])),
  ),
];

/** ADR-22: the a2-react-aria stack is the only component library, on every rendering surface. */
const competingComponentLibraries = [
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
];

const toolingFiles = [
  "scripts/**/*.{ts,mts,cts,js,mjs,cjs}",
  ".devcontainer/**/*.{ts,mts,cts,js,mjs,cjs}",
  "plan/**/*.{ts,mts,cts,js,mjs,cjs}",
  "eslint.config.js",
  "vitest.config.ts",
  "playwright.config.ts",
  "playwright.compose.config.ts",
  "packages/db/drizzle.config.ts",
  "packages/ui/vitest.config.ts",
  "packages/ui/vitest.setup.ts",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.next-dev/**",
      "**/next-env.d.ts",
      "apps/portal/.playwright/**",
      "apps/admin/.playwright/**",
      // Vendored byte-for-byte for a clean `a2ra diff` (ADR-22); `check:a2ra-fidelity` guards it.
      "packages/ui/src/components/a2ui/**",
      // Copies of files ESLint lints at the source, and outside every tsconfig, so
      // `projectService` resolves nothing. Not a `check-lint-coverage` gap:
      // `check:templates` byte-compares every copy against a linted original.
      "packages/create-qcms-app/templates/**",
      "**/__snapshots__/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  sonarjs.configs.recommended,
  {
    rules: {
      // Off: the rule pushes locale-dependent `String.localeCompare`, and the engine's
      // id ordering must stay deterministic.
      "sonarjs/no-alphabetical-sort": "off",
    },
  },
  {
    // No `files` key, so it reaches every linted file; it needs no type information, so
    // the `disableTypeChecked` blocks below do not switch it off.
    plugins: { qcms: { rules: { "no-unhandled-then": noUnhandledThen } } },
    rules: { "qcms/no-unhandled-then": "error" },
  },
  {
    // Fixture IPs and the SSRF guard's clear-text URLs are the point of those tests: the
    // guard can only be proved by feeding it a URL it must reject.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts", "**/e2e/**/*.ts"],
    rules: {
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/prefer-specific-assertions": "off",
      "sonarjs/no-trivial-assertions": "off",
    },
  },
  {
    // The kernel's determinism-critical algorithms carry essential complexity; the golden
    // corpus and property tests guard them, and splitting them would only relocate it.
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
    // Outside every shipped tsconfig, so type-aware rules have no program to resolve against.
    files: toolingFiles,
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // Command-line tools and generators: trusted tools on PATH, synthetic secrets and
      // procedural validation are expected here, not smells.
      "sonarjs/assertions-in-tests": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-empty-collection": "off",
      "sonarjs/no-hardcoded-passwords": "off",
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/no-nested-template-literals": "off",
      "sonarjs/no-os-command-from-path": "off",
      "sonarjs/parameterized-tests": "off",
      "sonarjs/publicly-writable-directories": "off",
      "sonarjs/regex-complexity": "off",
      "sonarjs/single-character-alternation": "off",
      "sonarjs/super-linear-regex": "off",
      "sonarjs/void-use": "off",
    },
  },
  {
    // `eslint.configs.recommended` turns on `no-undef`, and typescript-eslint only disables
    // it for TS files, so plain ESM run by Node needs its globals declared. Listed inline
    // rather than adding the `globals` dependency.
    files: ["**/e2e/**/*.{js,mjs,cjs}", "**/scripts/**/*.{js,mjs,cjs}", ...toolingFiles],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        FormData: "readonly",
        crypto: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    ignores: ["packages/core/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: nodeBuiltinPatterns,
              message:
                "@roonga/qcms-core is fetch-pure (R4): use Web APIs (crypto.subtle, TextEncoder), never Node built-ins.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/a2ui-compiler/src/**/*.ts"],
    ignores: ["packages/a2ui-compiler/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: nodeBuiltinPatterns,
              message:
                "@roonga/qcms-a2ui-compiler runtime is I/O-free: no Node built-ins in shipped source.",
            },
            {
              group: ["react", "react-*", "react/*"],
              message:
                "@roonga/qcms-a2ui-compiler runtime is React-free (it emits plain-data A2UI nodes): no React imports in shipped source.",
            },
            {
              group: ["@a2ra/*"],
              message:
                "@a2ra/core is a test-only devDependency (schema validation): never import it from shipped compiler source - the runtime stays React-free (ADR-22).",
            },
            {
              group: ["@roonga/qcms-db", "@roonga/qcms-db/*"],
              message:
                "The compiler depends on @roonga/qcms-core types only - never @roonga/qcms-db (ARCHITECTURE §3).",
            },
          ],
        },
      ],
    },
  },
  {
    // The fence matches built-ins only, so the process boundary's Node adapters
    // (`@hono/node-server`, `pg`, `drizzle-orm/node-postgres`) are packages and pass.
    files: ["apps/api/src/**/*.ts"],
    ignores: [
      "apps/api/src/**/*.test.ts",
      "apps/api/src/**/*.integration.test.ts",
      "apps/api/src/test-support.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: nodeBuiltinPatterns,
              message:
                "API slices are Fetch-pure (R4, ADR-13): use Web APIs (crypto.subtle, TextEncoder, fetch), never Node built-ins. The process boundary composes Node adapters as dependencies instead.",
            },
          ],
        },
      ],
    },
  },
  {
    // A deny-list fast fence; the exhaustive permitted surface is pinned by
    // `packages/ui/src/import-surface.test.ts`.
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    ignores: ["packages/ui/src/**/*.test.{ts,tsx}", "packages/ui/src/test-support/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: competingComponentLibraries,
              message:
                "@roonga/qcms-ui builds only on the a2-react-aria stack (ADR-22): use the vendored components (src/components/a2ui) or react-aria-components - never a second component library.",
            },
          ],
        },
      ],
    },
  },
  {
    // Every app file, not a `src/**` subtree, because Next.js source lives in `app/`,
    // `components/` and `lib/`; tests included, since a spec on the wrong stack is wrong.
    files: ["apps/portal/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: competingComponentLibraries,
              message:
                "Both frontends build only on the a2-react-aria stack (ADR-22): render through @roonga/qcms-ui/kit or react-aria-components - never a second component library.",
            },
          ],
        },
      ],
    },
  },
);
