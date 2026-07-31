import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Exit criterion 4 (R2 audit): the admin BFF stays a proxy.
 *
 * The portal's audit covers the first two rules below. The admin needs the last three as
 * well, because it holds credentials and a database handle the portal never sees:
 *
 * 1. Nothing imports `@qcms/core` as a value - rule evaluation, validation and publish
 *    aggregation live in the API, and the admin has no authority over any of them.
 * 2. No client component pulls a server-only module in as a value, so the database handle,
 *    the better-auth instance, the signing secret, the internal service token and the
 *    admin's session token cannot reach the browser bundle.
 * 3. The only value bindings taken from `@qcms/db` are the auth ones. The admin genuinely
 *    does own a database handle (better-auth needs one), which is exactly why this has to
 *    be asserted rather than assumed: the temptation in tasks 032-035 is to "just read the
 *    forms table here". Domain data comes from the API's `/admin` group and nowhere else.
 * 4. No Drizzle query is issued outside the auth client module, which closes the gap rule 3
 *    leaves open (the `schema` namespace still reaches every table).
 * 5. `fetch` to the API happens only through `lib/server/api.ts`, so the two credentials are
 *    attached in one place and a new screen cannot forget one.
 */

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "components", "lib", "scripts"];
const EXTRA_FILES = ["proxy.ts"];

/** The one module allowed to build an API request; everything else goes through it. */
const API_CLIENT_SUFFIX = "/lib/server/api.ts";

/**
 * The complete set of value bindings the admin may take from `@qcms/db`.
 *
 * An allowlist rather than a domain-table denylist, because a denylist over names like
 * `forms` and `sessions` cannot tell a Drizzle table from a nav label or a sentence in
 * a doc comment. This list is what "the admin's database access is for auth" means
 * concretely: the five better-auth tables, the one bootstrap read helper, and the
 * schema namespace the Drizzle client is constructed with. A task that needs a domain
 * table has to edit this list, which is where review can see it.
 */
const ALLOWED_DB_VALUE_IMPORTS = new Set([
  "authUser",
  "authSession",
  "authAccount",
  "authVerification",
  "authTwoFactor",
  "countAdminUsers",
  "schema",
]);

/** Files allowed to construct a Drizzle client at all. */
const DB_CLIENT_SUFFIX = "/lib/server/db.ts";

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
 * The **value** bindings a module imports from `@qcms/db`, ignoring type-only ones.
 *
 * Split out of its test rather than inlined so neither this nor the assertion carries the
 * other's complexity, and written with string operations rather than a
 * quantifier-on-quantifier regex (`\s+as\s+` and friends are super-linear, which the lint
 * gate rejects for good reason: these run over every source file in the app).
 */
function dbValueBindings(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimStart())
    .filter(isDbValueImport)
    .flatMap(namedBindings);
}

/** True for an `import { ... } from "@qcms/db"` line that is not type-only. */
function isDbValueImport(line: string): boolean {
  if (!line.startsWith("import ")) return false;
  // `import type { ... } from "@qcms/db"` is erased at compile time.
  if (line.startsWith("import type ")) return false;
  return line.includes('from "@qcms/db"') || line.includes("from '@qcms/db'");
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

  it("imports nothing from @qcms/core (evaluation and validation stay in the API)", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const { spec } of importsOf(text)) {
        if (spec.startsWith("@qcms/core")) offenders.push(`${path} -> ${spec}`);
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
          spec === "better-auth" ||
          spec.startsWith("better-auth/") ||
          spec === "@qcms/db" ||
          spec.startsWith("drizzle-orm") ||
          spec === "pg";
        if (serverOnly && !isType) offenders.push(`${path} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("takes only auth bindings from @qcms/db: domain data comes from the API", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const binding of dbValueBindings(text)) {
        if (!ALLOWED_DB_VALUE_IMPORTS.has(binding)) offenders.push(`${path} -> ${binding}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("runs no Drizzle query outside the auth client module (R2)", () => {
    // The complement of the allowlist above: even with only auth tables imported, a
    // screen could still reach the domain through the `schema` namespace. No
    // query-builder call outside the client module means no screen queries anything.
    const offenders: string[] = [];
    for (const { path, text } of files) {
      if (path.endsWith(DB_CLIENT_SUFFIX)) continue;
      if (/\.(select|insert|update|delete|transaction)\s*\(/.test(text)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
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
