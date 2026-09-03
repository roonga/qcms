import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

// This app's own directory, resolved from this file rather than the process cwd:
// `pnpm test` runs Vitest with `--root ../..`, so a relative path would resolve
// against the repo root and the alias would silently point at nothing.
const APP_ROOT = fileURLToPath(new URL(".", import.meta.url));

// The admin's Vitest project (issues #252, #566, #652). It exists for one reason:
// to give the test environment the same `@/` alias `tsconfig.json` declares
// (`"@/*": ["./*"]`), so a module reached through `@/…` resolves under Vitest
// exactly as it does under Next.
//
// Without it the alias was simply unresolvable, and every suite paid for that in
// a way that did not look like a resolution problem: each `@/…` specifier a
// module transitively imported needed its own `vi.mock` registration, including
// registrations that redirected a specifier straight back to the real module and
// changed no behaviour. Those read as stubbing decisions, so a leaner test failed
// on a module its author never meant to touch, and the same module reached
// through two specifiers needed two registrations. Both classes are gone with the
// alias in place; the `vi.mock` calls that remain are all genuine stubs.
//
// Only `resolve` is set here. Everything else is deliberately left at the value
// the root config's `apps/*` glob already produced for this project, so adding
// the file changes resolution and nothing else.
export default defineProject({
  test: {
    name: "qcms-admin",
    root: APP_ROOT,
  },
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${APP_ROOT}$1` }],
  },
});
