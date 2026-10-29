import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";
import { declaresUseServer } from "./use-server-directive.mjs";

/**
 * SEC-9's CSRF belt over every state-changing BFF route handler and `"use server"` module in every
 * Next app. It lives in `scripts/` so turbo cannot cache it against one app's inputs. It reads that
 * the belt is CALLED, not that its answer is used; an unclassifiable export fails by name.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const BELT = "isSameOriginPost(";

const BELT_MODULE = "lib/server/route-helpers.ts";

const MUTATING_VERBS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SCANNABLE_EXPORT = /^export (?:async )?function (\w+)\s*\(/;
const EXPORTED_BINDING = /^export (?:const|let|var) (\w+)\b/;

/**
 * Listed by name so `export const dynamic = ...` passes the readability rule while
 * `export const POST = ...`, a legal handler form this scanner cannot read, fails.
 */
const SEGMENT_CONFIG = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
]);
const BODY_END = /^\}/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
/** The leading `(^|\s)` keeps this off the `//` in a URL literal. */
const TRAILING_COMMENT = /(^|\s)\/\/.*$/;

interface NextApp {
  readonly name: string;
  readonly appDir: string;
}

/**
 * Derived so a third Next app is covered the day it lands. The catalogue is git's, not
 * the working directory's: a build leaves `.next` and a dev server `.next-dev`, both of
 * which a walk would read as source.
 */
function nextApps(): NextApp[] {
  const appsDir = `${REPO_ROOT}apps`;
  const names = new Set<string>();
  for (const relative of trackedFilesUnder(appsDir)) {
    const [name, second] = relative.split("/");
    if (name !== undefined && second === "app") names.add(name);
  }
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, appDir: `${appsDir}/${name}/app` }));
}

function routeFiles(dir: string, prefix: string): string[] {
  return trackedFilesUnder(dir, { match: /(?:^|\/)route\.tsx?$/ }).map(
    (relative) => `${prefix}${relative}`,
  );
}

function stripComments(lines: string[]): string[] {
  const code: string[] = [];
  let inBlockComment = false;
  for (const line of lines) {
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (COMMENT_LINE.test(line)) {
      inBlockComment = line.trimStart().startsWith("/*") && !line.includes("*/");
      continue;
    }
    code.push(line.replace(TRAILING_COMMENT, ""));
  }
  return code;
}

/**
 * Both bounds are load-bearing: slicing to the next `export` would let a handler inherit a neighbour's
 * JSDoc, and keeping comments would let a comment naming the belt satisfy the rule.
 */
function handlerBody(lines: string[], start: number, limit: number): string {
  const end = lines.findIndex((line, index) => index > start && BODY_END.test(line));
  if (end === -1 || end > limit) return "";
  return stripComments(lines.slice(start, end + 1)).join("\n");
}

interface Handler {
  readonly verb: string;
  readonly body: string;
}

function handlers(source: string): Handler[] {
  const lines = source.split("\n");
  const starts: { verb: string; line: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const match = SCANNABLE_EXPORT.exec(line);
    if (match !== null) starts.push({ verb: match[1] ?? "", line: index });
  }
  return starts.map((start, position) => ({
    verb: start.verb,
    body: handlerBody(lines, start.line, starts[position + 1]?.line ?? lines.length),
  }));
}

/**
 * Inverts the default: an export this scanner cannot classify fails by name rather than
 * being skipped, so no handler shape is trusted past the ones it can read.
 */
export function unscannableExports(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => line.startsWith("export "))
    .filter((line) => !SCANNABLE_EXPORT.test(line))
    .filter((line) => !line.startsWith("export type ") && !line.startsWith("export interface "))
    .filter((line) => {
      const binding = EXPORTED_BINDING.exec(line);
      return binding === null || !SEGMENT_CONFIG.has(binding[1] ?? "");
    })
    .map((line) => line.trim());
}

export function unbeltedHandlers(source: string): string[] {
  return handlers(source)
    .filter((handler) => MUTATING_VERBS.has(handler.verb))
    .filter((handler) => !handler.body.includes(BELT))
    .map((handler) => handler.verb);
}

interface ScannedRoute {
  readonly path: string;
  readonly app: string;
  readonly source: string;
  readonly mutating: number;
}

const APPS = nextApps();

const ROUTES: ScannedRoute[] = APPS.flatMap((app) =>
  routeFiles(app.appDir, `apps/${app.name}/app/`).map((path) => {
    const source = readFileSync(`${REPO_ROOT}${path}`, "utf8");
    return {
      path,
      app: app.name,
      source,
      mutating: handlers(source).filter((handler) => MUTATING_VERBS.has(handler.verb)).length,
    };
  }),
);

describe("issue #487: state-changing BFF route handlers carry SEC-9's CSRF belt", () => {
  it("finds the Next apps it is supposed to be scanning", () => {
    // Non-vacuity: a rename of `apps/` or `app/` would otherwise leave every assertion
    // below passing over an empty list. A superset, so a new app does not fail here.
    expect(APPS.map((app) => app.name)).toEqual(expect.arrayContaining(["admin", "portal"]));
  });

  it.each(APPS)(
    "apps/$name has state-changing route handlers for this gate to check",
    ({ name }) => {
      // Per app, not over the total: the total was already nonzero while the portal
      // contributed nothing to it.
      const mutating = ROUTES.filter((route) => route.app === name).reduce(
        (sum, route) => sum + route.mutating,
        0,
      );
      expect(mutating).toBeGreaterThan(0);
    },
  );

  it.each(APPS)("apps/$name defines its own belt", ({ name }) => {
    // The belt is a deliberate per-app copy: no shared package exists for a Next BFF's
    // server code, so the call sites below must not be importing it from nowhere.
    const module = readFileSync(`${REPO_ROOT}apps/${name}/${BELT_MODULE}`, "utf8");
    expect(module).toContain("export function isSameOriginPost(");
  });

  it.each(ROUTES)("$path exports only shapes this scan can read", ({ source }) => {
    // Ordered before the belt rule: the belt rule would pass an unreadable export in
    // silence.
    expect(unscannableExports(source)).toEqual([]);
  });

  it.each(ROUTES)("$path belts every state-changing handler", ({ source }) => {
    expect(unbeltedHandlers(source)).toEqual([]);
  });

  it("covers the handlers issue #487 was filed about", () => {
    // Pinned by path: a rename would otherwise drop one out of coverage in silence.
    expect(ROUTES.map((route) => route.path)).toEqual(
      expect.arrayContaining([
        "apps/portal/app/f/[formSlug]/start/route.ts",
        "apps/portal/app/s/[sessionId]/answers/route.ts",
        "apps/portal/app/s/[sessionId]/step/route.ts",
        "apps/portal/app/s/[sessionId]/submit/route.ts",
      ]),
    );
  });
});

/*
 * Written here rather than on disk: every broken shape worth asserting on is one no file
 * in the tree has, and a parser that stopped matching would otherwise report green.
 */

function serverActionModules(): string[] {
  const found: string[] = [];
  for (const app of APPS) {
    const root = `${REPO_ROOT}apps/${app.name}`;
    for (const relative of trackedFilesUnder(root, { match: /\.tsx?$/ })) {
      const source = readFileSync(`${root}/${relative}`, "utf8");
      // A walk rather than one expression: the obvious expression backtracks exponentially
      // (`scripts/use-server-directive.mjs` carries the reasoning).
      if (declaresUseServer(source)) {
        found.push(`apps/${app.name}/${relative}`);
      }
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}

const SERVER_ACTIONS = serverActionModules();

/** Read out of each proxy, so the premise below is checked against code, not prose. */
function referrerPolicyOf(app: string): string | undefined {
  const source = readFileSync(`${REPO_ROOT}apps/${app}/proxy.ts`, "utf8");
  return /"Referrer-Policy",\s*"([^"]+)"/.exec(source)?.[1];
}

const ACTION_BELT = "isSameOriginAction(";

describe("task 073: a Server Action carries the belt too (R-B2)", () => {
  it("calls the belt in every action that changes state", () => {
    // Comments are blanked before the match: with them in, a comment naming the belt
    // satisfies a substring rule as readily as calling it.
    const unbelted = SERVER_ACTIONS.filter((path) => {
      const source = readFileSync(`${REPO_ROOT}${path}`, "utf8");
      const code = stripComments(source.split("\n")).join("\n");
      return !code.includes(ACTION_BELT) && !code.includes(BELT);
    });
    expect(unbelted).toEqual([
      "apps/admin/app/(shell)/forms/actions.ts",
      "apps/admin/app/(shell)/questions/actions.ts",
      "apps/admin/app/(shell)/responses/actions.ts",
      "apps/admin/app/(shell)/webhooks/actions.ts",
      // The admin is the case R-B2 left alone: unreachable without JavaScript, and each of
      // these actions proxies a QCMS endpoint whose own grant check is the authority.
      "apps/admin/app/(shell)/workspaces/[workspaceId]/actions.ts",
    ]);
  });

  it("finds the actions in the tree, and they are exactly these", () => {
    // An exact list, not a superset: a second portal action is a decision to take here,
    // because SEC-9's belt does not cover an action entry point by itself.
    expect(SERVER_ACTIONS).toEqual([
      "apps/admin/app/(shell)/forms/actions.ts",
      "apps/admin/app/(shell)/questions/actions.ts",
      "apps/admin/app/(shell)/responses/actions.ts",
      "apps/admin/app/(shell)/webhooks/actions.ts",
      "apps/admin/app/(shell)/workspaces/[workspaceId]/actions.ts",
      // The one action reachable without scripting, which is why the portal's referrer
      // policy had to move.
      "apps/portal/app/s/[sessionId]/roster-action.ts",
    ]);
  });

  /**
   * Per Fetch, a navigation POST under `Referrer-Policy: no-referrer` sends `Origin: null`, which Next
   * refuses, so the portal (a no-JS action) serves `same-origin` and the admin keeps `no-referrer` (SEC-9).
   */
  it("serves same-origin on the portal, whose action is reachable without scripting", () => {
    expect(referrerPolicyOf("portal")).toBe("same-origin");
  });

  it("keeps no-referrer on the admin, whose actions are only ever reached by fetch()", () => {
    expect(referrerPolicyOf("admin")).toBe("no-referrer");
  });

  it("has an action on every app it read a policy for", () => {
    // Non-vacuity: the pair above would still pass if the enumeration found nothing.
    const apps = new Set(SERVER_ACTIONS.map((path) => path.split("/")[1]));
    expect([...apps].sort((a, b) => a.localeCompare(b))).toEqual(["admin", "portal"]);
  });
});

const GUARDED = [
  "export async function POST(request: Request): Promise<Response> {",
  "  if (!isSameOriginPost(request)) return new Response(null, { status: 403 });",
  "  return new Response(null, { status: 204 });",
  "}",
];

const UNGUARDED = [
  "export async function POST(request: Request): Promise<Response> {",
  "  return new Response(null, { status: 204 });",
  "}",
];

/**
 * A fixture rather than a reliance on the one synchronous handler in the tree, so that
 * deleting that route cannot quietly delete this coverage with it.
 */
const UNGUARDED_SYNC = [
  "export function POST(request: Request): Response {",
  "  return new Response(null, { status: 204 });",
  "}",
];

const GUARDED_SYNC = [
  "export function POST(request: Request): Response {",
  "  if (!isSameOriginPost(request)) return new Response(null, { status: 403 });",
  "  return new Response(null, { status: 204 });",
  "}",
];

describe("the rule fails on the shapes it exists to catch", () => {
  it("passes a state-changing handler that calls the belt", () => {
    expect(unbeltedHandlers(GUARDED.join("\n"))).toEqual([]);
  });

  it("fails a state-changing handler that does not", () => {
    expect(unbeltedHandlers(UNGUARDED.join("\n"))).toEqual(["POST"]);
  });

  it("passes a read-only handler, which has no state change to belt", () => {
    const source = [
      "export async function GET(): Promise<Response> {",
      "  return new Response();",
      "}",
    ];
    expect(unbeltedHandlers(source.join("\n"))).toEqual([]);
  });

  it("does not let a handler free-ride on its neighbour's belt", () => {
    // The file contains the belt and the second handler does not, so a file-level
    // substring check would pass this.
    expect(unbeltedHandlers([...GUARDED, "", ...UNGUARDED].join("\n"))).toEqual(["POST"]);
  });

  it("does not let a handler inherit the JSDoc of the handler below it", () => {
    const source = [
      ...UNGUARDED,
      "",
      "/**",
      " * Documented neighbour: checks isSameOriginPost(request) before changing anything.",
      " */",
      ...GUARDED,
    ];
    expect(unbeltedHandlers(source.join("\n"))).toEqual(["POST"]);
  });

  it("does not accept a mention of the belt inside the handler's own comments", () => {
    const source = [
      "export async function POST(request: Request): Promise<Response> {",
      "  // isSameOriginPost(request) is not called here, deliberately.",
      "  return new Response(null, { status: 204 });",
      "}",
    ];
    expect(unbeltedHandlers(source.join("\n"))).toEqual(["POST"]);
  });

  it("does not accept an import line as a call site", () => {
    const source = ['import { isSameOriginPost } from "@/lib/server/route-helpers";', ...UNGUARDED];
    expect(unbeltedHandlers(source.join("\n"))).toEqual(["POST"]);
  });

  it("reports a handler whose body it cannot bound, rather than passing it", () => {
    const source = ["export async function POST(request: Request): Promise<Response> {"];
    expect(unbeltedHandlers(source.join("\n"))).toEqual(["POST"]);
  });

  it("catches an unbelted handler that is not async (the PR #500 review miss)", () => {
    expect(unbeltedHandlers(UNGUARDED_SYNC.join("\n"))).toEqual(["POST"]);
  });

  it("passes a belted handler that is not async", () => {
    expect(unbeltedHandlers(GUARDED_SYNC.join("\n"))).toEqual([]);
  });

  it("sees a sync handler hiding among async ones, which is how the miss survived", () => {
    const source = [...GUARDED, "", ...UNGUARDED_SYNC];
    expect(unbeltedHandlers(source.join("\n"))).toEqual(["POST"]);
  });
});

describe("an export shape the scan cannot read fails loudly rather than silently", () => {
  it("accepts the handler shapes it can read", () => {
    expect(unscannableExports(GUARDED.join("\n"))).toEqual([]);
    expect(unscannableExports(GUARDED_SYNC.join("\n"))).toEqual([]);
  });

  it("accepts Next segment config, which is data rather than a handler", () => {
    expect(unscannableExports('export const dynamic = "force-dynamic";')).toEqual([]);
  });

  it("accepts a type-only export, which has no body to belt", () => {
    expect(unscannableExports("export type Params = { id: string };")).toEqual([]);
  });

  it("refuses an arrow-function handler, a legal Next form this scan cannot read", () => {
    const line = "export const POST = async (request: Request) => new Response(null);";
    expect(unscannableExports(line)).toEqual([line]);
  });

  it("refuses a re-exported handler, whose body is not in this file at all", () => {
    const line = 'export { POST } from "./shared-handler";';
    expect(unscannableExports(line)).toEqual([line]);
  });

  it("refuses a default export", () => {
    const line = "export default function POST(): Response { return new Response(null); }";
    expect(unscannableExports(line)).toEqual([line]);
  });
});
