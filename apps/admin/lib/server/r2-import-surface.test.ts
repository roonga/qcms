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
 *    aggregation live in the API, and the admin has no authority over any of them.
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
const API_CLIENT_SUFFIX = "/lib/server/api.ts";

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
  return files.map((path) => ({ path, text: readFileSync(path, "utf8") }));
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

  it("imports nothing from @roonga/qcms-core (evaluation and validation stay in the API)", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const { spec } of importsOf(text)) {
        if (spec.startsWith("@roonga/qcms-core")) offenders.push(`${path} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
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

  it("constructs no Drizzle client and issues no query anywhere (R2, ADR-35)", () => {
    // Before task 056 exactly one module was allowed to do this. Now none is, so the
    // check has no exemption to carry: a query builder call anywhere in the admin's
    // source is a regression by definition.
    const offenders: string[] = [];
    for (const { path, text } of files) {
      if (/\bdrizzle\s*\(/.test(text)) offenders.push(`${path} (drizzle client)`);
      if (/\.(select|insert|update|delete|transaction)\s*\(/.test(text)) {
        offenders.push(`${path} (query)`);
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

  it("issues API requests only through lib/server/api.ts", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      if (path.endsWith(API_CLIENT_SUFFIX)) continue;
      if (/\bfetch\s*\(/.test(text)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
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
