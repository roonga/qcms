import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The reserved environment names are **derived**, not remembered (ADR-40, Q42).
 *
 * An environment's name is its URL prefix on both surfaces, so a name that collides with
 * a route either surface already serves at its root would make an address ambiguous -
 * `/forms/...` would be a form route or an environment's root depending on who read it.
 * The environment command therefore refuses the collision set.
 *
 * ## Why the list lives in `@roonga/qcms-db` and the derivation lives here
 *
 * The command runs from the database package, which cannot import either application:
 * `@roonga/qcms-db` is published and an adopter's copy of it has no `apps/` beside it.
 * So the list is a constant there and **this** is the check that it still covers what the
 * routes actually are, in the shape `CONTRIBUTING.md` asks for - a hand-kept copy goes
 * stale the first time somebody adds a root route, and it goes stale silently, because
 * nothing about adding a route makes anybody look at an environment-name rule.
 *
 * The direction matters: the derived set must be a **subset** of the constant. A name in
 * the constant that no route uses is harmless (`prod` is reserved by the address rule,
 * `data` by the schema layout), and a route with no reservation is the failure.
 */

const ROOT = new URL("../", import.meta.url);

/**
 * The reserved set, read out of the command's source rather than imported.
 *
 * This file lives in the tooling project, which deliberately depends on no workspace
 * package: it checks the repository, and a check that had to be built before it could run
 * is a check that stops running the first time a build breaks. The same technique as
 * `scripts/check-schema-disjoint.mjs`, and the parse **fails loudly** rather than
 * returning an empty set, because a control that reports nothing reads exactly like a
 * control that found nothing wrong.
 */
function reservedNames(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("packages/db/src/environment/command.ts", ROOT)),
    "utf8",
  );
  const start = source.indexOf("export const RESERVED_ENVIRONMENT_NAMES");
  if (start === -1) throw new Error("RESERVED_ENVIRONMENT_NAMES is not declared where expected");
  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  const names = [...source.slice(open, close).matchAll(/"([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );
  if (names.length < 10) throw new Error(`only ${String(names.length)} reserved names parsed`);
  return names;
}

const RESERVED_ENVIRONMENT_NAMES = reservedNames();

/**
 * The portal's root path segments, read off the App Router directory.
 *
 * Next's own `_next` is added because it is a root segment the framework serves and
 * nothing in `app/` declares it.
 */
function portalRootSegments(): string[] {
  const appDir = fileURLToPath(new URL("apps/portal/app/", ROOT));
  const segments = readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // A parallel or private route (`(group)`, `@slot`) is not a path segment.
    .filter((entry) => !entry.name.startsWith("(") && !entry.name.startsWith("@"))
    .map((entry) => entry.name);
  return [...segments, "_next"];
}

/**
 * The API's root path segments: every mount prefix, plus the first segment of every
 * route path the slices declare.
 *
 * Read from the source text rather than by importing the app, because importing it would
 * boot the whole composition root for a string search. The two patterns are the
 * `MOUNT_PREFIX` map in `app.ts` and every `path: "/..."` in a `createRoute` call.
 */
function apiRootSegments(): string[] {
  const segments = new Set<string>();

  const appSource = readFileSync(fileURLToPath(new URL("apps/api/src/app.ts", ROOT)), "utf8");
  const mountBlock = appSource.slice(
    appSource.indexOf("const MOUNT_PREFIX"),
    appSource.indexOf("} as const;", appSource.indexOf("const MOUNT_PREFIX")),
  );
  for (const match of mountBlock.matchAll(/"\/([a-z0-9-]*)/g)) {
    if (match[1] !== undefined && match[1] !== "") segments.add(match[1]);
  }

  for (const file of sourceFiles(fileURLToPath(new URL("apps/api/src/", ROOT)))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bpath:\s*"\/([a-z0-9-]+)/g)) {
      if (match[1] !== undefined) segments.add(match[1]);
    }
  }
  return [...segments];
}

/** Every non-test `.ts` file under `directory`, recursively. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(`${path}/`));
    else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) found.push(path);
  }
  return found;
}

describe("the reserved environment names still cover the routes", () => {
  it("has routes to reason about", () => {
    // The floor under both assertions below. A directory walk that found nothing would
    // leave each of them vacuously true, which reads exactly like a check that found
    // nothing wrong.
    expect(portalRootSegments().length).toBeGreaterThan(5);
    expect(apiRootSegments().length).toBeGreaterThan(5);
  });

  it("reserves every portal root segment", () => {
    const missing = portalRootSegments().filter(
      (segment) => !RESERVED_ENVIRONMENT_NAMES.includes(segment),
    );
    expect(missing).toEqual([]);
  });

  it("reserves every API mount prefix and route root", () => {
    // Test-only routes declared inside `*.test.ts` files are excluded by `sourceFiles`,
    // because a fixture route is not an address this product serves.
    const missing = apiRootSegments().filter(
      (segment) => !RESERVED_ENVIRONMENT_NAMES.includes(segment),
    );
    expect(missing).toEqual([]);
  });

  it("reserves the schema names and the prod address shape", () => {
    // Not derived from a route, and both deliberate. An environment named `data` would
    // give a schema called `data_data`, which is legal and unreadable; one named
    // `control` or `reporting` would give `data_control`, which is worse, because the
    // name then reads as though the schema held the control plane. `prod` is the
    // unprefixed address shape, so a prefixed `prod` would be a second spelling of one
    // thing.
    for (const name of ["data", "control", "reporting", "public", "prod"]) {
      expect(RESERVED_ENVIRONMENT_NAMES, name).toContain(name);
    }
  });
});
