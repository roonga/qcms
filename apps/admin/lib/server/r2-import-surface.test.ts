import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "components", "lib"];
const EXTRA_FILES = ["proxy.ts"];

const API_CLIENT_SUFFIX = "lib/server/api.ts";

const ALLOWED_CLIENT_FETCH_SUFFIXES: readonly string[] = [
  "/components/agent/assistant-conversation.tsx",
];

const ALLOWED_DB_VALUE_IMPORTS = new Set<string>();

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

function dbValueBindings(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimStart())
    .filter(isDbValueImport)
    .flatMap(namedBindings);
}

function isDbValueImport(line: string): boolean {
  if (!line.startsWith("import ")) return false;

  if (line.startsWith("import type ")) return false;
  return line.includes('from "@roonga/qcms-db"') || line.includes("from '@roonga/qcms-db'");
}

function namedBindings(line: string): string[] {
  const open = line.indexOf("{");
  const close = line.indexOf("}");
  if (open === -1 || close === -1) return [];
  return (
    line
      .slice(open + 1, close)
      .split(",")
      .map((raw) => raw.trim())

      .filter((specifier) => specifier !== "" && !specifier.startsWith("type "))
      // Authorize imports by their exported name, never an alias that could hide a forbidden binding.
      .map((specifier) => {
        const aliasAt = specifier.indexOf(" as ");
        return aliasAt === -1 ? specifier : specifier.slice(0, aliasAt).trim();
      })
  );
}

// Preserve newlines so removing prose cannot shift the scanner line boundaries.
function withoutComments(text: string): string {
  const blank = (match: string): string => "\n".repeat((match.match(/\n/g) ?? []).length);
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, blank).replaceAll(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function importedLocals(line: string): string[] {
  const fromAt = line.indexOf(" from ");
  if (fromAt === -1) return [];
  const clause = line.slice("import ".length, fromAt);
  const open = clause.indexOf("{");
  const names: string[] = [];

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

const CLIENT_ASSIGNMENT =
  /^(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:await\s+)?(?:new\s+Pool|drizzle)\s*\(/;

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

const QUERY_CALL = /\.\s*(select|insert|update|delete|transaction|query)\s*\(/g;

const QUERY_CHAIN =
  /^\s*\.\s*(from|values|set|where|returning|onConflictDoNothing|onConflictDoUpdate|execute|prepare)\s*\(/;

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

function receiverRoot(code: string, dotIndex: number): string {
  let start = dotIndex;
  while (start > 0 && /[A-Za-z0-9_$.]/.test(code[start - 1] ?? "")) start -= 1;
  return code.slice(start, dotIndex).split(".")[0] ?? "";
}

// Shared method names are not enough: distinguish database receivers and query chains from ordinary collections.
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

    expect([...ALLOWED_DB_VALUE_IMPORTS]).toEqual([]);
  });

  it("imports no database client and no auth library, in any form", () => {
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const { spec } of importsOf(text)) {
        if (FORBIDDEN_PACKAGES.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`))) {
          offenders.push(`${path} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

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
      if (ALLOWED_CLIENT_FETCH_SUFFIXES.some((suffix) => path.endsWith(suffix))) continue;
      const matched = /\bfetch\s*\(/.exec(withoutComments(text))?.[0];
      if (matched !== undefined) {
        offenders.push(`${path}: matched \`${matched}\` - rule: one API client, one place`);
      }
    }
    expect(offenders).toEqual([]);

    for (const suffix of ALLOWED_CLIENT_FETCH_SUFFIXES) {
      const exempt = files.find((f) => f.path.endsWith(suffix));
      expect(
        exempt,
        `the client-fetch exemption ${suffix} names a file that no longer exists`,
      ).toBeDefined();
      for (const forbidden of [
        "x-qcms-internal-token",
        "x-qcms-admin-session",
        "QCMS_INTERNAL_TOKEN",
        "adminApiFetch",
        "apiBaseUrl",
      ]) {
        expect(exempt?.text ?? "", `${suffix} must not contain ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it("attaches BOTH credentials in the one API client (SEC-4)", () => {
    const client = files.find((f) => f.path.endsWith(API_CLIENT_SUFFIX));
    expect(client, "the API client should be scanned").toBeDefined();

    expect(client!.text).toContain("INTERNAL_TOKEN_HEADER");
    expect(client!.text).toContain("ADMIN_SESSION_HEADER");
  });
});

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

    expect(queryFindings('const pool = new Pool({ url });\npool.query("select 1");')).toEqual([
      "`pool.query(` is a call on a database handle",
    ]);

    expect(queryFindings('cache.query("forms");')).toEqual([]);
  });
});
