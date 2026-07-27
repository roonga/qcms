import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Exit criterion 4 (R2 audit): the admin BFF stays a proxy.
 *
 * Same shape as the portal's audit, plus two rules the admin needs and the portal does
 * not, because the admin holds credentials the portal never sees:
 *
 * 1. Nothing imports `@qcms/core` as a value - rule evaluation, validation and publish
 *    aggregation live in the API, and the admin has no authority over any of them.
 * 2. No client component pulls a server-only module in as a value, so the database
 *    handle, the better-auth instance, the signing secret, the internal service token
 *    and the admin's session token cannot reach the browser bundle.
 * 3. No BFF route handler queries a **domain** table. The admin genuinely does own a
 *    database handle (better-auth needs one), which is exactly why this has to be
 *    asserted rather than assumed: the temptation in tasks 032-035 is to "just read the
 *    forms table here". Domain data comes from the API's `/admin` group and nowhere
 *    else.
 * 4. `fetch` to the API happens only through `lib/server/api.ts`, so the two
 *    credentials are attached in one place and a new screen cannot forget one.
 */

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "components", "lib", "scripts"];
const EXTRA_FILES = ["proxy.ts"];

/** The one module allowed to build an API request; everything else goes through it. */
const API_CLIENT_SUFFIX = "/lib/server/api.ts";

/**
 * Domain tables from `@qcms/db`'s schema. The admin's own auth tables are absent
 * from this list on purpose: better-auth is *supposed* to reach those.
 */
const DOMAIN_TABLES = [
  "questions",
  "questionVersions",
  "forms",
  "formDrafts",
  "formVersions",
  "sessions",
  "secureLinks",
  "answers",
  "submissions",
  "erasureTombstones",
  "outbox",
  "webhooks",
  "webhookDeliveries",
];

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

function isClientModule(text: string): boolean {
  const first = text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
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

  it("names no domain table anywhere: questionnaire data comes from the API", () => {
    // A string match rather than an import check, because `import { schema }` would
    // otherwise hide `schema.forms`. The auth tables are deliberately not listed.
    const offenders: string[] = [];
    for (const { path, text } of files) {
      for (const table of DOMAIN_TABLES) {
        if (new RegExp(`\\b${table}\\b`).test(text)) offenders.push(`${path} -> ${table}`);
      }
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
