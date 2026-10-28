import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The direction is load-bearing (ADR-40, Q42): the derived set must be a subset of the
 * constant. A reserved name no route uses is harmless; a root route with no reservation
 * is the failure.
 */

const ROOT = new URL("../", import.meta.url);

/**
 * Read out of the command's source rather than imported: this project depends on no
 * workspace package, so the check cannot stop running when a build breaks.
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

/** `_next` is added because the framework serves it and nothing in `app/` declares it. */
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
 * Read from the source text rather than by importing the app, which would boot the whole
 * composition root for a string search.
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
    const missing = apiRootSegments().filter(
      (segment) => !RESERVED_ENVIRONMENT_NAMES.includes(segment),
    );
    expect(missing).toEqual([]);
  });

  it("reserves the schema names and the prod address shape", () => {
    // Reserved by the schema layout and the address shape rather than by a route: `data`
    // would yield the schema `data_data`, and a prefixed `prod` a second spelling of one
    // address.
    for (const name of ["data", "control", "reporting", "public", "prod"]) {
      expect(RESERVED_ENVIRONMENT_NAMES, name).toContain(name);
    }
  });
});
