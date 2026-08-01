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
 *    the 307 a thrown `redirect()` produces (which would re-post the credential).
 * 2. Every exported function in a `"use server"` module under `(shell)` calls
 *    `requireAdminSession()`.
 * 3. A state-changing route handler also calls `isSameOriginPost()` (SEC-9's CSRF belt).
 *    Server actions do not need it: Next verifies the origin of every action call.
 * 4. Every `export` in those files is in a shape rules 1-3 can actually see. A guard the
 *    scanner cannot read is a guard this test cannot vouch for, so an unfamiliar export
 *    fails loudly and asks to be added here rather than passing silently.
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

/** The two spellings of the directive that makes a module a server-action module. */
const USE_SERVER = new Set(['"use server";', "'use server';"]);

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

interface ExportedFunction {
  readonly name: string;
  /** The source from this function's `export` keyword to the start of the next one. */
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
    body: lines.slice(start.line, starts[position + 1]?.line ?? lines.length).join("\n"),
  }));
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
    const guard = file.kind === "route" ? ROUTE_GUARD : ACTION_GUARD;
    const handlers = exportedFunctions(file.source);
    expect(handlers.length).toBeGreaterThan(0);
    const unguarded = handlers
      .filter((handler) => !handler.body.includes(guard))
      .map((h) => h.name);
    expect(unguarded).toEqual([]);
  });

  it.each(files.filter((file) => file.kind === "route"))(
    "$path checks the request origin on state-changing verbs (rule 3, SEC-9)",
    (file) => {
      const mutating = exportedFunctions(file.source).filter((h) => MUTATING_VERBS.has(h.name));
      expect(mutating.length).toBeGreaterThan(0);
      expect(file.source.includes(SAME_ORIGIN_CHECK)).toBe(true);
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
