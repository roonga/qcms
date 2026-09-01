import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * Every state-changing BFF route handler in every Next app carries SEC-9's CSRF belt
 * (issue #487).
 *
 * ## Why this is a repo-level gate and not a per-app one
 *
 * The defect it exists to catch is not "the check was written wrongly". It is "the
 * check is in one app and not its twin, while a document asserts it of both".
 * `docs/SECURITY_DESIGN.md` said, unqualified, that BFF route handlers enforce
 * Origin/Sec-Fetch-Site checks on state-changing requests. That was true of the admin
 * and false of the portal, for four tasks, across four state-changing handlers.
 *
 * It was also the fourth instance of that exact pattern in one review pass (compare
 * issues #470, #401, #402, #471). The convention that was supposed to prevent it is
 * written down in `apps/portal/lib/server/config.ts` and its admin twin: there is no
 * shared package for a Next BFF's server code, so the code is a deliberate copy, and
 * "the test matrices on both sides assert the same cases so a change made to one and
 * not the other shows up as a red test". Issue #412 records that those paired
 * matrices are **unenforced**, which is precisely how four of these got through. A
 * convention that depends on an author remembering a twin is not a control. This is.
 *
 * ## Why it lives in `scripts/` rather than in either app
 *
 * Both, and it must see both at once. A cross-app assertion placed inside one app's
 * Vitest project would be cached by turbo against that package's own inputs, so a
 * change to the *other* app would not invalidate it: the gate would report green
 * having never re-read the file that broke it. The `tooling` project runs from the
 * repo root and outside turbo (`pnpm test` is `turbo run test && pnpm test:tooling`),
 * so it is never served from cache and always sees the tree as it is.
 *
 * The cost is that `scripts/` is neither linted nor typechecked, which is the
 * recorded repo-wide state of that project (`vitest.config.ts`, issue #257, and the
 * directory-wide entry in `check-lint-coverage.mjs`). That is a pre-existing gap this
 * file sits inside, not a new one it opens.
 *
 * ## Relationship to `apps/admin/lib/server/shell-route-guards.test.ts`
 *
 * That test enforces three rules over `app/(shell)` only, one of which is this same
 * belt. This one is deliberately narrower in rules and wider in reach: one rule, over
 * every `route.ts` in every app, including the admin's auth routes that sit outside
 * `(shell)` on purpose and are therefore invisible to it. Neither subsumes the other,
 * and this file is not the place to grow the other two rules: an authentication rule
 * expressed over an app with no accounts would be noise.
 *
 * ## What it cannot see
 *
 * Written down because an unwritten limit is how a gate gets trusted past its reach.
 *
 *   - It checks that the belt is **called**, not that the call's answer is used. The
 *     shape in this repo is `if (!isSameOriginPost(request)) return ...`, where the
 *     answer cannot be discarded silently, unlike the returned-Response guard that
 *     rule 1 of the admin's test had to defend against.
 *   - It reads route handlers. Server actions are out of scope and do not need the
 *     belt: Next verifies the origin of every action call itself.
 *   - It cannot know that a route which changes state was spelled `GET`. A handler
 *     that mutates behind a read verb is a different defect, and one no static scan
 *     of verb names can reach.
 *   - **It reads exactly one handler shape: a named top-level `function`, `async` or
 *     not.** `export const POST = ...`, a re-exported binding and a default export are
 *     all legal and all unreadable here. They are not silently skipped, which is the
 *     distinction that matters: {@link unscannableExports} fails on each of them by
 *     name, so the answer to an unreadable shape is a red asking for this file to be
 *     taught, never a green. That rule exists because the `async`-only version of the
 *     handler pattern hid a real handler through PR #500's first review, and the
 *     lesson generalised badly: the miss mode of a scanner must never be silence.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The belt every state-changing route handler must call, by name. */
const BELT = "isSameOriginPost(";

/** Where each app is expected to define its own copy of the belt. */
const BELT_MODULE = "lib/server/route-helpers.ts";

/** Verbs whose handlers change state, so the rule applies to them. */
const MUTATING_VERBS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The one export shape this scanner can read: a named top-level function, `async` or
 * not.
 *
 * `async` was mandatory here until review of PR #500 caught it. Exactly one mutating
 * handler in the tree is synchronous (`apps/admin/app/two-factor/recovery-codes/
 * confirm/route.ts`, which only clears a cookie and so has nothing to await), and it
 * was therefore invisible to this scan: 11 state-changing handlers found where there
 * were 12. It happens to be belted, so nothing was ever exposed, but removing that
 * belt would have left this gate green. A single unseen handler among many seen ones
 * is the worst shape for a tripwire, because every population check still passes: the
 * admin contributes seven other state-changing handlers, so "this app contributed at
 * least one" answered yes while the twelfth went unread.
 *
 * That is the same defect this file exists to catch, one level up, which is why the
 * response is not only to widen the regex but to add {@link unscannableExports}: from
 * here on an export shape the scanner cannot read is a **red naming the file**, not a
 * silent skip. See "What it cannot see" in the header for what that leaves.
 */
const SCANNABLE_EXPORT = /^export (?:async )?function (\w+)\s*\(/;
/** `export const <name>` / `export let <name>`, for the readability rule below. */
const EXPORTED_BINDING = /^export (?:const|let|var) (\w+)\b/;

/**
 * Next route-segment config exports, which are data rather than handlers.
 *
 * Listed explicitly so that `export const dynamic = "force-dynamic"` passes the
 * readability rule while `export const POST = ...` does not: the latter is a legal Next
 * handler form that this scanner genuinely cannot read, so it must fail loudly and ask
 * to be handled here rather than pass as though it had been checked.
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
/** A closing brace in the first column: where a top-level function body ends. */
const BODY_END = /^\}/;
/** A line whose content is a comment, in any of the three spellings Prettier produces. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
/** A trailing `//` comment. The leading `(^|\s)` keeps it off the `//` in a URL literal. */
const TRAILING_COMMENT = /(^|\s)\/\/.*$/;

/** An app with a Next `app/` directory, which is what makes it a BFF with route handlers. */
interface NextApp {
  /** Directory name under `apps/`, for readable failure messages. */
  readonly name: string;
  /** Absolute path to its `app/` directory. */
  readonly appDir: string;
}

/**
 * Every app under `apps/` that has an `app/` directory.
 *
 * Derived from the repository rather than listed here on purpose: a third Next app added
 * later is covered the day it lands, which is the failure mode this whole file is about.
 * The self-check below asserts the derivation still finds the two that exist today, so a
 * discovery that silently stops finding anything is a red rather than a vacuous pass.
 *
 * The catalogue is git's, not the working directory's (issue #641): a build leaves
 * `apps/<app>/.next` and a dev server leaves `apps/<app>/.next-dev`, both of which a walk
 * reads as source.
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

/**
 * Every `route.ts` / `route.tsx` under `dir`, recursively, as repo-relative paths.
 *
 * Enumerated through git for the same reason {@link nextApps} is.
 */
function routeFiles(dir: string, prefix: string): string[] {
  return trackedFilesUnder(dir, { match: /(?:^|\/)route\.tsx?$/ }).map(
    (relative) => `${prefix}${relative}`,
  );
}

/** The given lines with comment lines dropped and trailing comments cut. */
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
 * The code of the handler starting at `start`, bounded by its **own** closing brace and
 * with comments removed.
 *
 * Both bounds are load-bearing, and both were learned in review of PR #250 on the
 * admin's equivalent scan. Slicing to the next `export` line attributes the next
 * handler's JSDoc to this one, and since JSDoc in this repo names the guards, an
 * unguarded handler placed above a documented neighbour inherits its paperwork and
 * passes. Keeping comments lets `// isSameOriginPost is not needed here` satisfy a
 * substring rule as readily as calling it.
 *
 * A body no closing brace bounds is reported as empty, which fails the rule naming the
 * handler. A guard this scanner cannot read is a guard it cannot vouch for.
 */
function handlerBody(lines: string[], start: number, limit: number): string {
  const end = lines.findIndex((line, index) => index > start && BODY_END.test(line));
  if (end === -1 || end > limit) return "";
  return stripComments(lines.slice(start, end + 1)).join("\n");
}

/** One exported route handler: its verb and its own code. */
interface Handler {
  readonly verb: string;
  readonly body: string;
}

/** The exported top-level async functions of a route module, with their bodies. */
function handlers(source: string): Handler[] {
  const lines = source.split("\n");
  const starts: { verb: string; line: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const match = SCANNABLE_EXPORT.exec(line);
    if (match !== null) starts.push({ verb: match[1] ?? "", line: index });
  }
  // Each body is bounded by the next handler's `export` line as well as by its own
  // closing brace, so a handler this parser cannot bound reports empty (and fails)
  // instead of absorbing its neighbour's belt.
  return starts.map((start, position) => ({
    verb: start.verb,
    body: handlerBody(lines, start.line, starts[position + 1]?.line ?? lines.length),
  }));
}

/**
 * The `export` lines of a route module that this scanner cannot read as either a
 * handler or plain segment-config data.
 *
 * The rule PR #500's review made necessary. Widening {@link SCANNABLE_EXPORT} to accept
 * a synchronous handler fixes the one shape that was actually hiding; it does nothing
 * about the next one. A scanner whose miss mode is silence cannot be trusted past the
 * shapes its author happened to think of, so this inverts the default: anything it
 * cannot classify fails, naming the file and the line, and whoever wrote that export
 * teaches this file to read it.
 *
 * Shapes this deliberately refuses, all legal Next or TypeScript:
 *
 *   - `export const POST = async (request) => { ... }`, a legal route handler.
 *   - `export { POST } from "./elsewhere"` and `export { handler as POST }`, where the
 *     body is not in this file at all.
 *   - `export default ...`, which is not a route handler but is not data either.
 *
 * Type-only exports pass, because they carry no body to belt and erase at compile time.
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

/** The state-changing handlers of a route module whose own body never calls the belt. */
export function unbeltedHandlers(source: string): string[] {
  return handlers(source)
    .filter((handler) => MUTATING_VERBS.has(handler.verb))
    .filter((handler) => !handler.body.includes(BELT))
    .map((handler) => handler.verb);
}

/** One route module to assert on, flattened across apps so each gets its own test. */
interface ScannedRoute {
  /** Repo-relative path, so a red names the file to open. */
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
    // Without this, a rename of `apps/` or of the `app/` directory turns every
    // assertion below into a vacuous pass over an empty list. A superset check, not an
    // exact list: a new Next app is expected to appear and should not fail here.
    expect(APPS.map((app) => app.name)).toEqual(expect.arrayContaining(["admin", "portal"]));
  });

  it.each(APPS)(
    "apps/$name has state-changing route handlers for this gate to check",
    ({ name }) => {
      // Per app rather than over the total, so that an entire app's handler set going
      // unscanned is a red rather than a silence. The total was already nonzero while
      // the portal contributed nothing to it, which is exactly issue #487.
      const mutating = ROUTES.filter((route) => route.app === name).reduce(
        (sum, route) => sum + route.mutating,
        0,
      );
      expect(mutating).toBeGreaterThan(0);
    },
  );

  it.each(APPS)("apps/$name defines its own belt", ({ name }) => {
    // The belt is a deliberate copy per app (no shared package exists for a Next BFF's
    // server code, see `config.ts` in either app). This pins that the copy is present
    // and exported, so the call sites below cannot be importing it from nowhere.
    const module = readFileSync(`${REPO_ROOT}apps/${name}/${BELT_MODULE}`, "utf8");
    expect(module).toContain("export function isSameOriginPost(");
  });

  it.each(ROUTES)("$path exports only shapes this scan can read", ({ source }) => {
    // Ordered before the belt rule on purpose: an export this scan cannot read is a
    // handler it cannot vouch for, and the belt rule below would pass it in silence.
    expect(unscannableExports(source)).toEqual([]);
  });

  it.each(ROUTES)("$path belts every state-changing handler", ({ source }) => {
    expect(unbeltedHandlers(source)).toEqual([]);
  });

  it("covers the handlers issue #487 was filed about", () => {
    // The four portal handlers named in the issue, pinned by path. If one is renamed or
    // deleted the scan silently stops covering it, and this is the line that notices.
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
 * Fixtures for the rule itself, over sources written here rather than files on disk.
 *
 * The scan above is only worth having while it fails against a broken shape, and every
 * shape that matters is one no file in the tree has: that is the point of the scan
 * passing. So they are written here. Without these, a parser that silently stopped
 * matching anything would report the whole tree green.
 */

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
 * The synchronous handler shape, which this scan could not see until PR #500's review.
 *
 * A fixture rather than a note, because the regex passed review while being wrong: the
 * only thing that would have caught it is a case asserting the rule fires on a shape no
 * file in the tree had yet. It is in the tree now
 * (`two-factor/recovery-codes/confirm/route.ts`), but the fixture stays regardless, so
 * that deleting that route cannot quietly delete the coverage too.
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
    // The file contains the belt; the second handler does not. A file-level substring
    // check passes this, which is why the rule reads each handler's own body.
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
    // The shape that made the original defect invisible to every population check: the
    // file has belted async handlers, so nothing looked empty, and the one unbelted
    // sync handler was simply never read.
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
