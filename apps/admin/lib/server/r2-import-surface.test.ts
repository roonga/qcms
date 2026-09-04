import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The R2 audit: the admin BFF stays a proxy, and since task 056 holds **no database
 * handle at all** (ADR-35 as amended 2026-07-31, exit criterion 1).
 *
 * The portal's audit covers the first two rules below. The admin needs the rest because
 * it holds credentials the portal never sees:
 *
 * 1. Nothing imports `@roonga/qcms-core` as a value - rule evaluation, validation and publish
 *    aggregation live in the API, and the admin has no authority over any of them. A
 *    type-only import is allowed and is erased at compile time; `lib/forms/condition.ts`
 *    uses one to pin the admin's parallel operator set to the kernel's (ADR-03).
 * 2. No client component pulls a server-only module in as a value, so the internal
 *    service token and the admin's session token cannot reach the browser bundle.
 * 3. **No database client exists.** The allowlist of `@roonga/qcms-db` value bindings is now
 *    **empty**, and that emptiness is the regression gate ADR-35's amendment asks for:
 *    task 031 needed seven bindings for better-auth's adapter, and the whole point of
 *    056 is that it needs none. Nothing imports `pg` or `drizzle-orm` either, and no
 *    file constructs a Drizzle client.
 * 4. Nothing imports `better-auth`. The instance lives in `apps/api`; this app carries
 *    cookies past it and reads a proxied session, which needs no library.
 * 5. `fetch` to the API happens only through `lib/server/api.ts`, so the credentials are
 *    attached in one place and a new screen (or a new auth step) cannot forget one.
 * 6. The **runtime dependency list** carries none of those packages, which is what makes
 *    the shipped image genuinely incapable of reaching Postgres rather than merely
 *    disinclined to.
 *
 * Every text scan below reads the source with **comments blanked** and, where a call is
 * the thing being looked for, resolves the receiver rather than trusting the method's
 * name (issues #367, #663). A guard on a security boundary is worth only as much as it
 * is believed, and one that fires on `Map.delete` or on its own explanatory prose teaches
 * every lane that meets it to reword rather than to look.
 *
 * Rules 1-5 scan the app's own source (`app`, `components`, `lib`, `proxy.ts`) and not
 * `e2e/`, deliberately: the Playwright support modules run in the runner process, drive
 * the composed API directly and legitimately make HTTP calls of their own. What keeps
 * *them* from smuggling a database client into this package is rule 6 plus the fact that
 * their database access is borrowed from `apps/api`'s harness
 * (`apps/api/e2e/support/admin-accounts.ts`), so nothing here resolves `pg` at all.
 */

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "components", "lib"];
const EXTRA_FILES = ["proxy.ts"];

/** The one module allowed to build an API request; everything else goes through it. */
const API_CLIENT_SUFFIX = "lib/server/api.ts";

/**
 * The one client-side `fetch` this rule allows, and why it is not the hole rule 5
 * exists to close.
 *
 * `AssistPanel` (task 041) reads a streamed SSE response as it arrives, which needs
 * the browser's own `fetch`: there is no other way to get a `ReadableStream` body for
 * a `POST` carrying a JSON payload (`EventSource` cannot `POST` or set a body at
 * all). What it calls is this app's *own* same-origin route
 * (`app/(shell)/forms/[formId]/assist/route.ts`), never the API directly - neither the
 * admin session token nor the internal service token is anywhere in this file. The
 * one call that does carry them still runs through `lib/server/forms.ts`'s `assist()`,
 * built on `adminApiFetch` like every other API call this app makes, so rule 5's
 * actual property ("the credentials are attached in one place") still holds. Widening
 * this set to a second file is an amendment to this comment, not a silent regex edit.
 */
const ALLOWED_CLIENT_FETCH_SUFFIX = "/components/forms/assist-panel.tsx";

/**
 * The complete set of value bindings the admin may take from `@roonga/qcms-db`: **none**.
 *
 * Kept as a set rather than deleted along with its last entry, because an empty
 * allowlist says something a missing test cannot: that the boundary is checked and the
 * answer is zero. Widening it is an amendment to ADR-35, not an edit to this line.
 */
const ALLOWED_DB_VALUE_IMPORTS = new Set<string>();

/**
 * Package specifiers no admin source file may import at all, for any reason.
 *
 * `pg` and `drizzle-orm` are database clients and `@roonga/qcms-db` is the schema they would
 * address; `better-auth` is the library that needed them. All four left this app in task
 * 056 and none of them has a reason to come back: the API is the sole database client
 * (ADR-35) and the sole better-auth host.
 */
const FORBIDDEN_PACKAGES = ["pg", "drizzle-orm", "@roonga/qcms-db", "better-auth"];

function isSource(entry: string): boolean {
  const isTs = entry.endsWith(".ts") || entry.endsWith(".tsx");
  const isTest = entry.endsWith(".test.ts") || entry.endsWith(".test.tsx");
  return isTs && !isTest;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (isSource(entry)) out.push(full);
  }
  return out;
}

function sourceFiles(): { path: string; text: string }[] {
  const files: string[] = [...EXTRA_FILES.map((f) => `${ADMIN_ROOT}${f}`)];
  for (const dir of SCAN_DIRS) files.push(...walk(`${ADMIN_ROOT}${dir}`));
  return files.map((path) => ({
    path: path.replaceAll("\\", "/"),
    text: readFileSync(path, "utf8"),
  }));
}

interface ParsedImport {
  readonly spec: string;
  readonly isType: boolean;
}

// Linear extraction, the same shape as the portal's: pull the quoted specifier per
// import line and flag `import type`. Avoids a backtracking mega-regex.
const SPEC_RE = /from\s+["']([^"']+)["']/;

function importsOf(text: string): ParsedImport[] {
  const parsed: ParsedImport[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("import ")) continue;
    const match = SPEC_RE.exec(trimmed);
    if (match?.[1] === undefined) continue;
    parsed.push({ spec: match[1], isType: trimmed.startsWith("import type ") });
  }
  return parsed;
}

/**
 * The **value** bindings a module imports from `@roonga/qcms-db`, ignoring type-only ones.
 *
 * Kept even though the allowlist is now empty and a blanket "no `@roonga/qcms-db` import at
 * all" check sits beside it, because the two fail differently: this one names the
 * *binding* a regression reached for, which is the sentence a reviewer needs ("someone
 * imported `forms`"), while the blanket check only names the module.
 *
 * Written with string operations rather than a quantifier-on-quantifier regex
 * (`\s+as\s+` and friends are super-linear, which the lint gate rejects for good
 * reason: these run over every source file in the app).
 */
function dbValueBindings(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimStart())
    .filter(isDbValueImport)
    .flatMap(namedBindings);
}

/** True for an `import { ... } from "@roonga/qcms-db"` line that is not type-only. */
function isDbValueImport(line: string): boolean {
  if (!line.startsWith("import ")) return false;
  // `import type { ... } from "@roonga/qcms-db"` is erased at compile time.
  if (line.startsWith("import type ")) return false;
  return line.includes('from "@roonga/qcms-db"') || line.includes("from '@roonga/qcms-db'");
}

/** The imported names inside one `{ ... }` clause, with aliases and `type` resolved away. */
function namedBindings(line: string): string[] {
  const open = line.indexOf("{");
  const close = line.indexOf("}");
  if (open === -1 || close === -1) return [];
  return (
    line
      .slice(open + 1, close)
      .split(",")
      .map((raw) => raw.trim())
      // An inline `type X` binding is erased too.
      .filter((specifier) => specifier !== "" && !specifier.startsWith("type "))
      // `X as Y`: the imported name is what matters, not the local alias.
      .map((specifier) => {
        const aliasAt = specifier.indexOf(" as ");
        return aliasAt === -1 ? specifier : specifier.slice(0, aliasAt).trim();
      })
  );
}

/**
 * Blank out comments, keeping every newline so nothing downstream shifts.
 *
 * A comment cannot construct a query and cannot call `fetch`. Scanning raw text meant
 * that prose explaining what a module does **not** do failed the check that exists to
 * catch the module doing it (issues #367, #663), and the visible cost was not the lost
 * cycle: it was two files in the tree written around a regex, one of which spells
 * `fetch()` without its parentheses so this file's own scan would leave it alone.
 *
 * The `[^:]` guard keeps `https://` out of the line-comment case.
 */
function withoutComments(text: string): string {
  const blank = (match: string): string => "\n".repeat((match.match(/\n/g) ?? []).length);
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, blank).replaceAll(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The local names one import line binds, aliases resolved to the local side. */
function importedLocals(line: string): string[] {
  const fromAt = line.indexOf(" from ");
  if (fromAt === -1) return [];
  const clause = line.slice("import ".length, fromAt);
  const open = clause.indexOf("{");
  const names: string[] = [];

  // The default or namespace binding, if there is one: `db`, or the `db` of `* as db`.
  const head = (open === -1 ? clause : clause.slice(0, open)).replaceAll(",", " ").trim();
  const headTokens = head.split(/\s+/).filter((token) => token !== "" && token !== "type");
  const bound = headTokens.at(-1);
  if (bound !== undefined && bound !== "*" && bound !== "as") names.push(bound);

  if (open === -1) return names;
  const closed = clause.indexOf("}");
  const close = closed === -1 ? clause.length : closed;
  for (const raw of clause.slice(open + 1, close).split(",")) {
    const specifier = raw.trim().replace(/^type\s+/, "");
    if (specifier === "") continue;
    const aliasAt = specifier.indexOf(" as ");
    names.push(aliasAt === -1 ? specifier : specifier.slice(aliasAt + 4).trim());
  }
  return names;
}

/** `const db = drizzle(pool)` and `const pool = new Pool(...)`: a handle by construction. */
const CLIENT_ASSIGNMENT =
  /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:await\s+)?(?:new\s+Pool|drizzle)\s*\(/;

/**
 * Every identifier in this file that IS a database handle: bound by an import from one
 * of the forbidden packages, or assigned from a client constructor.
 *
 * This is the receiver resolution issue #663 asked for. A query is a call **on one of
 * these**; `subscribers.delete(fn)` is a `Set`, and no amount of naming makes it one.
 */
function databaseRoots(code: string): Set<string> {
  const roots = new Set<string>();
  for (const line of code.split("\n").map((raw) => raw.trimStart())) {
    if (line.startsWith("import ")) {
      const spec = SPEC_RE.exec(line)?.[1];
      if (spec === undefined) continue;
      if (!FORBIDDEN_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) continue;
      for (const name of importedLocals(line)) roots.add(name);
      continue;
    }
    const constructed = CLIENT_ASSIGNMENT.exec(line)?.[1];
    if (constructed !== undefined) roots.add(constructed);
  }
  return roots;
}

/**
 * The query entry points. Named alone they prove nothing; the receiver decides.
 *
 * `query` is in the list only because the receiver now is: `pool.query(sql)` is the raw
 * escape hatch under the builder, and the old name-only rule could not carry it without
 * failing on every unrelated `query` in the app.
 */
const QUERY_CALL = /\.\s*(select|insert|update|delete|transaction|query)\s*\(/g;

/**
 * The methods that can only FOLLOW a query-builder entry point.
 *
 * This is the second discriminator, and it needs no imports to work: `Set.delete` and
 * `Headers.delete` are never followed by `.where(`, and `.select(...).from(...)` is
 * Drizzle's grammar rather than a name anyone reaches by accident.
 */
const QUERY_CHAIN =
  /^\s*\.\s*(from|values|set|where|returning|onConflictDoNothing|onConflictDoUpdate|execute|prepare)\s*\(/;

/** The index of the `)` closing the call whose `(` is at `openParen`, or -1. */
function endOfCall(code: string, openParen: number): number {
  let depth = 0;
  for (let index = openParen; index < code.length; index += 1) {
    const char = code[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** The root identifier of the property chain ending at `dotIndex`. */
function receiverRoot(code: string, dotIndex: number): string {
  let start = dotIndex;
  while (start > 0 && /[A-Za-z0-9_$.]/.test(code[start - 1] ?? "")) start -= 1;
  return code.slice(start, dotIndex).split(".")[0] ?? "";
}

/**
 * Every database query one module issues, each described by the text that made it one.
 *
 * Exported to the self-test below rather than inlined, because a guard on a security
 * boundary that is only ever run against a clean tree is indistinguishable from a guard
 * that always passes - which is the failure mode #663 was really about.
 */
function queryFindings(text: string): string[] {
  const code = withoutComments(text);
  const roots = databaseRoots(code);
  const findings: string[] = [];
  if (/\bdrizzle\s*\(/.test(code)) findings.push("`drizzle(` constructs a database client");
  for (const match of code.matchAll(QUERY_CALL)) {
    const method = match[1] ?? "";
    const root = receiverRoot(code, match.index);
    if (root !== "" && roots.has(root)) {
      findings.push(`\`${root}.${method}(\` is a call on a database handle`);
      continue;
    }
    const close = endOfCall(code, match.index + match[0].length - 1);
    if (close === -1) continue;
    const next = QUERY_CHAIN.exec(code.slice(close + 1, close + 80))?.[1];
    if (next !== undefined) {
      findings.push(`\`.${method}( ... ).${next}(\` is a query-builder chain`);
    }
  }
  return findings;
}

function isClientModule(text: string): boolean {
  const first =
    text
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "";
  return first === '"use client";' || first === "'use client';";
}

describe("R2 import surface (strict BFF)", () => {
  const files = sourceFiles();

  it("scans a non-trivial set of admin source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  /**
   * Rule 1, stated as the module header has always stated it: **no VALUE import.**
   *
   * The line used to refuse `@roonga/qcms-core` in any form, which was stricter than the rule it
   * implemented and stricter than the same file's treatment of everything else: the four
   * {@link FORBIDDEN_PACKAGES} are refused as types too, and the reason is written down
   * beside them (a type from `pg` means someone is holding a pool's shape, which is the
   * step before holding a pool). `@roonga/qcms-core` is a different case and is not in that
   * list. It is the kernel's own vocabulary, it declares no client and opens no socket,
   * and an `import type` from it is erased by the compiler: nothing reaches the bundle,
   * the runtime dependency list is unchanged (rule 6 still holds), and the shipped image
   * does not resolve the package at all.
   *
   * What R2 is actually about is **authority**: rule evaluation, validation and publish
   * aggregation happen in the API, and the admin must not be able to run them. A type
   * cannot run. So the boundary is unchanged and the checks around it are unchanged;
   * this one now says what it meant.
   *
   * The immediate reason it matters is ADR-03. The admin keeps a parallel copy of the
   * operator set, and the ADR's own note flags that nothing stopped the two from
   * drifting - precisely because the copy could not refer to its original.
   * `lib/forms/condition.ts` now pins the two together with a type-only import, so a new
   * operator in `@roonga/qcms-core` fails the admin's typecheck instead of passing unnoticed
   * (Code Owner, 2026-08-31).
   */
  it("takes no VALUE import from @roonga/qcms-core (evaluation and validation stay in the API)", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const { spec, isType } of importsOf(text)) {
        if (!spec.startsWith("@roonga/qcms-core")) continue;
        if (isType) continue;
        offenders.push(`${path} -> ${spec} - rule: the admin runs no kernel code`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The discriminator that rule rests on, asserted rather than assumed.
   *
   * `importsOf` flags only the fully type-only form. An inline `import { type X }` is
   * reported as a value import, which is the conservative side to be wrong on: the line
   * still carries a runtime import statement.
   */
  it("tells a type-only kernel import apart from a value one", () => {
    const parsed = importsOf(
      [
        'import type { Condition } from "@roonga/qcms-core";',
        'import { parseVisibilityRule } from "@roonga/qcms-core";',
        'import { type Condition } from "@roonga/qcms-core";',
      ].join("\n"),
    );
    expect(parsed.map((entry) => entry.isType)).toEqual([true, false, false]);
  });

  it("keeps server-only modules out of client components (value imports)", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      if (!isClientModule(text)) continue;
      for (const { spec, isType } of importsOf(text)) {
        const serverOnly =
          spec.includes("lib/server/") ||
          FORBIDDEN_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`));
        if (serverOnly && !isType) offenders.push(`${path} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("takes NO value binding from @roonga/qcms-db: the allowlist is empty (task 056)", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const binding of dbValueBindings(text)) {
        if (!ALLOWED_DB_VALUE_IMPORTS.has(binding)) offenders.push(`${path} -> ${binding}`);
      }
    }
    expect(offenders).toEqual([]);
    // Stated separately so a future edit that repopulates the allowlist fails here
    // rather than passing quietly with a wider surface.
    expect([...ALLOWED_DB_VALUE_IMPORTS]).toEqual([]);
  });

  it("imports no database client and no auth library, in any form", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const { spec } of importsOf(text)) {
        // Type-only imports are erased, but they are refused too: a type from `pg` in
        // the admin means someone is holding a pool's shape, which is the step before
        // holding a pool.
        if (FORBIDDEN_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) {
          offenders.push(`${path} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Before task 056 exactly one module was allowed to do this. Now none is, so the check
   * has no exemption to carry: a query anywhere in the admin's source is a regression by
   * definition.
   *
   * **What changed with issue #663.** The rule used to read any call *named*
   * `select`/`insert`/`update`/`delete`/`transaction` as a query, over raw text. So it
   * fired on `Map.delete`, on `Headers.delete`, and on comments that merely explained
   * the boundary - and the check's whole value is in being believed. A guard that says
   * "adjust your phrasing" to every lane that meets it ends as an exemption list, or as
   * a lane silencing it and being right to. It now matches on what the code **does**:
   * a call on a resolved database handle, or Drizzle's own builder grammar. Bluntness is
   * still the feature; the bluntness is just about behaviour now rather than spelling.
   */
  it("constructs no Drizzle client and issues no query anywhere (R2, ADR-35)", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const finding of queryFindings(text)) {
        offenders.push(`${path}: ${finding} - rule: the admin holds no database client`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares no database client or auth library as a runtime dependency", () => {
    const manifest = JSON.parse(readFileSync(`${ADMIN_ROOT}package.json`, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    // Both lists, not just `dependencies`: a devDependency would still let a source
    // file resolve the specifier, and the checks above are only as strong as the
    // absence of the package.
    expect(declared.filter((name) => FORBIDDEN_PACKAGES.includes(name))).toEqual([]);
  });

  it("carries no connection string in its env surface (exit criterion 1)", () => {
    const example = readFileSync(`${ADMIN_ROOT}.env.example`, "utf8");
    expect(example).not.toContain("DATABASE_URL");
    expect(example).not.toContain("QCMS_ADMIN_AUTH_SECRET");
  });

  /**
   * Comments are excluded here for the reason they are excluded from the query scan: a
   * comment cannot call the global, and scanning raw text made both twins of
   * `route-helpers.ts` spell `fetch()` without its parentheses to get past this line.
   */
  it("issues API requests only through lib/server/api.ts", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      if (path.endsWith(API_CLIENT_SUFFIX)) continue;
      if (path.endsWith(ALLOWED_CLIENT_FETCH_SUFFIX)) continue;
      const matched = /\bfetch\s*\(/.exec(withoutComments(text))?.[0];
      if (matched !== undefined) {
        offenders.push(`${path}: matched \`${matched}\` - rule: one API client, one place`);
      }
    }
    expect(offenders).toEqual([]);

    // The exemption above is only sound while the exempted file carries no
    // credential of its own. Assert that rather than trusting the comment: a
    // session or channel token appearing there is the hole rule 5 exists to
    // close, exemption or not.
    const exempt = files.find((f) => f.path.endsWith(ALLOWED_CLIENT_FETCH_SUFFIX));
    expect(exempt, "the client-fetch exemption names a file that no longer exists").toBeDefined();
    for (const forbidden of [
      "x-qcms-internal-token",
      "x-qcms-admin-session",
      "QCMS_INTERNAL_TOKEN",
      "adminApiFetch",
      "apiBaseUrl",
    ]) {
      expect(exempt?.text ?? "", forbidden).not.toContain(forbidden);
    }
  });

  it("attaches BOTH credentials in the one API client (SEC-4)", () => {
    const client = files.find((f) => f.path.endsWith(API_CLIENT_SUFFIX));
    expect(client, "the API client should be scanned").toBeDefined();
    // The channel credential and the user credential are separate controls; a client
    // that sent only the first would let a compromised service token act as an admin.
    expect(client!.text).toContain("INTERNAL_TOKEN_HEADER");
    expect(client!.text).toContain("ADMIN_SESSION_HEADER");
  });
});

/**
 * The query scan's own discriminator, fed the shapes it exists to separate (issue #663).
 *
 * The rule above only ever runs against a clean tree, so on its own it cannot tell a
 * working guard from one that always passes - and it spent two years as a guard that
 * fired on the wrong things while looking authoritative. These are the positive and
 * negative controls that make the next change to it observable.
 */
describe("the query scan's discriminator", () => {
  it("reads a collection call as a collection call", () => {
    expect(queryFindings("subscribers.delete(listener);")).toEqual([]);
    expect(queryFindings("const seen = new Map();\nseen.delete(id);\n")).toEqual([]);
    expect(queryFindings("headers.delete('cookie');")).toEqual([]);
    expect(queryFindings("params.delete('cursor');\nparams.set('page', '2');")).toEqual([]);
    expect(queryFindings("element.select();")).toEqual([]);
    expect(queryFindings("queue.transaction(() => run());")).toEqual([]);
  });

  it("reads prose about a query as prose", () => {
    expect(queryFindings("// this module never calls .select( or .delete(\n")).toEqual([]);
    expect(queryFindings("/**\n * It does not `.update(` anything.\n */\n")).toEqual([]);
    expect(
      queryFindings("/* db.select().from(forms) is what the API does, not this. */\n"),
    ).toEqual([]);
  });

  it("still catches a query on an imported handle, whatever the handle is called", () => {
    expect(
      queryFindings('import { db } from "@roonga/qcms-db";\ndb.select().from(forms);\n'),
    ).toEqual(["`db.select(` is a call on a database handle"]);
    expect(
      queryFindings(
        'import handle from "@roonga/qcms-db";\nawait handle.transaction(async (tx) => {});\n',
      ),
    ).toEqual(["`handle.transaction(` is a call on a database handle"]);
    expect(
      queryFindings('import * as schema from "drizzle-orm";\nschema.delete(forms);\n'),
    ).toEqual(["`schema.delete(` is a call on a database handle"]);
    expect(queryFindings('import { forms as f } from "@roonga/qcms-db";\nf.insert({});\n')).toEqual(
      ["`f.insert(` is a call on a database handle"],
    );
  });

  it("still catches a builder chain and a constructed client with no import at all", () => {
    expect(queryFindings("await anything.select({ id: forms.id }).from(forms);")).toEqual([
      "`.select( ... ).from(` is a query-builder chain",
    ]);
    expect(
      queryFindings("await x.update(forms)\n  .set({ title })\n  .where(eq(forms.id, id));"),
    ).toEqual(["`.update( ... ).set(` is a query-builder chain"]);
    expect(queryFindings("const client = drizzle(pool);")).toEqual([
      "`drizzle(` constructs a database client",
    ]);
    // The raw escape hatch under the builder, caught because the handle is resolved.
    expect(queryFindings('const pool = new Pool({ url });\npool.query("select 1");')).toEqual([
      "`pool.query(` is a call on a database handle",
    ]);
    // The same method name on anything else is just a method name.
    expect(queryFindings('cache.query("forms");')).toEqual([]);
  });
});
