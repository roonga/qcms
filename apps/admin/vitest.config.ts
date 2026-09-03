import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

// This app's own directory, resolved from this file rather than the process cwd:
// `pnpm test` runs Vitest with `--root ../..`, so a relative path would resolve
// against the repo root and the alias would silently point at nothing.
export const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * The `@/` alias, shared with the sibling jsdom project in `vitest.dom.config.ts`.
 *
 * Exported rather than repeated so the two admin projects cannot drift into resolving
 * the same specifier differently, which would be the least visible way for this file's
 * whole reason to exist to stop being true for half the suite.
 */
export const APP_ALIAS = [{ find: /^@\/(.*)$/, replacement: `${APP_ROOT}$1` }];

// The admin's node-environment Vitest project (issues #252, #566, #652). It exists for
// one reason: to give the test environment the same `@/` alias `tsconfig.json` declares
// (`"@/*": ["./*"]`), so a module reached through `@/…` resolves under Vitest exactly as
// it does under Next.
//
// Without it the alias was simply unresolvable, and every suite paid for that in a way
// that did not look like a resolution problem: each `@/…` specifier a module transitively
// imported needed its own `vi.mock` registration, including registrations that redirected
// a specifier straight back to the real module and changed no behaviour. Those read as
// stubbing decisions, so a leaner test failed on a module its author never meant to
// touch, and the same module reached through two specifiers needed two registrations.
// Both classes are gone with the alias in place; the `vi.mock` calls that remain are all
// genuine stubs.
//
// WHY `include` IS NARROWED TO `.test.ts` (issue #352). The admin now has a second
// project, `qcms-admin-dom`, which runs `.test.tsx` under jsdom with testing-library so a
// component can actually be rendered and driven. The two projects partition the suite by
// file extension and nothing else: a test file that renders JSX is `.tsx` and belongs in
// the browser-shaped environment, a test file that drives a server module or a pure
// function is `.ts` and belongs here. Vitest 4 removed `environmentMatchGlobs`, so the
// split has to be two projects rather than one project with a glob, and the extension is
// the discriminator that needs no list to maintain.
//
// The partition must stay exhaustive. Every admin test file matches exactly one of the
// two `include` patterns, so narrowing this one without the sibling would silently stop
// running files rather than fail.
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
