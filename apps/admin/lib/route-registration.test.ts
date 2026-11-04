import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "../../../scripts/tracked-files.mjs";

import { MEASURE_BY_ROUTE } from "./measure.js";

const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

const ADMIN = fileURLToPath(new URL("..", import.meta.url));

function pageFiles(): readonly string[] {
  return trackedFilesUnder(SHELL, { match: /(?:^|\/)page\.tsx$/u });
}

function patternOf(file: string): string {
  return file
    .split("/")
    .slice(0, -1)
    .filter((segment) => !segment.startsWith("("))
    .map((segment) => `/${segment}`)
    .join("");
}

function shellRoutes(): readonly string[] {
  return pageFiles()
    .map(patternOf)
    .filter((route) => !route.split("/").some((segment) => segment.startsWith("@")))
    .sort((left, right) => left.localeCompare(right));
}

function railSlotRoutes(): ReadonlySet<string> {
  const routes = pageFiles()
    .filter((file) => file.startsWith("@rail/"))
    .map((file) => patternOf(file).replace("/@rail", ""));
  return new Set(routes);
}

function source(relative: string): string {
  return readFileSync(`${ADMIN}${relative}`, "utf8");
}

function segmentsOf(value: string): string[] {
  return value.split("/").filter((segment) => segment !== "");
}

function screenPathsIn(spec: string): readonly string[] {
  return [...source(spec).matchAll(/path:\s*[`"]([^`"]+)[`"]/gu)].map((match) => match[1] ?? "");
}

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

function walkedRoutes(spec: string, routes: readonly string[]): ReadonlySet<string> {
  const walked = new Set<string>();
  for (const path of screenPathsIn(spec)) {
    const pattern = patternFor(path, routes);
    if (pattern !== undefined) walked.add(pattern);
  }
  return walked;
}

function isFormScoped(route: string): boolean {
  return route.startsWith("/forms/[formId]");
}

interface Place {
  readonly file: string;
  readonly missing: (route: string) => string | undefined;
}

function places(routes: readonly string[]): readonly Place[] {
  const saveModel = source("lib/save-model.test.ts");
  const pageTitle = source("lib/page-title.test.ts");
  const railRoutes = source("lib/rail-routes.test.ts");
  const slots = railSlotRoutes();
  const measured = walkedRoutes("e2e/measure.pw.ts", routes);
  const railed = walkedRoutes("e2e/rail-screens.pw.ts", routes);

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
        measured.has(route)
          ? undefined
          : "add the screen to `screens()` with the cap it takes, in route order: this list is " +
            "hand-written, so a screen left out of it is a screen the browser walk quietly stops measuring",
    },
    {
      file: "apps/admin/e2e/rail-screens.pw.ts",
      missing: (route) =>
        !isFormScoped(route) || railed.has(route)
          ? undefined
          : "add the screen to `screens()` with the rail row it marks and the browser tab it " +
            "names: this list is hand-written too, and a form screen left out of it has its rail " +
            "and its title measured by nothing",
    },
  ];
}

const HOW_TO_REGISTER = [
  "A route under `apps/admin/app/(shell)` is registered in six places, and at least one",
  "place has not heard of at least one route. Each line below is one route and one place,",
  "with the entry that place wants. `apps/admin/app/(shell)/AGENTS.md` states the same",
  "six in prose, with the route conventions that go with them.",
].join("\n");

describe("every admin screen is registered in all six places", () => {
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
    expect(shellRoutes()).toEqual(
      Object.keys(MEASURE_BY_ROUTE).sort((left, right) => left.localeCompare(right)),
    );
  });

  it("opens no screen in either hand-written list that the route tree does not have", () => {
    const routes = shellRoutes();
    for (const spec of ["e2e/measure.pw.ts", "e2e/rail-screens.pw.ts"]) {
      const stale = screenPathsIn(spec).filter((path) => patternFor(path, routes) === undefined);
      expect(stale, `\`screens()\` in \`${spec}\` names a route that does not exist`).toEqual([]);
    }
  });
});
