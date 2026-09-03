import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every rejection handler in `components/forms/` and `components/ops/` is named here, and
 * named beside the rendered test that drives it (issue #352).
 *
 * ## What this is for
 *
 * Issue #352 exists because nine `.catch` handlers shipped with no automated coverage at
 * all, across two separate pieces of work, for the same reason both times: there was no
 * layer that could render the component. The jsdom project added with this file is that
 * layer, and the `*-rejects.test.tsx` files beside each component are the coverage.
 *
 * A list of tests does not stay complete on its own, though. The tenth handler would be
 * added exactly the way the first nine were - beside a `.then` that already worked, by
 * someone with no reason to look for a test file that does not mention it yet. So the
 * enumeration is asserted rather than written down: the scan below finds every `.catch`
 * site in those two trees, and this file fails if the set is not the one declared here.
 *
 * Adding a handler therefore costs one line here and one rendered test, and forgetting the
 * test is a failing suite rather than a silent gap. Removing a handler costs the same line,
 * which is the point: a handler that disappears should have to be noticed.
 *
 * This runs in the node project, not the jsdom one, because it reads source rather than
 * rendering it. That split is the same one `vitest.config.ts` describes.
 *
 * ## What it deliberately does not do
 *
 * It cannot see a `void promise.then(...)` written with NO `.catch` at all, which is the
 * shape all nine original defects had. `@typescript-eslint/no-floating-promises` cannot
 * either, because `void` is that rule's sanctioned way of saying "deliberately not
 * awaited". Closing that at write time needs a lint rule, which issue #352's second
 * comment proposes and the ruling of 2026-09-04 did not cover; this file is scoped to
 * keeping the handlers that do exist covered.
 */

const COMPONENTS_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Every rejection handler, by source file, with the rendered test that drives it.
 *
 * Nine of these are the ones issue #352 counted: the action-rejection handlers that fire
 * when a server action rejects instead of returning a failure state. The other three are
 * clipboard chains, which are the same failure wearing different clothes - a refusal the
 * operator can act on, or silence - and are covered in the same pass.
 */
const HANDLERS: Readonly<Record<string, readonly string[]>> = {
  // The four from task 035 and the five from issue #303, in file order.
  "forms/draft-preview.tsx": ["preview projection (forms/draft-preview-rejects.test.tsx)"],
  "forms/form-actions.tsx": [
    "publish (forms/form-actions-rejects.test.tsx)",
    "close/reopen (forms/form-actions-rejects.test.tsx)",
  ],
  "forms/public-form-link.tsx": [
    "copy the public address (forms/public-form-link-rejects.test.tsx)",
  ],
  "forms/secure-links.tsx": [
    "mint (forms/secure-links-rejects.test.tsx)",
    "revoke (forms/secure-links-rejects.test.tsx)",
    "copy a minted URL (forms/secure-links-rejects.test.tsx)",
  ],
  "ops/dead-letters.tsx": ["redeliver, single and bulk (ops/dead-letters-rejects.test.tsx)"],
  "ops/response-detail.tsx": [
    "release a withheld event (ops/response-detail-rejects.test.tsx)",
    "erase (ops/response-detail-rejects.test.tsx)",
  ],
  "ops/webhook-config.tsx": [
    "create, rotate, deactivate, reactivate, retarget (ops/webhook-config-rejects.test.tsx)",
    "copy a revealed secret (ops/webhook-config-rejects.test.tsx)",
  ],
};

/** Every `.tsx` file directly under one of the two trees, sorted. */
function componentFiles(tree: string): readonly string[] {
  return readdirSync(join(COMPONENTS_ROOT, tree))
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => `${tree}/${name}`)
    .sort();
}

/** How many `.catch(` sites a source file holds. */
function catchSites(relative: string): number {
  const source = readFileSync(join(COMPONENTS_ROOT, relative), "utf8");
  return source.split(".catch(").length - 1;
}

describe("the rejection handlers of the admin's forms and ops components", () => {
  it("are exactly the ones a rendered test drives", () => {
    const found: Record<string, number> = {};
    for (const tree of ["forms", "ops"]) {
      for (const file of componentFiles(tree)) {
        const count = catchSites(file);
        if (count > 0) found[file] = count;
      }
    }

    const declared = Object.fromEntries(
      Object.entries(HANDLERS).map(([file, entries]) => [file, entries.length]),
    );

    // One assertion over the whole map rather than a loop, so a handler that appears in a
    // file this list has never heard of fails here too, and the failure names the file.
    expect(found).toStrictEqual(declared);
  });

  it("number twelve, of which nine are the action rejections issue #352 counted", () => {
    const total = Object.values(HANDLERS).reduce((sum, entries) => sum + entries.length, 0);
    expect(total).toBe(12);

    const clipboard = Object.values(HANDLERS)
      .flat()
      .filter((entry) => entry.startsWith("copy"));
    expect(clipboard).toHaveLength(3);
    expect(total - clipboard.length).toBe(9);
  });
});
