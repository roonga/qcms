import { defineProject } from "vitest/config";

import { APP_ALIAS, APP_ROOT } from "./vitest.config.ts";

/**
 * The admin's component-test project: testing-library in jsdom (issue #352).
 *
 * ## What was missing, and what it cost
 *
 * The admin had one Vitest project and it was node-environment, so nothing under
 * `components/` could be rendered at all. Test files that end in `.tsx` existed, but they
 * could only reach `renderToStaticMarkup` output - a string, with no events, no state and
 * no effects. The layer that answers "what does the operator see when this button's call
 * fails" simply did not exist, and Playwright cannot stand in for it: the rejections these
 * components guard against originate server-side inside `adminApiFetch`, so forcing one
 * from a browser means making the API unreachable from the Next server mid-run.
 *
 * The result was nine `.catch` rejection handlers across `components/forms/` and
 * `components/ops/` that were verified once by hand at authoring time and never again,
 * guarding the failure an operator notices least: a dialog that simply sits there. Issue
 * #352 records the throwaway probe that proved them and could not be committed. This
 * project is that probe made permanent, and the `*-rejects.test.tsx` files under
 * `components/` are what it runs.
 *
 * ## Why a second project rather than one project with a glob
 *
 * Vitest 4 removed `environmentMatchGlobs`, so a single project cannot carry two
 * environments. The two projects partition the admin suite by file extension: `.tsx` here
 * under jsdom, `.ts` in `qcms-admin` under node. Registered by name in the root config's
 * `projects` list rather than by the `apps/*` glob, which resolves one default-named
 * config per directory and would never see this file.
 *
 * `root`, and the `@/` alias every admin module is reached through, come from
 * `vitest.config.ts` so the two projects cannot resolve the same specifier differently.
 * Everything else here mirrors `packages/ui/vitest.config.ts`, which is the workspace's
 * existing answer to the same question.
 */
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
