import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Issue #177: every request handler under `app/(shell)/` authenticates itself.
 *
 * ## What this is defending
 *
 * `app/(shell)/layout.tsx` calls `requireAdminSession()`, and for a **page** that is a
 * gate by construction: a page cannot render without its layout. For a `route.ts` or a
 * `"use server"` action it is not a gate at all - a Next layout wraps the page tree and
 * never runs for a request handler, which the browser reaches directly. So a handler
 * placed in the authenticated group looks guarded and is not.
 *
 * The consequence is narrow but real, and it is exactly what SEC-1 asks of this app:
 * better-auth's own cookie check still fails an anonymous request closed, but the two
 * gates QCMS adds on top of it live in `session.ts` and nowhere else - the **absolute
 * 12h session lifetime** (better-auth's expiry is the *idle* window, and a warm session
 * renews it indefinitely) and the **2FA-enrollment gate** ("an account in this state can
 * reach the enrollment screens and nothing else"). A handler that skips them lets a
 * session past its cap, or one that never finished enrolling, act.
 *
 * ## Why a test and not a comment
 *
 * The comment version of this was tried and failed inside one task: `layout.tsx` claimed
 * to be "the only authentication gate for every screen tasks 032-035 add", which was true
 * of pages and read as a guarantee covering the route handler beside it. This is the
 * "structural, not remembered" pattern instead - the same shape as
 * `no-self-registration.test.ts`, which pins the route tree rather than trusting that
 * nobody mounts the better-auth catch-all.
 *
 * ## The rules
 *
 * 1. Every exported function in a `route.ts` under `(shell)` calls
 *    `requireAdminSessionForRequest()` - the guard that answers with a 303 rather than
 *    the 307 a thrown `redirect()` produces (which would re-post the credential) - and
 *    **uses the `Response` it hands back**, by narrowing on `instanceof Response` or by
 *    returning it. That guard returns its refusal instead of throwing, so calling it and
 *    discarding the answer is a call site that compiles, lints clean, and continues
 *    unauthenticated.
 * 2. Every exported function in a `"use server"` module under `(shell)` calls
 *    `requireAdminSession()`.
 * 3. A state-changing route handler also calls `isSameOriginPost()` (SEC-9's CSRF belt),
 *    checked in that handler's own body rather than anywhere in its file, so a second
 *    handler cannot free-ride on its neighbour's check. A route handler that changes no
 *    state has nothing for this rule to require, so a `route.ts` exporting only `GET`
 *    passes it. Server actions do not need the belt at all: Next verifies the origin of
 *    every action call.
 * 4. Every `export` in those files is in a shape rules 1-3 can actually see. A guard the
 *    scanner cannot read is a guard this test cannot vouch for, so an unfamiliar export
 *    fails loudly and asks to be added here rather than passing silently.
 *
 * All four read a handler's **own** body: its `export` line to its own closing brace,
 * comments removed (see {@link handlerBody}). Neither a neighbour's JSDoc nor a prose
 * mention of a guard's name earns a pass.
 *
 * Auth-flow handlers (`app/sign-in/submit`, `app/two-factor/**`) sit **outside** the
 * group on purpose and are not scanned: requiring a completed, enrolled session is
 * precisely what they cannot do.
 */

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHELL_DIR = `${ADMIN_ROOT}app/(shell)`;

/** The guard a route handler must use: returns a 303 Response instead of throwing. */
const ROUTE_GUARD = "requireAdminSessionForRequest(";
/** The guard a server action must use: `redirect()` is correct inside an action. */
const ACTION_GUARD = "requireAdminSession(";
/** SEC-9's CSRF belt, required of any route handler that changes state. */
const SAME_ORIGIN_CHECK = "isSameOriginPost(";

/** Verbs whose handlers change state, so rule 3 applies to them. */
const MUTATING_VERBS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Next route-segment config exports, which are data rather than handlers.
 *
 * Listed explicitly so that `export const dynamic = "force-dynamic"` passes rule 4 while
 * `export const somethingElse = ...` does not.
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

/** The one export shape rules 1-3 can read: a named top-level async function. */
const SCANNABLE_EXPORT = /^export async function (\w+)\s*\(/;
/** `export const <name>` / `export let <name>`, for the rule-4 segment-config check. */
const EXPORTED_BINDING = /^export (?:const|let|var) (\w+)\b/;

interface HandlerFile {
  /** Path relative to `app/(shell)`, for readable failure messages. */
  readonly path: string;
  readonly source: string;
  readonly kind: "route" | "action";
}

/**
 * The spellings of the directive that makes a module a server-action module.
 *
 * The semicolon-less pair is here because omitting it is a *silent skip* rather than a
 * failure: an `actions.ts` the scanner does not recognise is simply never scanned. Prettier's
 * `semi: true` makes that unlikely under `lint`, but a tripwire whose miss mode is silence
 * should not depend on a formatter (raised in review of PR #250).
 */
const USE_SERVER = new Set(['"use server";', "'use server';", '"use server"', "'use server'"]);

/**
 * Whether a module declares `"use server"`.
 *
 * A line-by-line exact match rather than a regex: the directive is its own statement on
 * its own line wherever Next will honour it, and matching whole trimmed lines cannot be
 * satisfied by the phrase appearing inside a doc comment (which is prefixed with `*`)
 * or a sentence.
 */
function declaresUseServer(source: string): boolean {
  return source.split("\n").some((line) => USE_SERVER.has(line.trim()));
}

/**
 * Every `route.ts` and `"use server"` module under `app/(shell)/`, recursively.
 *
 * `withFileTypes` rather than a `statSync` on each entry: the directory listing already
 * knows what each entry is, so asking again is both a wasted syscall and a check-then-use
 * pair (CodeQL's `js/file-system-race`) that this walk has no need to create.
 */
function handlerFiles(dir: string, prefix = ""): HandlerFile[] {
  const out: HandlerFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (entry.isDirectory()) {
      out.push(...handlerFiles(`${dir}/${name}`, `${prefix}${name}/`));
      continue;
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
    const source = readFileSync(`${dir}/${name}`, "utf8");
    const isRoute = /^route\.tsx?$/.test(name);
    if (isRoute) out.push({ path: `${prefix}${name}`, source, kind: "route" });
    else if (declaresUseServer(source))
      out.push({ path: `${prefix}${name}`, source, kind: "action" });
  }
  return out;
}

/** A closing brace in the first column: where a top-level function body ends. */
const BODY_END = /^\}/;
/** A line whose content is a comment, in any of the three spellings Prettier produces. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
/** A trailing `//` comment. The leading `(^|\s)` keeps it off the `//` in a URL literal. */
const TRAILING_COMMENT = /(^|\s)\/\/.*$/;

interface ExportedFunction {
  readonly name: string;
  /** This function's own code: its `export` line to its own closing brace, comments removed. */
  readonly body: string;
}

/** The exported top-level async functions of a module, with their bodies. */
function exportedFunctions(source: string): ExportedFunction[] {
  const lines = source.split("\n");
  const starts: { name: string; line: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const match = SCANNABLE_EXPORT.exec(line);
    if (match !== null) starts.push({ name: match[1] ?? "", line: index });
  }
  return starts.map((start, position) => ({
    name: start.name,
    body: handlerBody(lines, start.line, starts[position + 1]?.line ?? lines.length),
  }));
}

/**
 * The code of the handler starting at `start`, bounded by its own closing brace.
 *
 * Two bounds, closing two different halves of the same defect (found in review of #250).
 *
 * **The brace, not the next `export` line.** Slicing forward to the next handler's export
 * line attributes everything in between to the earlier handler: blank lines, private
 * helpers, and the next handler's JSDoc. Since JSDoc here names the guards, an unguarded
 * handler placed *above* a documented neighbour inherited its neighbour's paperwork and
 * passed every rule. `/^\}/` is the closing brace of a top-level function and nothing
 * else: Prettier indents every nested one, so the first column-0 `}` after the `export`
 * line ends the body exactly.
 *
 * **Comments removed.** All three rules are substring matches, so a body may not earn a
 * pass from prose. Without this, `// requireAdminSessionForRequest() is not needed here`
 * inside the handler satisfies rule 1 as readily as calling it.
 *
 * A body no closing brace bounds (an unformatted file, or a shape this parser was not
 * written for) is reported as empty, which fails rules 1-3 naming the handler. Fail
 * closed and loud: the point of rule 4 is that a guard the scanner cannot read is a
 * guard this test cannot vouch for.
 */
function handlerBody(lines: string[], start: number, limit: number): string {
  const end = lines.findIndex((line, index) => index > start && BODY_END.test(line));
  if (end === -1 || end > limit) return "";
  return stripComments(lines.slice(start, end + 1)).join("\n");
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
 * The state-changing handlers of a route module that never check the request origin.
 *
 * Rule 3, per handler body rather than per file. The file-level spelling of this
 * (`source.includes(SAME_ORIGIN_CHECK)`) let a second mutating handler in the same file
 * free-ride on its neighbour's check, which is the one shape rules 1 and 2 already refuse.
 *
 * A module with no mutating verb returns `[]` and so passes: `isSameOriginPost()` is
 * SEC-9's belt for state changes, and a read-only `GET` handler has no state change to
 * belt. Requiring one there would be a tripwire that cries on correct code.
 *
 * Not paired with a `length > 0` vacuity guard on purpose: rule 1 already asserts that
 * every one of these files has at least one handler `exportedFunctions()` can see, using
 * this same parser, so a parser regression fails there rather than silently emptying this.
 */
function uncheckedMutatingHandlers(source: string): string[] {
  return exportedFunctions(source)
    .filter((handler) => MUTATING_VERBS.has(handler.name))
    .filter((handler) => !handler.body.includes(SAME_ORIGIN_CHECK))
    .map((handler) => handler.name);
}

/**
 * The two ways a route handler may honour the `Response` its guard hands back.
 *
 * `requireAdminSessionForRequest()` **returns** the refusal rather than throwing it, which
 * is what lets a route handler answer 303 rather than the 307 a thrown `redirect()`
 * produces. The cost is that ignoring the return value compiles and lints clean, and
 * `await requireAdminSessionForRequest();` is exactly the transliteration of the bare
 * `await requireAdminSession();` an author writes in a page or an action that does not
 * need the session object. So rule 1 asks for the answer to be used, not only for the
 * call to appear: either narrowed on with `instanceof Response`, or returned directly.
 */
const NARROWS_REFUSAL = "instanceof Response";
const RETURNS_REFUSAL = [`return ${ROUTE_GUARD}`, `return await ${ROUTE_GUARD}`];

/** Whether a route handler's body does something with the refusal its guard returns. */
function usesRefusal(body: string): boolean {
  return (
    body.includes(NARROWS_REFUSAL) || RETURNS_REFUSAL.some((spelling) => body.includes(spelling))
  );
}

/**
 * The handlers of a module whose own body does not stop an unauthenticated request.
 *
 * Rules 1 and 2, as a named predicate so the fixtures below can exercise them the same
 * way the scan over `(shell)` does. A server action needs only the call: its guard throws
 * `redirect()`, so there is no returned answer to discard.
 */
function unguardedHandlers(source: string, kind: HandlerFile["kind"]): string[] {
  const guard = kind === "route" ? ROUTE_GUARD : ACTION_GUARD;
  return exportedFunctions(source)
    .filter((handler) => !handler.body.includes(guard) || !honoursGuard(handler.body, kind))
    .map((handler) => handler.name);
}

/** The extra thing rule 1 asks of a route handler, and rule 2 does not ask of an action. */
function honoursGuard(body: string, kind: HandlerFile["kind"]): boolean {
  return kind !== "route" || usesRefusal(body);
}

/** Exports rule 4 refuses: anything that is neither a scannable handler nor plain data. */
function unscannableExports(source: string): string[] {
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

describe("issue #177: request handlers under app/(shell) carry their own session gate", () => {
  const files = handlerFiles(SHELL_DIR);

  it("finds the handlers it is supposed to be guarding", () => {
    // A rename of the route group, or a scanner that stopped matching the directive,
    // would otherwise turn every assertion below into a vacuous pass over an empty list.
    // A superset check rather than an exact list: new handlers are expected (that is the
    // point), so only the disappearance of a known one is news.
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["questions/actions.ts", "settings/password/route.ts"]),
    );
  });

  it.each(files)("$path exports only shapes this test can read (rule 4)", (file) => {
    expect(unscannableExports(file.source)).toEqual([]);
  });

  it.each(files)("$path guards every exported handler (rules 1 and 2)", (file) => {
    expect(exportedFunctions(file.source).length).toBeGreaterThan(0);
    expect(unguardedHandlers(file.source, file.kind)).toEqual([]);
  });

  it.each(files.filter((file) => file.kind === "route"))(
    "$path checks the request origin in each state-changing handler (rule 3, SEC-9)",
    (file) => {
      expect(uncheckedMutatingHandlers(file.source)).toEqual([]);
    },
  );

  it("keeps the two guard names non-overlapping", () => {
    // Rules 1 and 2 are substring checks, so they are only honest while neither guard
    // name contains the other. They do not today (`requireAdminSession(` is not inside
    // `requireAdminSessionForRequest(` - an `F` follows, not the paren), but a future
    // rename could make one satisfy the other's rule for free. Pin it.
    expect(ROUTE_GUARD.includes(ACTION_GUARD)).toBe(false);
    expect(ACTION_GUARD.includes(ROUTE_GUARD)).toBe(false);
  });
});

/*
 * Fixtures for the rule tests below, over sources written here rather than files on disk.
 *
 * The rules above are only worth having while they fail against a broken shape, and the
 * shapes that matter are ones no file in the tree has today: a second handler in an
 * existing `route.ts`, a read-only handler, a handler that calls its guard and throws the
 * answer away. None can be demonstrated by scanning `(shell)`, so they are written here.
 */

const BELT_LINE = "  if (!isSameOriginPost(request)) return new Response(null, { status: 403 });";

/** The correct call site: narrow on the type, return the refusal. */
const GUARD_LINES = [
  "  const session = await requireAdminSessionForRequest();",
  "  if (session instanceof Response) return session;",
];

/** The misuse from the review: the guard runs, and its refusal is discarded. */
const DISCARDED_GUARD_LINES = ["  void requireAdminSessionForRequest();"];

/** Paperwork rather than a call: the guard's name appears only inside a comment. */
const COMMENTED_GUARD_LINES = [
  "  // requireAdminSessionForRequest() is not called here, and session instanceof Response",
  "  // is therefore never checked either.",
];

/** How a fixture handler treats its session guard. */
type GuardShape = "used" | "discarded" | "commented" | "absent";

const GUARD_BODY: Readonly<Record<GuardShape, readonly string[]>> = {
  used: GUARD_LINES,
  discarded: DISCARDED_GUARD_LINES,
  commented: COMMENTED_GUARD_LINES,
  absent: [],
};

/**
 * JSDoc naming both guards, which is the paperwork a neighbouring handler used to inherit.
 *
 * Every handler in this repo carries a comment in roughly this shape, which is what made
 * the slice-to-the-next-export defect exploitable rather than theoretical.
 */
const DOC_LINES = [
  "/**",
  " * Documented neighbour.",
  " *",
  " * Calls requireAdminSessionForRequest() and returns it if it is instanceof Response,",
  " * then checks isSameOriginPost(request) before changing anything.",
  " */",
];

interface HandlerShape {
  /** Whether the body calls SEC-9's `isSameOriginPost()`. Default: no. */
  readonly belted?: boolean;
  /** What the body does about the session guard. Default: uses it correctly. */
  readonly guard?: GuardShape;
  /** Whether a JSDoc block naming both guards precedes the `export` line. Default: no. */
  readonly documented?: boolean;
}

/** One exported handler, in whichever of the shapes above the fixture asks for. */
const handler = (verb: string, shape: HandlerShape = {}): string =>
  [
    ...(shape.documented === true ? DOC_LINES : []),
    `export async function ${verb}(request: Request): Promise<Response> {`,
    ...GUARD_BODY[shape.guard ?? "used"],
    ...(shape.belted === true ? [BELT_LINE] : []),
    "  return new Response(null, { status: 204 });",
    "}",
  ].join("\n");

/**
 * A `route.ts` as the scanner sees one: its imports, then the handlers given.
 *
 * Both imports appear in every fixture, including the ones with no belted handler.
 * That is deliberate: it pins that an `import { isSameOriginPost }` line does not by
 * itself satisfy rule 3 (the rule matches `isSameOriginPost(`, and an import names the
 * symbol without calling it), which a fixture that only imported what it used could
 * not show.
 */
const route = (...handlers: string[]): string =>
  [
    'import { isSameOriginPost } from "@/lib/server/origin";',
    'import { requireAdminSessionForRequest } from "@/lib/server/session";',
    "",
    ...handlers,
  ].join("\n\n");

describe("issue #177 rule 3: origin checks are per handler, and only for state changes", () => {
  it("asks nothing of a route that exports only GET", () => {
    // The defect this replaced: the old rule required a mutating verb of every route.ts
    // under (shell), so a correct read-only handler would have failed a SEC-9 assertion
    // that does not apply to it. A tripwire that cries on correct code gets deleted.
    expect(uncheckedMutatingHandlers(route(handler("GET")))).toEqual([]);
  });

  it("names a mutating handler that free-rides on its neighbour's origin check", () => {
    // The hole this replaced: `source.includes(SAME_ORIGIN_CHECK)` is satisfied by POST's
    // check on DELETE's behalf, so this shape passed rule 3 while DELETE was unbelted.
    const source = route(handler("POST", { belted: true }), handler("DELETE"));
    expect(uncheckedMutatingHandlers(source)).toEqual(["DELETE"]);
  });

  it("passes both handlers once each checks for itself", () => {
    // Pins the failure above to the missing check rather than to the second handler
    // merely existing.
    const source = route(handler("POST", { belted: true }), handler("DELETE", { belted: true }));
    expect(uncheckedMutatingHandlers(source)).toEqual([]);
  });
});

/**
 * A handler is judged on its own body, not on the text that happens to follow it.
 *
 * The review of PR #250 found the earlier parser attributed everything between one
 * `export` line and the next to the first handler: blank lines, private helpers, and the
 * next handler's JSDoc. Since JSDoc in this repo names the guards, an unguarded handler
 * placed **above** a documented neighbour inherited its neighbour's paperwork and passed
 * every rule. The regression table this file shipped with only ever added a handler in a
 * new file or last in an existing one, so ordering was never varied and the hole stayed
 * open in exactly the direction task 035's second handler would take.
 */
describe("issue #177: a handler is judged on its own body, whatever follows it", () => {
  it("names an unguarded handler that sits above a documented neighbour (rule 1)", () => {
    // The reviewer's proof, verbatim: a diligent author adds the SEC-9 belt and forgets
    // the session guard, and puts the new verb first. Rules 1, 2, 3 and 4 all passed.
    const source = route(
      handler("DELETE", { guard: "absent", belted: true }),
      handler("POST", { documented: true, belted: true }),
    );
    expect(unguardedHandlers(source, "route")).toEqual(["DELETE"]);
  });

  it("names an unbelted handler that sits above a documented neighbour (rule 3)", () => {
    // Same defect, other rule: the neighbour's JSDoc names `isSameOriginPost()` too.
    const source = route(handler("DELETE"), handler("POST", { documented: true, belted: true }));
    expect(uncheckedMutatingHandlers(source)).toEqual(["DELETE"]);
  });

  it("does not let a handler ride a private helper defined after it", () => {
    // The same slice swallowed anything between the two exports, not only comments.
    const helper = [
      "async function auditLog(request: Request): Promise<void> {",
      "  const session = await requireAdminSessionForRequest();",
      "  if (session instanceof Response) return;",
      "  if (!isSameOriginPost(request)) return;",
      "}",
    ].join("\n");
    const source = route(
      handler("DELETE", { guard: "absent" }),
      helper,
      handler("POST", { belted: true }),
    );
    expect(unguardedHandlers(source, "route")).toEqual(["DELETE"]);
    expect(uncheckedMutatingHandlers(source)).toEqual(["DELETE"]);
  });

  it("still passes a correctly guarded pair in either order", () => {
    // Pins the failures above to the missing guard rather than to ordering itself.
    const source = route(
      handler("DELETE", { belted: true }),
      handler("POST", { documented: true, belted: true }),
    );
    expect(unguardedHandlers(source, "route")).toEqual([]);
    expect(uncheckedMutatingHandlers(source)).toEqual([]);
  });
});

/**
 * Calling the route guard is not enough: the handler has to use the answer.
 *
 * `requireAdminSessionForRequest()` *returns* the refusal rather than throwing it, which
 * is what lets a route handler answer 303 instead of the 307 a thrown `redirect()`
 * produces. The cost is that ignoring the return value compiles, lints clean, and reads
 * like the `await requireAdminSession();` an author writes in a page or an action when
 * they do not need the session object. Rule 1 is a substring match on the guard's name,
 * so that transliteration used to pass while the request continued unauthenticated.
 */
describe("issue #177 rule 1: a route handler must use the refusal its guard returns", () => {
  it("names a handler that calls the guard and discards its answer", () => {
    const source = route(handler("DELETE", { guard: "discarded", belted: true }));
    expect(unguardedHandlers(source, "route")).toEqual(["DELETE"]);
  });

  it("names a handler whose only mention of the guard is in a comment", () => {
    const source = route(handler("DELETE", { guard: "commented", belted: true }));
    expect(unguardedHandlers(source, "route")).toEqual(["DELETE"]);
  });

  it("accepts a handler that returns the guard's result directly", () => {
    // The other honest shape: hand the refusal straight back. Both forms are accepted so
    // the rule pins the answer being used, not one spelling of using it.
    const source = [
      'import { requireAdminSessionForRequest } from "@/lib/server/session";',
      "",
      "export async function GET(): Promise<Response> {",
      "  return await requireAdminSessionForRequest();",
      "}",
    ].join("\n");
    expect(unguardedHandlers(source, "route")).toEqual([]);
  });

  it("asks nothing of the kind for a server action", () => {
    // `requireAdminSession()` throws, so there is no returned answer to discard and no
    // narrowing to require. Rule 2 stays a call check.
    const source = [
      '"use server";',
      "",
      'import { requireAdminSession } from "@/lib/server/session";',
      "",
      "export async function saveAction(): Promise<void> {",
      "  await requireAdminSession();",
      "}",
    ].join("\n");
    expect(unguardedHandlers(source, "action")).toEqual([]);
  });
});
