import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Plain JavaScript with a hand-written declaration file beside it, imported by relative
// path the way `lib/rail-routes.test.ts` imports the same helper.
import { trackedFilesUnder } from "../../../scripts/tracked-files.mjs";

import { MEASURE_BY_ROUTE } from "./measure.js";

/**
 * A new admin screen is registered in five places, and this is the one red that names all
 * five (issue #700).
 *
 * ## What was wrong, and it was not that the guards were missing
 *
 * Every one of the five already had a completeness check of its own, so a route added
 * without them went red five times: once per place, each red a separate cycle, each one
 * saying only that its own list disagreed with the tree. Issue #700 measured that on the
 * #685 lane and #669 paid it again. `MEASURE_BY_ROUTE` is the one that explains itself,
 * and its being good is what makes the rest worse: a lane that reads its comment, writes
 * its row and concludes it has met the requirement is a lane that has met one fifth of it.
 *
 * The fifth place had no red at all. `e2e/measure.pw.ts` keeps a hand-written list of the
 * screens it opens and nothing compared it to the route tree, so a missing entry did not
 * fail: the spec passed while covering one screen less than it claims to. That is the same
 * shape as issue #639, a guard structurally unable to see the defect, and it is the reason
 * this file asserts the browser walk's list as well rather than only the Vitest tables.
 *
 * ## What this adds, and what it deliberately does not
 *
 * This is NOT a sixth registration table. It holds no per-route data of its own, which is
 * the property that keeps it from becoming a sixth row to write: it reads the route tree,
 * reads the five places, and reports which of them has not heard of which route. Nothing
 * here has an opinion about a screen's cap, its save model or its rail, and each of the
 * five keeps its own test and its own reasons.
 *
 * The failure is collected rather than thrown at the first gap, so one run names every
 * missing pair at once. `apps/admin/app/(shell)/AGENTS.md` states the same five in prose,
 * for a lane that reads before it runs.
 *
 * ## The enumeration is git's, not the filesystem's
 *
 * `trackedFilesUnder` rather than a directory walk (issue #641, CONTRIBUTING): a dev
 * server leaves a compiled `page.tsx` under `.next-dev`, and a walk reads it as a screen.
 * `--others --exclude-standard` means a route added and not yet staged is still in scope,
 * so this fails while the work is in progress rather than after it is committed.
 */

/** `apps/admin/app/(shell)`, resolved from this file rather than from the process cwd. */
const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

/** `apps/admin`, for reading the sources of the places that keep their table in a test. */
const ADMIN = fileURLToPath(new URL("..", import.meta.url));

/** Every `page.tsx` the shell group holds, as paths relative to it, slot trees included. */
function pageFiles(): readonly string[] {
  return trackedFilesUnder(SHELL, { match: /(?:^|\/)page\.tsx$/u });
}

/**
 * The Next route pattern one `page.tsx` answers, with route groups dropped.
 *
 * Slot segments are kept rather than stripped, so the caller can tell a screen from a
 * slot page by asking whether the pattern it got back names one.
 */
function patternOf(file: string): string {
  return file
    .split("/")
    .slice(0, -1)
    .filter((segment) => !segment.startsWith("("))
    .map((segment) => `/${segment}`)
    .join("");
}

/** Every authenticated screen: the routes with a page of their own, slots excluded. */
function shellRoutes(): readonly string[] {
  return pageFiles()
    .map(patternOf)
    .filter((route) => !route.split("/").some((segment) => segment.startsWith("@")))
    .sort((left, right) => left.localeCompare(right));
}

/** Every route the `@rail` slot answers for, as the screen route it sits beside. */
function railSlotRoutes(): ReadonlySet<string> {
  const routes = pageFiles()
    .filter((file) => file.startsWith("@rail/"))
    .map((file) => patternOf(file).replace("/@rail", ""));
  return new Set(routes);
}

function source(relative: string): string {
  return readFileSync(`${ADMIN}${relative}`, "utf8");
}

/** A pathname or route pattern split into its segments, with empties dropped. */
function segmentsOf(value: string): string[] {
  return value.split("/").filter((segment) => segment !== "");
}

/**
 * The screen paths `e2e/measure.pw.ts` opens, read out of its `screens()` list.
 *
 * The list is source rather than data, so it is parsed rather than imported: the spec
 * pulls in Playwright and the seat-aware harness, neither of which a Vitest project can
 * load. What is matched is the `path:` of each row, which is the only field this file has
 * an opinion about.
 */
function browserWalkPaths(): readonly string[] {
  const spec = source("e2e/measure.pw.ts");
  return [...spec.matchAll(/path:\s*[`"]([^`"]+)[`"]/gu)].map((match) => match[1] ?? "");
}

/**
 * The route pattern a live path in the browser walk stands for, or `undefined`.
 *
 * Resolved the way `measureFor` resolves a pathname and the way Next resolves a URL: a
 * dynamic pattern segment matches anything, a literal matches only itself, and where two
 * patterns match the one with more literal segments wins. That last rule is what keeps
 * `/questions/new` from being read as a visit to `/questions/[questionId]`, which would
 * report the editor covered by a walk that never opens it.
 *
 * An interpolation (`/forms/${FORM_ID}`) is one segment like any other and matches a
 * dynamic pattern segment only, so a walk that hard-codes an id where a pattern wants a
 * literal does not silently satisfy that literal's row.
 */
function patternFor(path: string, patterns: readonly string[]): string | undefined {
  const parts = segmentsOf(path);
  let best: { literals: number; pattern: string } | undefined;
  for (const pattern of patterns) {
    const wanted = segmentsOf(pattern);
    if (wanted.length !== parts.length) continue;
    const matches = wanted.every(
      (segment, index) => segment.startsWith("[") || segment === parts[index],
    );
    if (!matches) continue;
    const literals = wanted.filter((segment) => !segment.startsWith("[")).length;
    if (best === undefined || literals > best.literals) best = { literals, pattern };
  }
  return best?.pattern;
}

/** Every route the browser walk actually opens, as route patterns. */
function walkedRoutes(routes: readonly string[]): ReadonlySet<string> {
  const walked = new Set<string>();
  for (const path of browserWalkPaths()) {
    const pattern = patternFor(path, routes);
    if (pattern !== undefined) walked.add(pattern);
  }
  return walked;
}

/**
 * One of the five places a screen has to be registered.
 *
 * `missing` returns the sentence a lane needs when the place has not heard of the route,
 * and `undefined` when it has. The sentence says what to write rather than only that
 * something is absent, because the cost issue #700 measured was five lookups rather than
 * five edits.
 */
interface Place {
  /** Where the entry goes, repo-relative. */
  readonly file: string;
  readonly missing: (route: string) => string | undefined;
}

function places(routes: readonly string[]): readonly Place[] {
  const saveModel = source("lib/save-model.test.ts");
  const pageTitle = source("lib/page-title.test.ts");
  const railRoutes = source("lib/rail-routes.test.ts");
  const slots = railSlotRoutes();
  const walked = walkedRoutes(routes);

  return [
    {
      file: "apps/admin/lib/measure.ts",
      missing: (route) =>
        route in MEASURE_BY_ROUTE
          ? undefined
          : "add a `MEASURE_BY_ROUTE` row naming the cap this screen's own POC draws, " +
            "with the POC file and the selector the number was read from",
    },
    {
      file: "apps/admin/lib/save-model.test.ts",
      missing: (route) => {
        const page = `"app/(shell)${route}/page.tsx"`;
        const slot = `"app/(shell)/@rail${route}/page.tsx"`;
        if (!saveModel.includes(page)) {
          return `add a \`SCREENS\` row for ${page} saying how this screen stores what an author does on it`;
        }
        return saveModel.includes(slot)
          ? undefined
          : `add a \`SCREENS\` row for its rail slot page ${slot}, which the same inventory covers`;
      },
    },
    {
      file: "apps/admin/lib/page-title.test.ts",
      missing: (route) =>
        pageTitle.includes(`"${route}"`)
          ? undefined
          : "add the route to the restated tree list, and give the page a `generateMetadata` " +
            "built through `pageMetadata` so its browser tab is not the layout's fallback",
    },
    {
      file: "apps/admin/lib/rail-routes.test.ts",
      missing: (route) => {
        if (!slots.has(route)) {
          return `add \`app/(shell)/@rail${route}/page.tsx\`, returning \`NoRailSection\` if this screen carries no rail: a route the slot does not answer keeps the PREVIOUS screen's rail on a soft navigation`;
        }
        return railRoutes.includes(`"${route}"`)
          ? undefined
          : "name the route in `CURRENT_SECTION` if it is form-scoped, in `NO_SECTION` if it carries no rail, or in the `withRail` list if it carries one of its own";
      },
    },
    {
      file: "apps/admin/e2e/measure.pw.ts",
      missing: (route) =>
        walked.has(route)
          ? undefined
          : "add the screen to `screens()` with the cap it takes, in route order: this list is " +
            "hand-written, so a screen left out of it is a screen the browser walk quietly stops measuring",
    },
  ];
}

/** What a lane is told when a route is not registered everywhere it has to be. */
const HOW_TO_REGISTER = [
  "A route under `apps/admin/app/(shell)` is registered in five places, and at least one",
  "place has not heard of at least one route. Each line below is one route and one place,",
  "with the entry that place wants. `apps/admin/app/(shell)/AGENTS.md` states the same",
  "five in prose, with the route conventions that go with them.",
].join("\n");

describe("every admin screen is registered in all five places", () => {
  it("names every route and place that has not heard of the other, in one failure", () => {
    const routes = shellRoutes();
    const gaps = places(routes).flatMap((place) =>
      routes.flatMap((route) => {
        const gap = place.missing(route);
        return gap === undefined ? [] : [`${route} -> ${place.file}: ${gap}`];
      }),
    );
    expect(gaps, HOW_TO_REGISTER).toEqual([]);
  });

  it("enumerates the same screens the width table does, so neither walk can go quietly empty", () => {
    // The anti-vacuity anchor, and it is deliberately NOT a restated list of routes. A
    // list here would be a sixth place to register a screen, which is the cost this file
    // exists to remove. `MEASURE_BY_ROUTE`'s keys are already proved to be exactly the
    // route tree by `measure.test.ts`, so comparing against them fails on an enumeration
    // that returns nothing while asking a new route's author for nothing.
    //
    // It is also the one place the two techniques meet: `measure.test.ts` walks the
    // directory tree and this file asks git. They agree today. Where they would not is a
    // checkout that has run a dev server, whose compiled `page.tsx` files under
    // `.next-dev` a walk reads as screens and git does not (issue #641), which is worth
    // having pinned rather than discovered as a red that reproduces on one machine.
    expect(shellRoutes()).toEqual(
      Object.keys(MEASURE_BY_ROUTE).sort((left, right) => left.localeCompare(right)),
    );
  });

  it("opens no screen in the browser walk that the route tree does not have", () => {
    // The other direction of the hand-written list, and the cheaper half to get wrong: a
    // row left behind by a route that moved does not fail in the browser as a missing row
    // does, it fails as a 404 measured at whatever width the shell gives an unknown path.
    const routes = shellRoutes();
    const stale = browserWalkPaths().filter((path) => patternFor(path, routes) === undefined);
    expect(stale, "`screens()` in `e2e/measure.pw.ts` names a route that does not exist").toEqual(
      [],
    );
  });
});
