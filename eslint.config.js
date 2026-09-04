// Root ESLint flat config - the single lint configuration for the whole workspace.
// Per-package `lint` scripts run `eslint src`; ESLint resolves this file by walking up.
import { builtinModules } from "node:module";

import eslint from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

/**
 * Node built-ins, in both spellings a bundler-free TypeScript import can take. Shared
 * by the three fetch-purity fences below (`@qcms/core`, `@qcms/a2ui-compiler`, and the
 * API's shipped source) so the ban is one list rather than three that drift.
 *
 * **Derived, not written down** (issue #774). The list used to be twelve names typed by
 * hand, which covered the prefixed spelling completely - `node:*` matches every
 * `node:`-prefixed specifier including subpaths - and the BARE legacy spelling only
 * where somebody had remembered to add the name. `import { createServer } from "http"`
 * passed all three fences, measured rather than assumed, and so did `net`, `tls`, `dns`,
 * `zlib`, `querystring`, `assert`, `process` and the subpaths of each of those
 * (`timers/promises`, `dns/promises`). A bare name that WAS listed covered its own
 * subpaths - the patterns are gitignore-shaped, so `fs` reaches `fs/promises` - which is
 * why the gap was invisible: the spot checks people ran happened to land on names that
 * were in the list. Deriving it from `node:module`'s `builtinModules` removes the
 * remembering: the set is whatever the Node running the lint says the built-ins are, in
 * both spellings, and it cannot fall behind a name the runtime already ships.
 *
 * `node:*` stays at the head as the forward guard. `builtinModules` describes the Node
 * that runs ESLint, so a built-in introduced by a NEWER Node than the contributor's is
 * absent from the derived half; the wildcard still catches its prefixed spelling, which
 * is the only spelling a new built-in gets (prefix-only modules such as `node:test` are
 * already reported with their prefix, and are passed through unchanged below).
 */
const nodeBuiltinPatterns = [
  "node:*",
  ...new Set(
    builtinModules.flatMap((name) => (name.startsWith("node:") ? [name] : [name, `node:${name}`])),
  ),
];

/**
 * Component libraries that would compete with the a2-react-aria stack (ADR-22). One
 * list, applied to every surface that renders: the renderer package AND both apps.
 * Scoping it to `packages/ui` alone left the apps holding the decision by convention,
 * which is what ADR-22 says it is not (issue #728).
 */
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
      // Next.js output and generated ambient types for both apps (portal 029, admin
      // 031): the production build in `.next`, the dev server's in `.next-dev`
      // (issue #54). Playwright artifacts are output too.
      "**/.next/**",
      "**/.next-dev/**",
      "**/next-env.d.ts",
      "apps/portal/.playwright/**",
      "apps/admin/.playwright/**",
      // Vendored a2-react-aria component sources (task 028) are upstream-owned -
      // kept byte-for-byte for a clean `a2ra diff` (ADR-22) and tested upstream.
      // qcms lint rules apply to the qcms renderer code, not the vendored copy.
      "packages/ui/src/components/a2ui/**",
      // Generated scaffolding templates (task 037): byte-for-byte copies of files
      // under apps/, which ESLint already lints AT THE SOURCE. The same structural
      // reason as the vendored components above, and the entry is deliberately here
      // rather than in check-lint-coverage's KNOWN_UNLINTED, because that inventory
      // records a real gap and this is not one.
      //
      // Linting the copies would be strictly worse than not linting them. They sit
      // outside every tsconfig, so `projectService` resolves nothing: a single
      // template file reports 18 `no-unsafe-*` errors about types that resolve
      // perfectly at the source. The only way to make them pass would be to lint the
      // copy under a WEAKER ruleset than the original, which is a green that means
      // less than the green it duplicates.
      //
      // What actually covers them is stronger than lint: `pnpm check:templates`
      // regenerates the tree and byte-compares, so every file here is provably
      // identical to a file that was linted. Drift is a red, not a silence.
      "packages/create-qcms-app/templates/**",
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
    // Root tools and package-level tool configuration do not belong to a shipped
    // TypeScript project. They are still linted, using syntax-aware rules rather
    // than being exempted from ESLint entirely.
    files: toolingFiles,
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // These are command-line tools, fixtures, and static generators. Looking up
      // trusted developer tools on PATH, using synthetic secrets in tests, and
      // keeping procedural validation code together are expected in this class.
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
    // Node harness and tooling scripts (e2e server wrappers Playwright's
    // `webServer` spawns, build-time generators under a `scripts/` dir) are a
    // distinct file class from app source: plain ESM run by Node, not by a
    // browser or a bundler. `eslint.configs.recommended` turns on `no-undef`, and
    // typescript-eslint's eslint-recommended only disables it for TS files, so
    // these need the Node globals they legitimately use declared. Listed inline
    // rather than pulled from the `globals` package, which is not a workspace
    // dependency (adding one needs the CONTRIBUTING approval policy).
    files: ["**/e2e/**/*.{js,mjs,cjs}", "**/scripts/**/*.{js,mjs,cjs}", ...toolingFiles],
    languageOptions: {
      globals: {
        Buffer: "readonly",
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
              group: nodeBuiltinPatterns,
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
              group: nodeBuiltinPatterns,
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
    // API slices are fetch-pure (R4, ADR-13): a handler takes a Request and returns a
    // Response, using Web APIs, so the same code runs on any Fetch-compatible runtime
    // and a slice stays testable with `app.request()` and no process. The kernel and
    // the compiler have had a lint fence saying so since they were written; the API
    // held the rule by convention and review only (issue #726).
    //
    // The fence carries NO per-file exemption, and that is a measurement rather than a
    // policy choice: no file under `apps/api/src` imports a Node built-in today. The
    // process boundary reaches Node through *packages* instead - `@hono/node-server`,
    // `pg`, `drizzle-orm/node-postgres` in `main.ts` - which are not built-ins and are
    // not matched here. Adding an exemption for a file that does not need one would
    // assert coverage the fence does not have, which is the failure mode
    // `scripts/check-ports.mjs` documents for its own ALLOWED list. If a boundary file
    // (`serve.ts`, `main.ts`, `create-admin.ts`) later needs a genuine built-in, add it
    // to `ignores` here with the reason, in the diff where a reviewer sees it.
    //
    // Tests are exempt: they load fixtures from disk, sign fixture payloads with
    // `node:crypto` to check the WebCrypto implementation against it, and stand up a
    // `node:http` receiver for the webhook scheduler.
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
              group: competingComponentLibraries,
              message:
                "@qcms/ui builds only on the a2-react-aria stack (ADR-22): use the vendored components (src/components/a2ui) or react-aria-components - never a second component library.",
            },
          ],
        },
      ],
    },
  },
  {
    // The same ADR-22 fence over both frontends (issue #728). ADR-22 binds the portal
    // and the admin, not just the renderer package, and the apps hold it today only by
    // consuming `@qcms/ui/kit`: nothing stopped a screen adding a widget library as a
    // direct dependency and importing it. This is the fast fence; the exhaustive
    // allow-list assertion stays in @qcms/ui's import-surface test, which is where the
    // renderer's full permitted surface is pinned.
    //
    // Scoped to every app file rather than a `src/**` subtree because Next.js source
    // lives in `app/`, `components/` and `lib/`, and to tests too: a spec that imports
    // a second library is a spec asserting the wrong stack.
    files: ["apps/portal/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: competingComponentLibraries,
              message:
                "Both frontends build only on the a2-react-aria stack (ADR-22): render through @qcms/ui/kit or react-aria-components - never a second component library.",
            },
          ],
        },
      ],
    },
  },
);
