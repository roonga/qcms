import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Plain JavaScript with a hand-written declaration file beside it, imported by relative
// path the way `lib/rail-routes.test.ts` in this app imports the same helper.
import { trackedFilesUnder } from "../../../scripts/tracked-files.mjs";

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
 * when a server action rejects instead of returning a failure state. Three are clipboard
 * chains, which are the same failure wearing different clothes - a refusal the operator
 * can act on, or silence - and are covered in the same pass. The thirteenth, task 041's,
 * is a body-parse guard: the response arrived, it just was not JSON.
 */
const HANDLERS: Readonly<Record<string, readonly string[]>> = {
  // Task 041's, and a different shape from the twelve below: not an action that rejected,
  // but a failing response whose body is not JSON. The panel reads the failure body with
  // `.json().catch(() => undefined)` so a proxy's HTML error page still reaches the
  // operator as a status number instead of escaping the send path as an unhandled parse
  // rejection. Covered in the panel's own rendered test rather than a `-rejects` sibling,
  // because that file already renders this component and drives its other error states.
  "forms/assist-panel.tsx": ["non-JSON error body (forms/assist-panel.test.tsx)"],
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

/**
 * Every component source file in the two trees, as paths relative to `components/`.
 *
 * Asked of git rather than walked (CONTRIBUTING's derivation rule, issues #635 and #641).
 * Two things follow, and both matter to what this file claims:
 *
 * - **It is recursive by construction.** `git ls-files` lists the whole subtree, so a
 *   handler added in a future subdirectory of `forms/` or `ops/` is in scope on the day it
 *   lands. A `readdirSync` of each tree, which is what this was, reads one level only, so
 *   exactly the case this file exists to prevent would have escaped it silently.
 * - **It enumerates the repository, not the working directory.** A walk also reads
 *   untracked scratch files as source, which is how one gate came to be a stable red in any
 *   checkout that had run the browser suite and a stable green on CI.
 *
 * The regex carries no `g` or `y` flag: `trackedFilesUnder` refuses those, because
 * `RegExp.prototype.test` is stateful with them and would silently drop half the corpus.
 */
function componentFiles(): readonly string[] {
  return trackedFilesUnder(COMPONENTS_ROOT, { match: /^(?:forms|ops)\/.+\.tsx$/ }).filter(
    (path) => !path.endsWith(".test.tsx"),
  );
}

/**
 * How many `.catch(` sites a source file holds.
 *
 * A TEXTUAL count, so a comment containing the literal `.catch(` is counted as a handler
 * and fails this file. That is the known failure mode and it is left as-is rather than
 * parsed around: the components here discuss their own handlers at length, and every one
 * of those comments writes `.catch` without the parenthesis, which is enough to stay clear
 * of the count. If this test fails with a number one higher than you expect and the file
 * has gained no handler, look in its prose for the literal string.
 */
function catchSites(relative: string): number {
  const source = readFileSync(join(COMPONENTS_ROOT, relative), "utf8");
  return source.split(".catch(").length - 1;
}

describe("the rejection handlers of the admin's forms and ops components", () => {
  it("are exactly the ones a rendered test drives", () => {
    const found: Record<string, number> = {};
    for (const file of componentFiles()) {
      const count = catchSites(file);
      if (count > 0) found[file] = count;
    }

    const declared = Object.fromEntries(
      Object.entries(HANDLERS).map(([file, entries]) => [file, entries.length]),
    );

    // One assertion over the whole map rather than a loop, so a handler that appears in a
    // file this list has never heard of fails here too, and the failure names the file.
    expect(found).toStrictEqual(declared);
  });

  it("number thirteen, of which nine are the action rejections issue #352 counted", () => {
    const entries = Object.values(HANDLERS).flat();
    expect(entries).toHaveLength(13);

    // Three clipboard chains: a refusal the operator can act on, or silence.
    const clipboard = entries.filter((entry) => entry.startsWith("copy"));
    expect(clipboard).toHaveLength(3);

    // One body-parse guard, added with task 041's assist panel. Not an action rejection:
    // the request reached the server and the server answered, just not in JSON.
    const parse = entries.filter((entry) => entry.startsWith("non-JSON"));
    expect(parse).toHaveLength(1);

    // What is left is issue #352's original nine, and that number is the tripwire: it
    // moves only when an action-rejection handler is genuinely added or removed, not when
    // a handler of some other shape joins the list.
    expect(entries.length - clipboard.length - parse.length).toBe(9);
  });
});
