import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

/**
 * The admin's own Vitest project.
 *
 * Before task 041, every admin test was a `.test.ts` over server-only logic
 * (`lib/server/*`, `lib/forms/*`), and several of those (`shell-route-guards.test.ts`,
 * `r2-import-surface.test.ts`, `no-self-registration.test.ts`,
 * `renderer-surface.test.ts`) resolve `fileURLToPath(new URL("../../", import.meta.url))`
 * to walk the app tree - they need `import.meta.url` to stay a real `file:` URL. That
 * is the whole reason this project does **not** set a project-wide `environment:
 * "jsdom"` the way `@qcms/ui`'s own project does: Vitest's jsdom environment rewrites
 * `import.meta.url` for the modules it runs, which broke exactly those four files the
 * first time this was tried (issue found in task 041's own gate run). The default
 * environment therefore stays Node - unchanged from every test this app had before -
 * and only `components/forms/assist-panel.test.tsx` and
 * `components/forms/form-builder.test.tsx` (task 041's first admin tests to render a
 * React component) opt into jsdom individually, with Vitest's own per-file
 * `// @vitest-environment jsdom` docblock. `vitest.setup.ts` runs for every file in
 * this project either way, so it no-ops under Node rather than assuming `window` exists.
 *
 * `resolve.alias` is new for a different reason: every existing admin test reaches
 * its subject with a relative import, so nothing before task 041 needed Vitest to
 * know about the `@/*` alias `tsconfig.json` declares for Next's own bundler. A
 * component test imports the way the app's own components do (`@/lib/i18n/en`), so
 * the alias has to resolve here too, or every such import 404s under Vitest alone.
 * Alias resolution is inert for every other test, which keeps to relative imports.
 */
const ADMIN_ROOT = fileURLToPath(new URL(".", import.meta.url));

export default defineProject({
  resolve: {
    alias: {
      "@": ADMIN_ROOT,
    },
  },
  test: {
    name: "qcms-admin",
    root: ADMIN_ROOT,
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
